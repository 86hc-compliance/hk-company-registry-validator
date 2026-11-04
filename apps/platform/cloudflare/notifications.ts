import type { CaseStatus } from '../shared/domain.js';
import type { CloudflareEnv } from './env.js';
import { sendCaseNotification } from './mail.js';

type NotificationEnvironment = Pick<CloudflareEnv, 'DB' | 'EMAIL' | 'MAIL_FROM' | 'BASE_URL'>;
type NotificationClaim = { event_id: string; case_id: string; attempts: number };
type NotificationDetails = {
  id: string;
  reference: string;
  locale: 'en' | 'zh-Hant';
  status: CaseStatus;
  email: string;
};

/** Transactional outbox, with atomic claims across concurrent cron/request executions. */
export async function deliverNotifications(
  env: NotificationEnvironment,
  limit = 25,
): Promise<void> {
  if (!env.EMAIL || !env.MAIL_FROM) return;
  for (let index = 0; index < limit; index++) {
    const now = Date.now();
    const token = crypto.randomUUID();
    const row = await env.DB.prepare(
      `UPDATE norby_notifications
       SET lease_token=?, lease_expires_at=?, attempts=attempts+1,
           next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ', (? + 60000 * (1 << attempts))/1000.0, 'unixepoch')
       WHERE event_id=(
         SELECT event_id FROM norby_notifications
         WHERE sent_at IS NULL AND attempts<6 AND next_attempt_at<=?
           AND (lease_expires_at IS NULL OR lease_expires_at<=?)
         ORDER BY next_attempt_at,event_id LIMIT 1
       ) RETURNING event_id,case_id,attempts`,
    )
      .bind(token, now + 5 * 60_000, now, new Date(now).toISOString(), now)
      .first<NotificationClaim>();
    if (!row) break;
    try {
      const details = await env.DB.prepare(
        `SELECT c.id,c.reference,c.locale,c.status,u.email
         FROM norby_cases c JOIN "user" u ON u.id=c.owner_id WHERE c.id=?`,
      )
        .bind(row.case_id)
        .first<NotificationDetails>();
      if (!details) throw new Error('NOTIFICATION_RECIPIENT_UNAVAILABLE');
      await sendCaseNotification(env, {
        to: details.email,
        reference: details.reference,
        locale: details.locale,
        status: details.status,
        caseId: details.id,
        eventId: row.event_id,
      });
      await env.DB.prepare(
        `UPDATE norby_notifications SET sent_at=?,error=NULL,lease_token=NULL,lease_expires_at=NULL
         WHERE event_id=? AND lease_token=? AND sent_at IS NULL`,
      )
        .bind(new Date().toISOString(), row.event_id, token)
        .run();
    } catch {
      // Provider acceptance and the D1 commit cannot be one transaction: after a
      // crash, delivery may repeat. Never claim exactly-once email delivery.
      await env.DB.prepare(
        `UPDATE norby_notifications SET error='DELIVERY_FAILED',lease_token=NULL,lease_expires_at=NULL
         WHERE event_id=? AND lease_token=? AND sent_at IS NULL`,
      )
        .bind(row.event_id, token)
        .run();
    }
  }
}
