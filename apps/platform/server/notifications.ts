import { createTransport } from 'nodemailer';
import type Database from 'better-sqlite3';
import { config } from './config.js';
import { statusLabels, type CaseStatus } from '../shared/domain.js';

/** Transactional outbox: event and pending notice are written in the same case transaction. */
export function startNotifications(db: Database.Database) {
  if (!config.smtpUrl || !config.mailFrom) return () => {};
  const transport = createTransport(config.smtpUrl);
  let busy = false,
    stopped = false;
  const timer = setInterval(async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const row = db
        .prepare(
          `SELECT n.event_id,n.attempts,c.id,c.reference,c.locale,c.status,u.email FROM norby_notifications n JOIN norby_cases c ON c.id=n.case_id JOIN user u ON u.id=c.owner_id WHERE n.sent_at IS NULL AND n.attempts<6 AND n.next_attempt_at<=? ORDER BY n.next_attempt_at LIMIT 1`,
        )
        .get(new Date().toISOString()) as
        | {
            event_id: string;
            attempts: number;
            id: string;
            reference: string;
            locale: 'en' | 'zh-Hant';
            status: CaseStatus;
            email: string;
          }
        | undefined;
      if (!row) return;
      try {
        const en = row.locale === 'en';
        const subject = `Norby · ${row.reference} · ${statusLabels[row.status][en ? 1 : 0]}`;
        const text = `${subject}\n\n${en ? 'Your case has an update. Sign in to review the latest progress and any action required.' : '你的案件有更新。請登入查看最新進度與需要完成的事項。'}\n\n${config.baseUrl}/cases/${row.id}\n\nNorby`;
        await transport.sendMail({
          from: config.mailFrom,
          to: row.email,
          subject,
          text,
          messageId: `<${row.event_id}@${new URL(config.baseUrl).hostname}>`,
        });
        db.prepare(
          'UPDATE norby_notifications SET sent_at=?,attempts=attempts+1,error=NULL WHERE event_id=?',
        ).run(new Date().toISOString(), row.event_id);
      } catch {
        db.prepare(
          'UPDATE norby_notifications SET attempts=attempts+1,error=?,next_attempt_at=? WHERE event_id=?',
        ).run(
          'DELIVERY_FAILED',
          new Date(Date.now() + 60_000 * 2 ** row.attempts).toISOString(),
          row.event_id,
        );
      }
    } finally {
      busy = false;
    }
  }, 5000);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
    transport.close();
  };
}
