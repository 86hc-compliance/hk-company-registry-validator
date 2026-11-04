import { useState, type FormEvent } from 'react';
import { ArrowRight, PenLine, Check } from 'lucide-react';
import { api, ErrorMessage, Field, Loading, useLoad, useT } from './common';
import type { Application } from '../shared/domain';
import { registryFieldLabels } from '../shared/registry-fields';

type SigningView = {
  reference: string;
  version: number;
  uri: string;
  companyName: string;
  person: Application['people'][number];
  application?: Application;
  officialReview: { path: string[]; key: string; value: string }[];
};
export function SignPage({ id }: { id: string }) {
  const t = useT();
  const { data, error, reload } = useLoad<SigningView>(`/api/sign/${id}`);
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(),
    [confirmed, setConfirmed] = useState(false),
    [done, setDone] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget,
      field = form.elements.namedItem('password') as HTMLInputElement;
    let password = field.value;
    field.value = '';
    setBusy(true);
    setFailure(undefined);
    try {
      await api(`/api/sign/${id}`, {
        method: 'POST',
        body: JSON.stringify({ version: data!.version, password, confirmed }),
      });
      setDone(true);
    } catch (e) {
      setFailure(e);
    } finally {
      password = '';
      setBusy(false);
    }
  };
  return (
    <section className="narrow section">
      <span className="round-icon">
        <PenLine />
      </span>
      <h1>{t('由你本人，確認並簽署。', 'Review and sign, in your own name.')}</h1>
      <p className="muted">
        {t(
          '使用自己的 Norby 帳戶及公司註冊處個人帳戶。官方簽署密碼不會儲存，也不會提供給代理。',
          'Use your own Norby and Companies Registry accounts. Your Registry signing password is not stored or shared with agents.',
        )}
      </p>
      <ErrorMessage error={error || failure} />
      {done ? (
        <div className="notice success">
          <Check size={19} />
          {t(
            '本次簽署已由官方驗證。若你也需以創辦成員身分簽署，可重新查看下一步。',
            'This signature has been verified by the Registry. If you also need to sign as founder, check the next step.',
          )}
          <button
            className="button secondary"
            onClick={() => {
              setDone(false);
              setConfirmed(false);
              void reload();
            }}
          >
            {t('查看下一筆簽署', 'Check the next signature')}
            <ArrowRight size={17} />
          </button>
        </div>
      ) : data ? (
        <>
          <div className="panel">
            <div className="eyebrow">{data.reference}</div>
            <h2>{data.companyName}</h2>
            <dl className="details">
              <div>
                <dt>{t('簽署身分', 'Capacity')}</dt>
                <dd>
                  {data.uri === 'FormSigner'
                    ? t('創辦成員', 'Founder member')
                    : t('董事同意', 'Director consent')}
                </dd>
              </div>
              <div>
                <dt>{t('姓名', 'Name')}</dt>
                <dd>
                  {data.person.surname} {data.person.givenName} {data.person.chineseName}
                </dd>
              </div>
              <div>
                <dt>{t('官方帳戶', 'Registry account')}</dt>
                <dd>{data.person.officialUserId}</dd>
              </div>
              <div>
                <dt>{t('證件號碼', 'Identification')}</dt>
                <dd>{data.person.identityNumber}</dd>
              </div>
              <div>
                <dt>{t('住址', 'Residential address')}</dt>
                <dd>{Object.values(data.person.address).filter(Boolean).join(', ')}</dd>
              </div>
              <div>
                <dt>{t('通訊地址', 'Correspondence')}</dt>
                <dd>{Object.values(data.person.correspondence).filter(Boolean).join(', ')}</dd>
              </div>
            </dl>
            {data.application && (
              <>
                <h3 className="subheading">{t('設立資料核對', 'Incorporation review')}</h3>
                <p>
                  {t('股份', 'Shares')}: {data.application.shareCount} ·{' '}
                  {data.application.shareCurrency} {data.application.shareCapital}
                </p>
                {data.application.people.map((p) => (
                  <div className="ledger-row" key={p.id}>
                    <span>
                      {p.surname} {p.givenName}
                      {p.director ? ` · ${t('董事', 'Director')}` : ''}
                    </span>
                    <span>
                      {p.shares} {t('股', 'shares')} / {p.contribution}
                    </span>
                  </div>
                ))}
                <p>{data.application.businessDescription}</p>
              </>
            )}
            <details className="official-review">
              <summary>
                {t('核對官方驗證後的完整簽署內容', 'Review the exact Registry-validated content')}
              </summary>
              <dl className="details">
                {data.officialReview.map((row, i) => (
                  <div key={i}>
                    <dt>
                      <small>
                        {row.path
                          .map((part) => {
                            const key = part.replace(/ \d+$/, '');
                            const label = registryFieldLabels[key];
                            return (label ? t(...label) : key) + (part.match(/ \d+$/)?.[0] || '');
                          })
                          .join(' / ')}
                      </small>
                      {registryFieldLabels[row.key] ? t(...registryFieldLabels[row.key]) : row.key}
                    </dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
            {data.uri === 'FormSigner' && (
              <p className="muted">
                {t(
                  '本案採香港私人股份有限公司章程範本。請先閱讀官方章程說明與現行範本，再確認簽署。',
                  'This application uses model articles for a private company limited by shares. Read the official guidance and current articles before signing.',
                )}{' '}
                <a
                  className="text-link"
                  href="https://www.cr.gov.hk/en/faq/companies-ordinance/co-abolition-ma.htm"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('官方章程說明', 'Official articles guidance')}
                </a>
              </p>
            )}
          </div>
          <form onSubmit={submit}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {t(
                '我就是上述簽署人，已核對資料，並同意以所列身分簽署此版本。',
                'I am the named signer, have reviewed the information, and authorize signing this version in the stated capacity.',
              )}
            </label>
            <Field
              label={t('官方個人帳戶密碼', 'Registry personal account password')}
              hint={t(
                '使用電子服務帳戶密碼，不是 TPSI 專用密碼。',
                'Use your e-Services account password, not a TPSI-specific password.',
              )}
            >
              <input
                name="password"
                type="password"
                required
                autoComplete="off"
                maxLength={256}
                disabled={busy}
              />
            </Field>
            <button className="button" disabled={!confirmed || busy}>
              {busy
                ? t('官方驗證中，請稍候…', 'Registry verification in progress…')
                : t('本人簽署並驗證', 'Sign and verify')}
              <PenLine size={17} />
            </button>
            <p className="muted small-text">
              {t(
                '處理可能需要約 90 秒。若資料有誤，請先聯絡 Norby 更正，不要簽署。',
                'Processing may take around 90 seconds. If anything is incorrect, contact Norby before signing.',
              )}
            </p>
          </form>
        </>
      ) : (
        !error && <Loading />
      )}
    </section>
  );
}
