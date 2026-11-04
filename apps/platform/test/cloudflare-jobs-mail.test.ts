import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverNotifications } from '../cloudflare/notifications';
import { sendAuthEmail } from '../cloudflare/mail';
import { createCloudflareBindings } from './cloudflare-data-fixtures';

test('native D1 outbox claims exclude concurrent senders, back off failures, and recover expired leases', async (t) => {
  const { db, dispose } = await createCloudflareBindings();
  t.after(dispose);
  await db.batch([
    db.prepare('CREATE TABLE "user" (id TEXT PRIMARY KEY,email TEXT NOT NULL)'),
    db.prepare('INSERT INTO "user" (id,email) VALUES (?,?)').bind('alice', 'alice@example.test'),
    db.prepare(`INSERT INTO norby_cases (id,reference,owner_id,status,locale,currency,version,revision,data,created_at,updated_at)
      VALUES ('case-1','N-TEST-1','alice','awaiting_payment','zh-Hant','HKD',1,1,X'00','2026-01-01','2026-01-01')`),
  ]);
  const queue = async (id: string, attempts = 0) =>
    db.batch([
      db
        .prepare(
          `INSERT INTO norby_events (id,case_id,actor_id,actor_kind,action,note,created_at)
      VALUES (?,'case-1','alice','customer','checkout','Sensitive internal note','2026-01-01')`,
        )
        .bind(id),
      db
        .prepare(
          `INSERT INTO norby_notifications (event_id,case_id,attempts,next_attempt_at)
      VALUES (?,'case-1',?,'2026-01-01')`,
        )
        .bind(id, attempts),
    ]);
  const messages: EmailMessageBuilder[] = [];
  let fail = false;
  const env = {
    DB: db,
    BASE_URL: 'https://norby.example.test',
    MAIL_FROM: 'Norby <noreply@example.test>',
    EMAIL: {
      async send(message: EmailMessage | EmailMessageBuilder) {
        assert.ok('subject' in message);
        messages.push(message);
        if (fail) throw new Error('Provider failure with confidential response data');
        return { messageId: `fake-${messages.length}` };
      },
    },
  };
  await queue('event-1');
  await Promise.all([
    deliverNotifications(env),
    deliverNotifications(env),
    deliverNotifications(env),
  ]);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].from, { name: 'Norby', email: 'noreply@example.test' });
  assert.match(messages[0].text!, /你的案件有更新/);
  assert.match(messages[0].html!, /https:\/\/norby\.example\.test\/cases\/case-1/);
  assert.equal(JSON.stringify(messages[0]).includes('Sensitive internal note'), false);
  assert.equal(messages[0].headers?.['X-Norby-Event'], 'event-1');
  assert.equal(messages[0].headers?.['Message-ID'], undefined);
  const sent = await db
    .prepare('SELECT attempts,sent_at,lease_token FROM norby_notifications WHERE event_id=?')
    .bind('event-1')
    .first<{ attempts: number; sent_at: string; lease_token: string | null }>();
  assert.equal(sent?.attempts, 1);
  assert.ok(sent?.sent_at);
  assert.equal(sent?.lease_token, null);

  await queue('event-2');
  fail = true;
  await deliverNotifications(env);
  await deliverNotifications(env);
  assert.equal(messages.length, 2);
  const failed = await db
    .prepare('SELECT attempts,error,next_attempt_at FROM norby_notifications WHERE event_id=?')
    .bind('event-2')
    .first<{ attempts: number; error: string; next_attempt_at: string }>();
  assert.equal(failed?.attempts, 1);
  assert.equal(failed?.error, 'DELIVERY_FAILED');
  assert.ok(Date.parse(failed!.next_attempt_at) > Date.now() + 45_000);

  await db
    .prepare(
      `UPDATE norby_notifications SET next_attempt_at='2026-01-01',lease_token='other-worker',lease_expires_at=? WHERE event_id='event-2'`,
    )
    .bind(Date.now() + 60_000)
    .run();
  fail = false;
  await deliverNotifications(env);
  assert.equal(messages.length, 2);
  await db
    .prepare(`UPDATE norby_notifications SET lease_expires_at=0 WHERE event_id='event-2'`)
    .run();
  await deliverNotifications(env);
  assert.equal(messages.length, 3);
  assert.equal(
    (
      await db
        .prepare(`SELECT attempts FROM norby_notifications WHERE event_id='event-2'`)
        .first<{ attempts: number }>()
    )?.attempts,
    2,
  );

  await queue('event-3', 5);
  fail = true;
  await deliverNotifications(env);
  await db
    .prepare(`UPDATE norby_notifications SET next_attempt_at='2026-01-01' WHERE event_id='event-3'`)
    .run();
  await deliverNotifications(env);
  assert.equal(messages.length, 4);
  assert.equal(
    (
      await db
        .prepare(`SELECT attempts FROM norby_notifications WHERE event_id='event-3'`)
        .first<{ attempts: number }>()
    )?.attempts,
    6,
  );
});

test('auth mail uses the native binding with bilingual text, escaped HTML, and same-origin links', async () => {
  const messages: EmailMessageBuilder[] = [];
  const env = {
    BASE_URL: 'https://norby.example.test',
    MAIL_FROM: 'noreply@example.test',
    EMAIL: {
      async send(message: EmailMessage | EmailMessageBuilder) {
        assert.ok('subject' in message);
        messages.push(message);
        return { messageId: 'fake-auth-message' };
      },
    },
  };
  await sendAuthEmail(env, {
    to: 'alice@example.test',
    subject: '驗證電子郵件 · Verify your email <test>',
    url: 'https://norby.example.test/api/auth/verify-email?token=fixture&callbackURL=%2Fcases',
  });
  assert.equal(messages.length, 1);
  assert.match(messages[0].text!, /If you did not request this/);
  assert.match(messages[0].html!, /&lt;test&gt;/);
  assert.match(messages[0].html!, /fixture&amp;callbackURL/);
  await assert.rejects(
    sendAuthEmail(env, {
      to: 'alice@example.test',
      subject: 'test',
      url: 'https://other.example.test/reset',
    }),
    /INVALID_EMAIL_LINK/,
  );
  assert.equal(messages.length, 1);
});
