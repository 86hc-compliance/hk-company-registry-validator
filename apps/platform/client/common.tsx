import {
  createContext,
  useContext,
  useEffect,
  useState,
  useId,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from 'react';
import { createAuthClient } from 'better-auth/react';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';
import type { Locale, Price } from '../shared/domain';

export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });
export type User = { id: string; name: string; email: string; kind: 'staff' | 'customer' };
export type PublicConfig = {
  prices: Omit<Price, 'bank'>[];
  contactUrl: string;
  preview: boolean;
  emailVerificationRequired: boolean;
  tpsiConfigured: boolean;
  mcpUrl: string;
};
export const LocaleContext = createContext<Locale>('zh-Hant');
export function useT() {
  const locale = useContext(LocaleContext);
  return (zh: string, en: string) => (locale === 'en' ? en : zh);
}
export function useLocale() {
  return useContext(LocaleContext);
}
export class ApiError extends Error {
  constructor(
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (options.method && options.method !== 'GET')
    headers.set('Idempotency-Key', crypto.randomUUID());
  const response = await fetch(url, { ...options, headers });
  const value = await response.json();
  if (!response.ok) {
    const error = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    throw new ApiError(
      typeof error.error === 'string' ? error.error : 'REQUEST_FAILED',
      error.details,
    );
  }
  return value as T;
}
const errors: Record<string, [string, string]> = {
  AUTH_REQUIRED: ['請先登入。', 'Please sign in first.'],
  INVALID_EMAIL_OR_PASSWORD: ['電子郵件或密碼不正確。', 'Email or password is incorrect.'],
  VERSION_CONFLICT: [
    '案件已更新，請重新整理後再試。',
    'This case has changed. Refresh and try again.',
  ],
  CASE_LOCKED: [
    '目前階段已鎖定資料，請聯絡 Norby 補件。',
    'Information is locked at this stage. Contact Norby to request a change.',
  ],
  INCOMPLETE_APPLICATION: [
    '請先完成下方列出的資料。',
    'Complete the missing information listed below.',
  ],
  PRICE_NOT_CONFIGURED: [
    '此幣別尚未開放報價，請聯絡 Norby。',
    'Pricing is not yet available in this currency. Contact Norby.',
  ],
  TPSI_NOT_CONFIGURED: [
    '官方連線尚未啟用，Norby 將通知下一步。',
    'The Registry connection is not yet active. Norby will advise on next steps.',
  ],
  JOB_IN_PROGRESS: [
    '官方請求仍在處理中，請稍後重新整理。',
    'A Registry request is in progress. Refresh shortly.',
  ],
  INVALID_INPUT: ['請檢查欄位格式與必填資料。', 'Check required fields and their format.'],
  KYC_DOCUMENTS_REQUIRED: [
    '每位成員都需要身分證明及地址證明。',
    'Identity and address evidence is required for each person.',
  ],
  UNSUPPORTED_FILE_TYPE: [
    '請選擇 PDF、PNG 或 JPEG；證書僅接受 PDF。',
    'Choose PDF, PNG or JPEG. Certificates must be PDF.',
  ],
  LIMIT_FILE_SIZE: ['每份檔案不可超過 10 MB。', 'Each file must be 10 MB or smaller.'],
  DUPLICATE_REFERENCE: [
    '這筆交易編號已記錄，請核對後再試。',
    'This transaction reference is already recorded. Check it before retrying.',
  ],
  INVALID_STATE: ['案件狀態已改變，請重新整理。', 'The case status has changed. Please refresh.'],
  PAYMENT_AMOUNT_MISMATCH: [
    '實收金額必須與報價總額相符。',
    'Received funds must match the quoted total.',
  ],
  FULL_REFUND_REQUIRED: [
    '退款金額必須等於全額實收款。',
    'The refund must equal the full payment received.',
  ],
  CERTIFICATES_REQUIRED: ['請先上傳兩份正式證書。', 'Upload both official certificates first.'],
  REVIEW_CHECKS_REQUIRED: [
    '請完成四項人工核對並留下審核紀錄。',
    'Complete all four review checks and record a review note.',
  ],
  EMAIL_NOT_VERIFIED: ['請先驗證電子郵件。', 'Verify your email first.'],
  SIGNER_ACCOUNT_REQUIRED: [
    '請使用下一位簽署人本人的電子郵件登入。董事同意須依序完成，最後由創辦成員簽署。',
    'Sign in with the next signer’s own email. Complete director consents in order, then the founder signature.',
  ],
  SIGNING_NOT_READY: [
    '目前尚未輪到簽署，或本案已完成簽署。請查看案件進度。',
    'Signing is not ready or has already finished. Check the case progress.',
  ],
};
export function ErrorMessage({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  const code = error instanceof Error ? error.message : String(error);
  const label = errors[code];
  return (
    <div className="notice error" role="alert">
      {label
        ? t(...label)
        : t(
            '操作未完成，請檢查資料或稍後再試。',
            'The action could not be completed. Check the information or try again shortly.',
          )}{' '}
      <small>{code}</small>
    </div>
  );
}
export function useLoad<T>(url: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const reload = async () => {
    setError(undefined);
    setLoading(true);
    try {
      setData(await api<T>(url));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void reload();
  }, [url]);
  return { data, setData, error, loading, reload };
}
export function Loading() {
  const t = useT();
  return (
    <div className="loading" role="status">
      <LoaderCircle size={20} className="spin" />
      {t('載入中…', 'Loading…')}
    </div>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string; 'aria-describedby'?: string }>, {
            id,
            'aria-describedby': hint ? `${id}-hint` : undefined,
          })
        : children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-link">
      {children}
      <ArrowUpRight size={15} />
    </a>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-mark">↗</span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
