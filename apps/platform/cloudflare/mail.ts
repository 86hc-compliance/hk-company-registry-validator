import { requireCondition, statusLabels, type CaseStatus } from '../shared/domain.js';
import type { CloudflareEnv } from './env.js';

type MailEnvironment = Pick<CloudflareEnv, 'EMAIL' | 'MAIL_FROM' | 'BASE_URL'>;
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
function sender(env: MailEnvironment) {
  const value = env.MAIL_FROM?.trim();
  requireCondition(env.EMAIL && value && !/[\r\n]/.test(value), 'MAIL_NOT_CONFIGURED', 503);
  const named = value.match(/^([^<>]+)<([^<>]+)>$/);
  return named ? { name: named[1].trim().replace(/^"|"$/g, ''), email: named[2].trim() } : value;
}
const htmlMessage = (subject: string, message: string, url: string) =>
  `<html><body><p>Norby</p><h1>${escapeHtml(subject)}</h1><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p></body></html>`;

export async function sendAuthEmail(
  env: MailEnvironment,
  { to, subject, url }: { to: string; subject: string; url: string },
): Promise<void> {
  const destination = new URL(url);
  requireCondition(
    destination.origin === new URL(env.BASE_URL).origin &&
      ['http:', 'https:'].includes(destination.protocol),
    'INVALID_EMAIL_LINK',
  );
  const message =
    '如果不是你提出的要求，請忽略此信。 If you did not request this, ignore this email.';
  const from = sender(env);
  await env.EMAIL.send({
    from,
    to,
    subject,
    text: `Norby\n\n${subject}\n${url}\n\n${message}`,
    html: htmlMessage(subject, message, url),
    headers: { 'Auto-Submitted': 'auto-generated' },
  });
}

export async function sendCaseNotification(
  env: MailEnvironment,
  notification: {
    to: string;
    reference: string;
    locale: 'en' | 'zh-Hant';
    status: CaseStatus;
    caseId: string;
    eventId: string;
  },
): Promise<void> {
  const en = notification.locale === 'en';
  const subject = `Norby · ${notification.reference} · ${statusLabels[notification.status][en ? 1 : 0]}`;
  const message = en
    ? 'Your case has an update. Sign in to review the latest progress and any action required.'
    : '你的案件有更新。請登入查看最新進度與需要完成的事項。';
  const url = new URL(`/cases/${encodeURIComponent(notification.caseId)}`, env.BASE_URL).href;
  const from = sender(env);
  await env.EMAIL.send({
    from,
    to: notification.to,
    subject,
    text: `${subject}\n\n${message}\n\n${url}\n\nNorby`,
    html: htmlMessage(subject, message, url),
    // Cloudflare owns Message-ID; an application header provides safe correlation.
    headers: { 'Auto-Submitted': 'auto-generated', 'X-Norby-Event': notification.eventId },
  });
}
