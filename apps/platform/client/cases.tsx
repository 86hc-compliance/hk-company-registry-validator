import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  ArrowLeft,
  Plus,
  FileText,
  Upload,
  Download,
  Check,
  Clock3,
  RefreshCw,
  Search,
  ShieldCheck,
  CircleDot,
  Wallet,
  Link2,
} from 'lucide-react';
import {
  type CaseView,
  type Currency,
  type FileKind,
  type CaseStatus,
  formatMoney,
  statusLabels,
  currencies,
  minorUnits,
} from '../shared/domain';
import {
  api,
  ErrorMessage,
  Field,
  Empty,
  Loading,
  useLoad,
  useLocale,
  useT,
  type User,
  type PublicConfig,
} from './common';
import { ApplicationEditor, issueLabel } from './editor';

export function Status({ status }: { status: CaseStatus }) {
  const t = useT();
  return (
    <span className={`status status-${status}`}>
      <span />
      {t(...statusLabels[status])}
    </span>
  );
}
export function CaseList({ user, config }: { user: User; config?: PublicConfig }) {
  const t = useT(),
    locale = useLocale();
  const { data, error } = useLoad<CaseView[]>('/api/cases');
  const [newCase, setNewCase] = useState(false),
    [currency, setCurrency] = useState<Currency>('HKD'),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>();
  const create = async () => {
    setBusy(true);
    try {
      const c = await api<CaseView>('/api/cases', {
        method: 'POST',
        body: JSON.stringify({ locale, currency }),
      });
      location.assign(`/cases/${c.id}`);
    } catch (e) {
      setFailure(e);
      setBusy(false);
    }
  };
  const rows = data?.filter((c) =>
    `${c.reference} ${c.data.englishName} ${c.data.chineseName}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="container section workspace">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('每一步，都看得見', 'EVERY STEP, IN VIEW')}</div>
          <h1>
            {t(
              user.kind === 'staff' ? 'Norby 案件工作台' : '你的事業，正在開始。',
              user.kind === 'staff' ? 'Your case workspace.' : 'Your next chapter is taking shape.',
            )}
          </h1>
          <p>
            {t(
              `你好，${user.name}。${user.kind === 'staff' ? '從收款確認到正式交付，在這裡推進案件。' : '從這裡繼續準備，或查看案件最新進度。'}`,
              `Hello, ${user.name}. ${user.kind === 'staff' ? 'Move cases from payment confirmation to final delivery.' : 'Pick up where you left off or check your latest progress.'}`,
            )}
          </p>
        </div>
        <button className="button" onClick={() => setNewCase(!newCase)}>
          <Plus size={18} />
          {t('新增申請', 'New application')}
        </button>
      </div>
      <ErrorMessage error={error || failure} />
      {newCase && (
        <div className="panel new-case">
          <div>
            <h3>{t('從一份新申請開始', 'Start a new application')}</h3>
            <p>
              {t(
                '選擇付款幣別，稍後會提供該幣別的固定報價。',
                'Choose a payment currency. You will receive its fixed, itemized quote before paying.',
              )}
            </p>
          </div>
          <Field label={t('付款幣別', 'Payment currency')}>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <button className="button" disabled={busy} onClick={create}>
            {t('建立草稿', 'Create draft')}
            <ArrowRight size={17} />
          </button>
        </div>
      )}
      <div className="workspace-toolbar">
        <h2>
          {t('案件一覽', 'Your cases')} {data && <span className="count">{data.length}</span>}
        </h2>
        <label className="search">
          <Search size={17} />
          <input
            aria-label={t('搜尋案件', 'Search cases')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('公司名稱或案件編號', 'Company name or reference')}
          />
        </label>
      </div>
      {!data && !error ? (
        <Loading />
      ) : rows?.length ? (
        <div className="case-table">
          <div className="case-table-head">
            <span>{t('公司／案件', 'Company / case')}</span>
            <span>{t('目前進度', 'Current stage')}</span>
            <span>{t('更新日期', 'Updated')}</span>
            <span />
          </div>
          {rows.map((c) => (
            <a href={`/cases/${c.id}`} key={c.id} className="case-row">
              <div className="case-identity">
                <span className="case-monogram">{c.data.englishName?.charAt(0) || 'N'}</span>
                <div>
                  <h3>
                    {c.data.englishName ||
                      c.data.chineseName ||
                      t('尚未命名的公司', 'Your future company')}
                  </h3>
                  <small>
                    {c.reference} · {c.currency}
                  </small>
                </div>
              </div>
              <Status status={c.status} />
              <span className="date">{new Date(c.updatedAt).toLocaleDateString(locale)}</span>
              <ArrowUpRight size={19} />
            </a>
          ))}
        </div>
      ) : (
        <Empty
          title={
            query
              ? t('沒有符合的案件', 'No matching cases')
              : t('每個事業，都從第一步開始。', 'Every business starts with a first step.')
          }
        >
          <p>
            {query
              ? t('試試其他名稱或案件編號。', 'Try another company name or reference.')
              : t(
                  '建立你的第一份公司設立申請，資料可以分次完成。',
                  'Create your first incorporation application. You can fill it in at your own pace.',
                )}
          </p>
          {!query && (
            <button className="button" onClick={() => setNewCase(true)}>
              {t('開始第一份申請', 'Start your first application')}
              <ArrowUpRight size={17} />
            </button>
          )}
        </Empty>
      )}
      <aside className="workspace-tip">
        <Link2 size={22} />
        <div>
          <h3>{t('已經有一起工作的 AI 助手？', 'Already working with an AI assistant?')}</h3>
          <p>
            {t(
              '授權你的代理協助備料，案件仍會出現在這裡。',
              'Authorize your agent to prepare information. Your case will appear right here.',
            )}
          </p>
        </div>
        <a className="text-link" href="/connections">
          {t('管理代理授權', 'Manage connections')}
          <ArrowRight size={17} />
        </a>
      </aside>
      {config && !config.tpsiConfigured && user.kind === 'staff' && (
        <div className="notice">
          {t(
            'TPSI 尚未啟用。可完成收件與人工審核，官方驗證、簽署及提交需完成連線設定。',
            'TPSI is not enabled. Intake and manual review are available; Registry validation, signatures and submission require connection setup.',
          )}
        </div>
      )}
    </section>
  );
}
const nextSteps: Record<CaseStatus, [string, string]> = {
  draft: [
    '完成公司與成員資料，準備證明文件。',
    'Complete company and member information and prepare your documents.',
  ],
  awaiting_payment: [
    '依照報價轉帳，上傳憑證後通知 Norby。',
    'Make a bank transfer, upload proof and notify Norby.',
  ],
  payment_check: [
    'Norby 正在核對入帳，上傳憑證不代表已完成付款。',
    'Norby is checking the deposit. Uploading proof does not confirm payment.',
  ],
  under_review: [
    'Norby 正在人工審核。若需要更多資料，會在這裡提出。',
    'Norby is reviewing your information and will request anything else here.',
  ],
  needs_information: [
    '查看 Norby 的補件說明，更新資料後重新送審。',
    'Read the request from Norby, update your information and resubmit.',
  ],
  awaiting_signatures: [
    '準備官方個人帳戶，依序完成董事同意與創辦成員簽署。',
    'Prepare Registry accounts and complete director consent and founder signatures in order.',
  ],
  ready_to_submit: [
    '簽署已核實，等待 Norby 正式提交。',
    'Signatures are verified. Norby can now file the application.',
  ],
  submitting: ['正式提交處理中，請勿重複送出。', 'Filing is in progress. Do not submit again.'],
  submitted: [
    '已收到提交回執。成立結果與正式證書仍待確認。',
    'A filing receipt has been received. Incorporation and official certificates are still pending.',
  ],
  needs_correction: [
    '註冊處要求補正，Norby 將協助處理。',
    'The Registry has requested a correction. Norby will assist.',
  ],
  verification_required: [
    '官方結果須由 Norby 核對，不能將空白結果當成成立。',
    'Norby needs to reconcile the official result. An empty response does not confirm incorporation.',
  ],
  completed: [
    '你的公司已成立，正式文件可在下方下載。',
    'Your company is incorporated. Download your official documents below.',
  ],
  refund_pending: [
    '審核未通過，Norby 將安排全額退還實收款。',
    'The review was declined. Norby will arrange a full refund of the received payment.',
  ],
  refunded: [
    'Norby 已確認全額退款，交易紀錄可在付款頁查看。',
    'Norby has confirmed the full refund. View the transaction on the payment tab.',
  ],
};
export function CasePage({ id, user, config }: { id: string; user: User; config?: PublicConfig }) {
  const t = useT(),
    locale = useLocale();
  const { data: c, setData, error, reload } = useLoad<CaseView>(`/api/cases/${id}`);
  const [tab, setTab] = useState('overview'),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>();
  const action = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!c) return;
    setBusy(true);
    setFailure(undefined);
    try {
      setData(
        await api<CaseView>(`/api/cases/${id}/actions`, {
          method: 'POST',
          body: JSON.stringify({ action, version: c.version, ...extra }),
        }),
      );
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  };
  if (!c)
    return (
      <section className="container section">
        <ErrorMessage error={error} />
        {!error && <Loading />}
      </section>
    );
  const steps = [
    t('準備資料', 'Prepare'),
    t('付款確認', 'Payment'),
    t('人工審核', 'Review'),
    t('簽署提交', 'Sign & file'),
    t('成立交付', 'Delivery'),
  ];
  const step =
    c.status === 'draft'
      ? 0
      : ['awaiting_payment', 'payment_check'].includes(c.status)
        ? 1
        : ['under_review', 'needs_information', 'refund_pending', 'refunded'].includes(c.status)
          ? 2
          : ['awaiting_signatures', 'ready_to_submit', 'submitting'].includes(c.status)
            ? 3
            : 4;
  return (
    <section className="container case-workspace">
      <a className="back-link" href="/cases">
        <ArrowLeft size={16} />
        {t('全部案件', 'All cases')}
      </a>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{c.reference}</div>
          <h1>{c.data.englishName || c.data.chineseName || t('你的新公司', 'Your new company')}</h1>
          {c.data.englishName && c.data.chineseName && <p>{c.data.chineseName}</p>}
        </div>
        <Status status={c.status} />
      </div>
      <div className="case-layout">
        <aside className="case-sidebar">
          <ol className="vertical-steps">
            {steps.map((label, i) => (
              <li key={label} className={i === step ? 'current' : i < step ? 'done' : ''}>
                <span>{i < step ? <Check size={15} /> : i + 1}</span>
                <div>
                  <strong>{label}</strong>
                  {i === step && <small>{t('目前階段', 'You are here')}</small>}
                </div>
              </li>
            ))}
          </ol>
          <div className="sidebar-support">
            <ShieldCheck size={23} />
            <h3>{t('Norby 與你一起', 'Norby is here to help')}</h3>
            <p>
              {t(
                '資料有疑問？先儲存草稿，讓我們協助你確認。',
                'Unsure about a detail? Save your draft and let us help.',
              )}
            </p>
            {config?.contactUrl && (
              <a className="text-link" href={config.contactUrl} target="_blank" rel="noreferrer">
                {t('聯絡 Norby', 'Contact Norby')}
                <ArrowUpRight size={15} />
              </a>
            )}
          </div>
        </aside>
        <div className="case-main">
          <nav className="tabs" aria-label={t('案件內容', 'Case sections')}>
            {[
              ['overview', t('進度總覽', 'Overview')],
              ['application', t('申請資料', 'Application')],
              ['documents', t('文件', 'Documents')],
              ['payment', t('報價與付款', 'Quote & payment')],
            ].map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? 'selected' : ''}
                onClick={() => setTab(key)}
                aria-current={tab === key ? 'page' : undefined}
              >
                {label}
              </button>
            ))}
          </nav>
          <ErrorMessage error={failure || error} />
          {tab === 'overview' && (
            <>
              <div className="next-step">
                <div className="eyebrow">
                  <CircleDot size={14} />
                  {t('現在，接著做', 'YOUR NEXT STEP')}
                </div>
                <h2>{t(...statusLabels[c.status])}</h2>
                <p>{t(...nextSteps[c.status])}</p>
                <div className="actions">
                  {['draft', 'needs_information'].includes(c.status) && (
                    <button className="button" onClick={() => setTab('application')}>
                      {t('繼續準備資料', 'Continue application')}
                      <ArrowRight size={17} />
                    </button>
                  )}
                  {['awaiting_payment', 'payment_check'].includes(c.status) && (
                    <button className="button" onClick={() => setTab('payment')}>
                      {t('查看付款資訊', 'View payment details')}
                      <ArrowRight size={17} />
                    </button>
                  )}
                  {c.status === 'completed' && (
                    <button className="button" onClick={() => setTab('documents')}>
                      {t('下載成立文件', 'Download certificates')}
                      <Download size={17} />
                    </button>
                  )}
                  <button className="text-button" disabled={busy} onClick={reload}>
                    <RefreshCw size={15} />
                    {t('更新進度', 'Refresh')}
                  </button>
                </div>
              </div>
              {c.status === 'needs_information' && (
                <div className="notice">
                  <strong>{t('Norby 的補件說明', 'Information requested by Norby')}</strong>
                  <p>{c.events.find((e) => e.action === 'request_information')?.note}</p>
                  <button
                    className="button secondary"
                    disabled={busy || c.issues.length > 0}
                    onClick={() => action('resubmit')}
                  >
                    {t('資料已補齊，重新送審', 'Information updated — resubmit')}
                  </button>
                </div>
              )}
              {c.status === 'awaiting_signatures' && (
                <div className="panel">
                  <h3>{t('官方帳戶與簽署', 'Registry accounts & signatures')}</h3>
                  <p>
                    {t(
                      '每位簽署人需使用自己的官方個人帳戶。Norby 會協助登記與核實。請勿將官方密碼傳給 AI 代理。',
                      'Each signer uses their own Registry account. Norby will help with registration and verification. Do not share Registry passwords with AI agents.',
                    )}
                  </p>
                  {c.signingReady ? (
                    <a className="button secondary" href={`/sign/${c.id}`}>
                      {t('前往本人簽署', 'Review and sign')}
                      <ArrowRight size={17} />
                    </a>
                  ) : (
                    <button
                      className="button secondary"
                      disabled={busy || !config?.tpsiConfigured}
                      onClick={() => action('queue_validation')}
                    >
                      {t('開始官方資料驗證', 'Start Registry validation')}
                    </button>
                  )}
                  {!config?.tpsiConfigured && (
                    <p className="muted">
                      {t(
                        '官方連線尚未啟用。Norby 將通知簽署安排。',
                        'The Registry connection is not active yet. Norby will advise on signing arrangements.',
                      )}
                    </p>
                  )}
                </div>
              )}
              {c.issues.length > 0 && c.status === 'draft' && (
                <div className="panel">
                  <h3>{t('還需要準備', 'Still to prepare')}</h3>
                  <ul className="missing-list">
                    {c.issues.map((x, i) => (
                      <li key={`${x}-${i}`}>{issueLabel(x, t)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {user.kind === 'staff' && (
                <StaffActions
                  key={`${c.id}:${c.status}`}
                  c={c}
                  busy={busy}
                  action={action}
                  config={config}
                />
              )}
              <div className="section-heading small-heading">
                <h2>{t('案件紀錄', 'Case activity')}</h2>
                <small>{t('依最新時間排序', 'Most recent first')}</small>
              </div>
              <ol className="timeline">
                {c.events.map((e) => (
                  <li key={e.id}>
                    <span className="timeline-dot" />
                    <div>
                      <strong>{eventLabel(e.action, t)}</strong>
                      <small>
                        {new Date(e.createdAt).toLocaleString(locale)} ·{' '}
                        {e.actorKind === 'staff'
                          ? 'Norby'
                          : e.actorKind === 'agent'
                            ? t('已授權代理', 'Authorized agent')
                            : e.actorKind === 'system'
                              ? t('系統', 'System')
                              : t('客戶', 'Customer')}
                      </small>
                      {e.note && <p>{eventNote(e.action, e.note, t)}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
          {tab === 'application' && <ApplicationEditor key={id} c={c} onSaved={setData} />}
          {tab === 'documents' && <Documents c={c} user={user} onSaved={setData} />}
          {tab === 'payment' && <Payment c={c} busy={busy} action={action} config={config} />}
        </div>
      </div>
    </section>
  );
}
const kinds: Record<FileKind, [string, string]> = {
  identity: ['身分證明', 'Identity document'],
  address: ['地址證明', 'Address evidence'],
  supporting: ['補充文件', 'Supporting document'],
  payment_proof: ['轉帳憑證', 'Transfer proof'],
  ci: ['公司註冊證明書', 'Certificate of Incorporation'],
  br: ['商業登記證', 'Business Registration Certificate'],
  registry_receipt: ['官方提交／扣款回執', 'Registry filing / debit receipt'],
};
function Documents({
  c,
  user,
  onSaved,
}: {
  c: CaseView;
  user: User;
  onSaved: (c: CaseView) => void;
}) {
  const t = useT();
  const [kind, setKind] = useState<FileKind>('identity'),
    [personId, setPersonId] = useState(c.data.people[0]?.id || ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const cert = ['submitted', 'verification_required'].includes(c.status) && user.kind === 'staff';
  const editable =
    ['draft', 'awaiting_payment', 'payment_check', 'under_review', 'needs_information'].includes(
      c.status,
    ) || cert;
  const upload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = new FormData(form);
    setBusy(true);
    setError(undefined);
    try {
      onSaved(await api<CaseView>(`/api/cases/${c.id}/files`, { method: 'POST', body }));
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2>{t('每份文件，妥善就位。', 'Every document, in place.')}</h2>
      <p className="muted">
        {t(
          '每位成員各需身分證明及地址證明。支援 PDF、PNG、JPEG，每份最多 10 MB。',
          'Each member needs identity and address evidence. PDF, PNG and JPEG, up to 10 MB per file.',
        )}
      </p>
      <ErrorMessage error={error} />
      {editable && (
        <form className="upload-panel" onSubmit={upload}>
          <div className="form-grid">
            <Field label={t('文件類型', 'Document type')}>
              <select
                name="kind"
                value={
                  cert ? (['ci', 'br', 'registry_receipt'].includes(kind) ? kind : 'ci') : kind
                }
                onChange={(e) => setKind(e.target.value as FileKind)}
              >
                {(cert
                  ? ['ci', 'br', 'registry_receipt']
                  : ['identity', 'address', 'supporting', 'payment_proof']
                ).map((k) => (
                  <option key={k} value={k}>
                    {t(...kinds[k as FileKind])}
                  </option>
                ))}
              </select>
            </Field>
            {!cert && ['identity', 'address'].includes(kind) && (
              <Field label={t('所屬成員', 'Member')}>
                <select
                  name="personId"
                  required
                  value={personId}
                  onChange={(e) => setPersonId(e.target.value)}
                >
                  <option value="">{t('選擇成員', 'Select a member')}</option>
                  {c.data.people.map((p, i) => (
                    <option key={p.id} value={p.id}>
                      {p.surname} {p.givenName} {!p.surname && `${i + 1}`}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <label className="file-input">
            <Upload size={24} />
            <strong>{t('選擇要上傳的文件', 'Choose a document to upload')}</strong>
            <input
              name="file"
              type="file"
              required
              accept={cert ? 'application/pdf' : 'application/pdf,image/png,image/jpeg'}
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? t('上傳中…', 'Uploading…') : t('上傳文件', 'Upload document')}
            <Upload size={17} />
          </button>
        </form>
      )}
      {!c.files.length ? (
        <Empty title={t('文件會集中在這裡', 'Your documents will live here')}>
          <p>
            {t(
              '先新增公司成員，再上傳各自的證明文件。',
              'Add your company members, then upload their evidence.',
            )}
          </p>
        </Empty>
      ) : (
        <div className="file-list">
          {c.files.map((f) => (
            <div className="file-row" key={f.id}>
              <FileText size={24} />
              <div>
                <h3>{t(...kinds[f.kind])}</h3>
                <p>
                  {f.name} · {Math.max(1, Math.round(f.size / 1024))} KB
                  {f.personId &&
                    ` · ${c.data.people.find((p) => p.id === f.personId)?.surname || ''}`}
                </p>
              </div>
              <a
                className="icon-button"
                href={`/api/cases/${c.id}/files/${f.id}`}
                aria-label={`${t('下載', 'Download')} ${f.name}`}
              >
                <Download size={19} />
              </a>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
function Payment({
  c,
  busy,
  action,
  config,
}: {
  c: CaseView;
  busy: boolean;
  action: (s: string, v?: Record<string, unknown>) => Promise<void>;
  config?: PublicConfig;
}) {
  const t = useT(),
    locale = useLocale();
  const [terms, setTerms] = useState(false),
    [reference, setReference] = useState('');
  const price = config?.prices.find((p) => p.currency === c.currency);
  const base = price ? price.service + price.government : 0;
  const q =
    c.quote ||
    (price
      ? {
          ...price,
          tax: c.currency === 'TWD' ? Number((BigInt(base) * 5n + 50n) / 100n) : 0,
          total: base + (c.currency === 'TWD' ? Number((BigInt(base) * 5n + 50n) / 100n) : 0),
          entity: c.currency === 'TWD' ? 'TW' : 'HK',
        }
      : null);
  return (
    <>
      <h2>{t('清楚的費用，安心的下一步。', 'A clear quote for your next step.')}</h2>
      <p className="muted">
        {t(
          '服務費、代收政府費與稅額分項列示。每個幣別採獨立固定價格。',
          'Service, collected government fees and tax are itemized. Each currency uses a fixed price.',
        )}
      </p>
      {q ? (
        <div className="quote-panel">
          <div className="quote-heading">
            <span>{t('公司設立完整方案', 'Company formation package')}</span>
            <strong>{q.currency}</strong>
          </div>
          {[
            [
              t(
                '設立＋首年秘書＋首年註冊地址',
                'Formation + first-year secretary + registered address',
              ),
              q.service,
            ],
            [t('代收政府費用', 'Collected government fees'), q.government],
            ...(q.currency === 'TWD'
              ? [
                  [
                    t('營業稅 5%（服務費＋政府費）', '5% business tax (service + government fees)'),
                    q.tax,
                  ],
                ]
              : []),
          ].map(([label, value]) => (
            <div className="quote-line" key={label}>
              <span>{label}</span>
              <strong>{formatMoney(Number(value), q.currency, locale)}</strong>
            </div>
          ))}
          <div className="quote-total">
            <span>{t('應付總額', 'Total due')}</span>
            <strong>{formatMoney(q.total, q.currency, locale)}</strong>
          </div>
          <small>
            {t(
              q.entity === 'TW' ? '由台灣公司收款' : '由香港公司收款',
              q.entity === 'TW'
                ? 'Collected by the Taiwan entity'
                : 'Collected by the Hong Kong entity',
            )}{' '}
            · {t('報價版本', 'Quote version')} {q.version}
          </small>
        </div>
      ) : (
        <div className="notice">
          {t(
            '此幣別的正式報價尚未設定。Norby 完成報價後即可繼續。',
            'Pricing in this currency has not been configured. Continue when Norby makes the quote available.',
          )}
        </div>
      )}
      {c.status === 'draft' && (
        <div className="panel">
          <h3>{t('確認服務範圍', 'Confirm your service scope')}</h3>
          <p>
            {t(
              '包含香港私人公司設立、首年公司秘書與註冊地址。銀行與 Stripe 另行諮詢。若 Norby 在正式提交前拒絕審核，將全額退還實收款；其他取消或提交後退款須由 Norby 個別處理。',
              'Includes private company incorporation, first-year secretary and registered address. Banking and Stripe are separate consultations. If Norby declines the review before official filing, the full received payment is refunded. Other cancellations and post-filing refunds require individual review.',
            )}
          </p>
          <label className="checkbox">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            {t(
              '我已核對資料、報價及上述服務與退款範圍。',
              'I have reviewed the information, quote, service scope and refund conditions.',
            )}
          </label>
          {c.issues.length > 0 && (
            <p className="inline-error">
              {t(
                '請先完成申請資料並儲存，再確認報價。',
                'Complete and save the application information before accepting the quote.',
              )}
            </p>
          )}
          <button
            className="button"
            disabled={busy || !terms || !q || c.issues.length > 0}
            onClick={() => action('checkout', { checks: ['service_terms'] })}
          >
            {t('確認報價，取得轉帳資訊', 'Accept quote & get bank details')}
            <ArrowRight size={17} />
          </button>
        </div>
      )}
      {c.quote && (
        <div className="panel">
          <h3>
            <Wallet size={20} />
            {t('銀行轉帳資訊', 'Bank transfer details')}
          </h3>
          <dl className="details">
            {[
              [t('收款公司', 'Beneficiary'), c.quote.bank.company],
              [t('銀行', 'Bank'), c.quote.bank.bank],
              [t('帳號', 'Account'), c.quote.bank.account],
              ['SWIFT', c.quote.bank.swift],
              [t('轉帳備註', 'Payment reference'), c.reference],
            ]
              .filter((x) => x[1])
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          {c.quote.bank.instructions && <p>{c.quote.bank.instructions}</p>}
          {c.status === 'awaiting_payment' && (
            <>
              <p>
                {t(
                  '請在「文件」上傳轉帳憑證，再填寫交易編號通知 Norby。',
                  'Upload transfer proof in Documents, then enter the transaction reference to notify Norby.',
                )}
              </p>
              <Field label={t('銀行交易編號', 'Bank transaction reference')}>
                <input
                  value={reference}
                  maxLength={100}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
              <button
                className="button"
                disabled={
                  busy ||
                  reference.trim().length < 3 ||
                  !c.files.some((f) => f.kind === 'payment_proof')
                }
                onClick={() => action('report_payment', { reference })}
              >
                {t('已轉帳，通知 Norby 核對', 'Transfer sent — notify Norby')}
              </button>
            </>
          )}
        </div>
      )}
      <h3 className="subheading">{t('收支紀錄', 'Transaction records')}</h3>
      {!c.ledger.length ? (
        <p className="muted">{t('尚無已確認的款項。', 'No payments have been confirmed.')}</p>
      ) : (
        c.ledger.map((l) => (
          <div key={l.id} className="ledger-row">
            <div>
              <strong>
                {l.kind === 'customer_payment'
                  ? t('客戶付款', 'Customer payment')
                  : l.kind === 'customer_refund'
                    ? t('客戶全額退款', 'Full customer refund')
                    : t('政府預付款帳戶扣款', 'Government deposit debit')}
              </strong>
              <small>
                {l.entity} · {l.reference}
              </small>
            </div>
            <strong>{formatMoney(l.amount, l.currency, locale)}</strong>
          </div>
        ))
      )}
      <p className="muted small-text">
        {t(
          '客戶付款與 Norby 的政府預付款帳戶扣款分開記錄。',
          'Customer payments and Norby’s Registry deposit debits are recorded separately.',
        )}
      </p>
    </>
  );
}
function StaffActions({
  c,
  busy,
  action,
  config,
}: {
  c: CaseView;
  busy: boolean;
  action: (s: string, v?: Record<string, unknown>) => Promise<void>;
  config?: PublicConfig;
}) {
  const t = useT();
  const [note, setNote] = useState(''),
    [reference, setReference] = useState(''),
    [amount, setAmount] = useState(''),
    [brn, setBrn] = useState(''),
    [registryCaseNo, setRegistryCaseNo] = useState(c.registryCaseNo || ''),
    [checks, setChecks] = useState<string[]>([]),
    [error, setError] = useState<unknown>();
  const reconcile =
    c.status === 'verification_required' && !c.ledger.some((l) => l.kind === 'government_debit');
  const pay = ['awaiting_payment', 'payment_check', 'refund_pending'].includes(c.status),
    review = [
      'under_review',
      'needs_information',
      'awaiting_signatures',
      'ready_to_submit',
    ].includes(c.status),
    complete = ['submitted', 'verification_required'].includes(c.status) && !reconcile;
  const act = (name: string) => {
    try {
      setError(undefined);
      void action(name, {
        note,
        reference,
        checks,
        ...(pay || reconcile ? { amount: minorUnits(amount, reconcile ? 'HKD' : c.currency) } : {}),
        ...(name === 'complete'
          ? { brn, registryCaseNo }
          : name === 'reconcile_submission'
            ? { registryCaseNo }
            : {}),
      });
    } catch (e) {
      setError(e);
    }
  };
  return (
    <section className="staff-panel">
      <div className="eyebrow">
        <ShieldCheck size={15} />
        {t('Norby 營運操作', 'NORBY OPERATIONS')}
      </div>
      <ErrorMessage error={error} />
      {pay && (
        <>
          <div className="form-grid">
            <Field
              label={
                t(
                  c.status === 'refund_pending' ? '實際退款金額' : '實際入帳金額',
                  c.status === 'refund_pending' ? 'Amount refunded' : 'Amount received',
                ) + ` (${c.currency})`
              }
            >
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label={t('銀行交易編號', 'Bank transaction reference')}>
              <input
                value={reference}
                maxLength={100}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          </div>
          <p className="muted">
            {t(
              '請先核對銀行實際交易。點擊後會建立不可重複的款項紀錄。',
              'Verify the actual bank transaction first. Confirmation creates a unique ledger record.',
            )}
          </p>
          <button
            className="button"
            disabled={busy || !amount || reference.length < 3}
            onClick={() =>
              act(c.status === 'refund_pending' ? 'confirm_refund' : 'confirm_payment')
            }
          >
            {c.status === 'refund_pending'
              ? t('確認已全額退款', 'Confirm full refund sent')
              : t('確認實際入帳', 'Confirm funds received')}
          </button>
        </>
      )}
      {(review || complete || reconcile) && (
        <Field
          label={t(
            '審核／核對紀錄（客戶可見）',
            'Review / verification note (visible to customer)',
          )}
        >
          <textarea
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
        </Field>
      )}
      {c.status === 'under_review' && (
        <div className="review-checks">
          {[
            ['identity', t('身分及證明文件已核實', 'Identity and evidence checked')],
            ['beneficial_owners', t('實益擁有人已核實', 'Beneficial owners checked')],
            [
              'business_purpose',
              t('業務目的與資金來源已核實', 'Purpose and source of funds checked'),
            ],
            [
              'screening',
              t('已完成制裁／PEP 等必要篩查', 'Required sanctions / PEP screening completed'),
            ],
          ].map(([value, label]) => (
            <label className="checkbox" key={value}>
              <input
                type="checkbox"
                checked={checks.includes(value)}
                onChange={(e) =>
                  setChecks(
                    e.target.checked ? [...checks, value] : checks.filter((x) => x !== value),
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
      )}
      <div className="actions">
        {c.status === 'under_review' && (
          <button
            className="button"
            disabled={busy || checks.length !== 4 || !note.trim()}
            onClick={() => act('approve')}
          >
            {t('人工審核通過', 'Approve review')}
          </button>
        )}
        {['under_review', 'awaiting_signatures', 'ready_to_submit'].includes(c.status) && (
          <button
            className="button secondary"
            disabled={busy || !note.trim()}
            onClick={() => act('request_information')}
          >
            {t('要求補件', 'Request information')}
          </button>
        )}
        {review && (
          <button
            className="button secondary danger"
            disabled={busy || !note.trim()}
            onClick={() => act('reject')}
          >
            {t('拒絕審核並啟動全額退款', 'Decline review & start full refund')}
          </button>
        )}
        {c.status === 'ready_to_submit' && (
          <button
            className="button"
            disabled={busy || !config?.tpsiConfigured}
            onClick={() => act('queue_submission')}
          >
            {t('正式提交（將扣政府費）', 'File officially (government debit)')}
          </button>
        )}
        {['submitted', 'verification_required', 'needs_correction'].includes(c.status) && (
          <button
            className="button secondary"
            disabled={busy || !c.registryCaseNo || !config?.tpsiConfigured}
            onClick={() => act('queue_status')}
          >
            {t('查詢官方進度', 'Query Registry status')}
          </button>
        )}
      </div>
      {reconcile && (
        <>
          <p className="muted">
            {t(
              '先從官方平台核對是否提交及扣款，取得並上傳「官方提交／扣款回執」。結果未確認前不能重送或完成交付。',
              'Check filing and debit records on the Registry portal and upload the official receipt. Do not resubmit or deliver while the result is uncertain.',
            )}
          </p>
          <div className="form-grid">
            <Field label={t('實際政府扣款（HKD）', 'Actual government debit (HKD)')}>
              <input
                value={amount}
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label={t('官方付款參考編號', 'Registry payment reference')}>
              <input value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field label={t('官方案件編號', 'Registry case number')}>
              <input value={registryCaseNo} onChange={(e) => setRegistryCaseNo(e.target.value)} />
            </Field>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={checks.includes('registry_receipt_verified')}
              onChange={(e) => setChecks(e.target.checked ? ['registry_receipt_verified'] : [])}
            />
            {t(
              '已核對正式提交、實際扣款及上傳的官方回執。',
              'I verified the filing, actual debit and uploaded official receipt.',
            )}
          </label>
          <button
            className="button"
            disabled={
              busy ||
              !note ||
              !amount ||
              !registryCaseNo ||
              reference.length < 3 ||
              !checks.includes('registry_receipt_verified') ||
              !c.files.some((f) => f.kind === 'registry_receipt')
            }
            onClick={() => act('reconcile_submission')}
          >
            {t('記錄核對結果與政府扣款', 'Record reconciled filing & debit')}
          </button>
        </>
      )}
      {complete && (
        <>
          <div className="form-grid">
            <Field label={t('8 位數商業登記號碼', '8-digit Business Registration Number')}>
              <input
                value={brn}
                maxLength={8}
                pattern="[0-9]{8}"
                onChange={(e) => setBrn(e.target.value)}
              />
            </Field>
            <Field label={t('官方案件編號', 'Registry case number')}>
              <input
                value={registryCaseNo}
                maxLength={30}
                onChange={(e) => setRegistryCaseNo(e.target.value)}
              />
            </Field>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={checks.includes('certificates_verified')}
              onChange={(e) => setChecks(e.target.checked ? ['certificates_verified'] : [])}
            />
            {t(
              '已從官方平台取得兩份證書，核對名稱、號碼與文件內容，並上傳至本案。',
              'Both certificates were retrieved from the official portal, checked against company details, and uploaded to this case.',
            )}
          </label>
          <button
            className="button"
            disabled={
              busy ||
              !note ||
              !checks.includes('certificates_verified') ||
              !/^[0-9]{8}$/.test(brn) ||
              !registryCaseNo ||
              !c.files.some((f) => f.kind === 'ci') ||
              !c.files.some((f) => f.kind === 'br')
            }
            onClick={() => act('complete')}
          >
            {t('確認公司成立並交付文件', 'Confirm incorporation & deliver documents')}
          </button>
        </>
      )}
    </section>
  );
}
function eventLabel(action: string, t: (zh: string, en: string) => string) {
  const labels: Record<string, [string, string]> = {
    reconcile_submission: ['官方提交及扣款已人工核對', 'Official filing and debit reconciled'],
    case_created: ['建立案件', 'Case created'],
    information_updated: ['更新申請資料', 'Information updated'],
    document_uploaded: ['上傳文件', 'Document uploaded'],
    checkout: ['確認報價', 'Quote accepted'],
    report_payment: ['客戶已回報轉帳', 'Customer reported a transfer'],
    confirm_payment: ['Norby 確認入帳', 'Norby confirmed payment'],
    request_information: ['Norby 要求補件', 'Norby requested information'],
    resubmit: ['補件已送審', 'Updated information submitted'],
    approve: ['人工審核通過', 'Manual review approved'],
    reject: ['審核拒絕，待全額退款', 'Review declined; full refund pending'],
    confirm_refund: ['確認全額退款', 'Full refund confirmed'],
    queue_validation: ['排程官方資料驗證', 'Registry validation queued'],
    official_validation_completed: ['官方資料驗證完成', 'Registry validation completed'],
    official_signature_verified: ['官方簽署核實完成', 'Registry signature verified'],
    queue_submission: ['排程正式提交', 'Official submission queued'],
    official_submission_receipt: ['收到官方提交回執', 'Registry filing receipt received'],
    queue_status: ['排程查詢官方進度', 'Registry status query queued'],
    official_status_updated: ['官方進度已更新', 'Registry status updated'],
    submission_result_unknown: [
      '提交結果不明，待人工核對',
      'Submission result unknown; reconciliation required',
    ],
    official_request_failed: ['官方請求未完成', 'Registry request did not complete'],
    complete: ['公司成立，文件已交付', 'Company incorporated; documents delivered'],
  };
  return labels[action] ? t(...labels[action]) : action;
}

function eventNote(action: string, note: string, t: (zh: string, en: string) => string) {
  if (action === 'document_uploaded' && note in kinds) return t(...kinds[note as FileKind]);
  if (action === 'official_status_updated')
    return note === 'unknown'
      ? t(
          '官方查詢未返回可確認的狀態，Norby 將人工核對。',
          'No conclusive status was returned. Norby will reconcile it manually.',
        )
      : note === 'Pending re-lodged'
        ? t('註冊處要求補正。', 'The Registry requested corrections.')
        : note === 'Re-lodged'
          ? t('已向註冊處重新提交補正。', 'Corrections have been re-lodged.')
          : t('註冊處已收到提交。', 'The Registry has received the filing.');
  if (action === 'submission_result_unknown')
    return t(
      '請先核對官方記錄，結果確認前不會再次提交。',
      'Official records must be reconciled before any further submission.',
    );
  if (action === 'official_request_failed')
    return note === 'OFFICIAL_ACCOUNTS_REQUIRED'
      ? t(
          '請先完成相關簽署人的官方帳戶資料，並由 Norby 重新核對。',
          'Complete each signer’s Registry account details and ask Norby to review them.',
        )
      : note === 'ORGANISATION_NOT_CONFIGURED'
        ? t(
            'Norby 需要完成公司秘書與註冊地址設定。',
            'Norby needs to complete the secretary and registered address settings.',
          )
        : t(
            '官方請求未完成。Norby 將確認原因與下一步。',
            'The Registry request did not complete. Norby will check the cause and next step.',
          );
  return note;
}
