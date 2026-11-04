import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash, constants, privateDecrypt } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

const NS = 'http://interfaces.service.webservice.icris3e.cr.gov.hk/';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

test('real workerd verifies Registry XML and emits interoperable RSA, AES-ECB, AES-GCM PIN signatures', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'norby-workerd-crypto-'));
  let runtime: Miniflare | undefined;
  try {
    const keyPath = join(directory, 'key.pem');
    const certPath = join(directory, 'cert.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-subj',
        '/CN=Fictional Local Crypto Test',
      ],
      { stdio: 'ignore' },
    );
    const privateKey = readFileSync(keyPath);
    const sign = new SignedXml({
      privateKey,
      publicCert: readFileSync(certPath),
      canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    });
    sign.addReference({
      xpath: "//*[@id='formData']",
      transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    });
    sign.computeSignature(
      `<cr:submission xmlns:cr="${NS}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><cr:EForm id="eForm"><cr:formModel id="formData"><cr:indDir id="S1"><cr:name>FICTIONAL ALICE</cr:name></cr:indDir></cr:formModel><cr:formDataSignatures/></cr:EForm><cr:EFormSignatures></cr:EFormSignatures></cr:submission>`,
      {
        prefix: 'ds',
        attrs: { id: 'CR' },
        location: { reference: "//*[local-name()='EFormSignatures']", action: 'append' },
      },
    );
    const fixture = sign.getSignedXml();
    const bundled = await build({
      stdin: {
        contents: `
          import { verifyRegistrySignature, signRegistryXml, signingReview, nextSigner } from './cloudflare/tpsi.ts';
          export default { async fetch(request) {
            const xml = await request.text();
            verifyRegistrySignature(xml);
            let tamperRejected = false, duplicateRejected = false;
            try { verifyRegistrySignature(xml.replace('FICTIONAL ALICE', 'TAMPERED')); } catch { tamperRejected = true; }
            const data = { founderSignerId: 'alice', people: [{ id: 'alice', director: true }] };
            const first = nextSigner({ data }, xml)?.uri;
            const director = signRegistryXml(xml, 'FAKEUSER', 'fixture-password', 'S1');
            try { signRegistryXml(director, 'FAKEUSER', 'fixture-password', 'S1'); } catch { duplicateRejected = true; }
            const second = nextSigner({ data }, director)?.uri;
            const founder = signRegistryXml(director, 'FAKEUSER', 'fixture-password', 'FormSigner');
            return Response.json({ director, founder, tamperRejected, duplicateRejected, first, second,
              complete: nextSigner({ data }, founder) === null,
              review: signingReview(director, 'FormSigner') });
          }};
        `,
        resolveDir: fileURLToPath(new URL('..', import.meta.url)),
        sourcefile: 'crypto-probe.ts',
        loader: 'ts',
      },
      write: false,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'es2022',
      // This is the same Node built-in require bridge used by Worker bundlers.
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire('/worker.mjs');",
      },
    });
    runtime = new Miniflare({
      workers: [
        {
          config: {
            name: 'norby-crypto-test',
            compatibilityDate: '2026-11-04',
            compatibilityFlags: ['nodejs_compat'],
            manifest: {
              mainModule: 'worker.mjs',
              modules: {
                'worker.mjs': { type: 'esm', contents: bundled.outputFiles[0].text },
              },
            },
          },
        },
      ],
    });
    const response = await runtime.dispatchFetch('https://crypto.test/', {
      method: 'POST',
      body: fixture,
    });
    assert.equal(response.status, 200, await response.clone().text());
    const result = (await response.json()) as {
      director: string;
      founder: string;
      tamperRejected: boolean;
      duplicateRejected: boolean;
      first: string;
      second: string;
      complete: boolean;
      review: { key: string; value: string }[];
    };
    assert.equal(result.tamperRejected, true);
    assert.equal(result.duplicateRejected, true);
    assert.equal(result.first, 'S1');
    assert.equal(result.second, 'FormSigner');
    assert.equal(result.complete, true);
    assert.equal(result.founder.includes('fixture-password'), false);
    assert.ok(result.review.some((row) => row.value === 'FICTIONAL ALICE'));
    assert.ok(
      result.review.every(
        (row) =>
          !['UserCredentialHash', 'UserSignature', 'EncryptionKey', 'SignatureValue'].includes(
            row.key,
          ),
      ),
    );

    const parsed = new DOMParser().parseFromString(result.director, 'text/xml');
    const pin = parsed.getElementsByTagNameNS(NS, 'PinSign')[0];
    const value = (name: string) => pin.getElementsByTagNameNS(NS, name)[0].textContent!;
    // Inspect the PKCS#1 block directly to avoid Node's policy restriction on
    // legacy PKCS#1 privateDecrypt while checking the Registry's mandated format.
    const padded = privateDecrypt(
      { key: privateKey, padding: constants.RSA_NO_PADDING },
      Buffer.from(value('EncryptionKey'), 'base64'),
    );
    assert.equal(padded[0], 0);
    assert.equal(padded[1], 2);
    const separator = padded.indexOf(0, 2);
    assert.ok(separator >= 10);
    const aesKey = padded.subarray(separator + 1);
    assert.equal(aesKey.length, 32);
    const userHash = value('UserCredentialHash');
    const credential = createDecipheriv('aes-256-ecb', aesKey, null);
    const credentialBytes = Buffer.from(Buffer.from(userHash, 'base64').toString(), 'base64');
    const cleartext = Buffer.concat([
      credential.update(credentialBytes),
      credential.final(),
    ]).toString();
    assert.equal(cleartext, 'FAKEUSER' + aesKey.toString() + hash('fixture-password'));

    const encoded = Buffer.from(value('UserSignature'), 'base64').toString();
    const gcmFields = JSON.parse(encoded.replace(/([a-zA-Z][a-zA-Z0-9]*):/g, '"$1":'));
    const ciphertext = Buffer.from(gcmFields.ciphertextBase64, 'base64');
    const gcm = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(gcmFields.gcmKeyBase64, 'base64'),
      Buffer.from(gcmFields.ivBase64, 'base64'),
    );
    gcm.setAuthTag(ciphertext.subarray(-16));
    const digest = Buffer.concat([gcm.update(ciphertext.subarray(0, -16)), gcm.final()]).toString();
    const original = new DOMParser().parseFromString(fixture, 'text/xml');
    const target = original.getElementsByTagNameNS(NS, 'indDir')[0];
    assert.equal(digest, hash(new XMLSerializer().serializeToString(target) + userHash));
  } finally {
    await runtime?.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});
