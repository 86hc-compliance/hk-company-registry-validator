import { createRoot } from 'react-dom/client';
import { useState, useEffect, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Globe2,
  Menu,
  X,
  ShieldCheck,
  Sparkles,
  Link2,
  LogOut,
} from 'lucide-react';
import {
  api,
  authClient,
  ErrorMessage,
  Field,
  Loading,
  LocaleContext,
  useLoad,
  useT,
  type User,
  type PublicConfig,
} from './common';
import type { Locale } from '../shared/domain';
import { CaseList, CasePage } from './cases';
import { Settings } from './settings';
import { SignPage } from './sign';
import { Guide } from './guide';
import { CityHero, CityIllustration } from './hero';
import './styles.css';
import './hero.css';

function App() {
  const [locale, setLocale] = useState<Locale>(() =>
    localStorage.getItem('norby-language') === 'en' ? 'en' : 'zh-Hant',
  );
  const { data: config, error } = useLoad<PublicConfig>('/api/public');
  const { data: user, loading } = useLoad<User>('/api/me');
  const [menu, setMenu] = useState(false);
  const t = (zh: string, en: string) => (locale === 'en' ? en : zh);
  const path = window.location.pathname;
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === 'en' ? 'Norby — Your next chapter starts here' : 'Norby — 從這裡，開始你的下一步';
  }, [locale]);
  const switchLanguage = () => {
    const l = locale === 'en' ? 'zh-Hant' : 'en';
    setLocale(l);
    localStorage.setItem('norby-language', l);
    document.documentElement.lang = l;
  };
  const content = () => {
    if (path === '/') return <Landing config={config} user={user} />;
    if (path === '/guide') return <Guide />;
    if (['/sign-in', '/sign-up', '/forgot-password', '/reset-password'].includes(path))
      return <SignIn path={path} config={config} />;
    if (loading) return <Loading />;
    if (!user)
      return (
        <section className="narrow section">
          <h1>{t('登入以繼續', 'Sign in to continue')}</h1>
          <p>
            {t(
              '你的案件與文件會安全地保存在帳戶中。',
              'Your cases and documents live in your account.',
            )}
          </p>
          <a className="button" href="/sign-in">
            {t('登入', 'Sign in')}
            <ArrowRight size={18} />
          </a>
        </section>
      );
    if (path === '/consent') return <Consent />;
    if (/^\/sign\/[^/]+$/.test(path)) return <SignPage id={path.split('/')[2]} />;
    if (path === '/connections') return <Connections config={config} />;
    if (path === '/settings' && user.kind === 'staff') return <Settings />;
    if (path === '/cases') return <CaseList user={user} config={config} />;
    if (/^\/cases\/[^/]+$/.test(path))
      return <CasePage id={path.split('/')[2]} user={user} config={config} />;
    return (
      <section className="narrow section">
        <h1>{t('找不到這個頁面', 'Page not found')}</h1>
        <a href="/cases" className="button">
          {t('回到我的案件', 'Back to my cases')}
        </a>
      </section>
    );
  };
  return (
    <LocaleContext.Provider value={locale}>
      <a className="skip-link" href="#main">
        {t('跳至內容', 'Skip to content')}
      </a>
      {config?.preview && (
        <div className="preview-bar">
          {t(
            '開發預覽 · 請使用虛構資料，尚未提供正式服務',
            'Development preview · Use fictional data. Live service is not enabled.',
          )}
        </div>
      )}
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Norby home">
          norby<span>↗</span>
        </a>
        <button
          className="mobile-menu icon-button"
          onClick={() => setMenu(!menu)}
          aria-label={t('開啟導覽', 'Toggle navigation')}
          aria-expanded={menu}
        >
          {menu ? <X /> : <Menu />}
        </button>
        <nav className={menu ? 'open' : ''} aria-label={t('主要導覽', 'Main navigation')}>
          {user ? (
            <>
              <a className={path.startsWith('/cases') ? 'active' : ''} href="/cases">
                {t(
                  user.kind === 'staff' ? '案件工作台' : '我的案件',
                  user.kind === 'staff' ? 'Case workspace' : 'My cases',
                )}
              </a>
              <a className={path === '/connections' ? 'active' : ''} href="/connections">
                {t('代理授權', 'Agent connections')}
              </a>
              {user.kind === 'staff' && <a href="/settings">{t('營運設定', 'Settings')}</a>}
            </>
          ) : (
            <>
              <a href="/#service">{t('設立服務', 'Our service')}</a>
              <a href="/#process">{t('如何開始', 'How it works')}</a>
              <a href="/#agents">{t('與 AI 協作', 'For agents')}</a>
            </>
          )}
          <button className="language" onClick={switchLanguage}>
            <Globe2 size={15} />
            {locale === 'en' ? '繁中' : 'EN'}
          </button>
          {user ? (
            <button
              className="text-button"
              onClick={async () => {
                await authClient.signOut();
                window.location.assign('/');
              }}
              title={user.email}
            >
              <LogOut size={16} />
              {t('登出', 'Sign out')}
            </button>
          ) : (
            <a className="button small" href="/sign-in">
              {t('登入 / 開始申請', 'Sign in / Get started')}
              <ArrowUpRight size={16} />
            </a>
          )}
        </nav>
      </header>
      <main id="main">
        <ErrorMessage error={error} />
        {content()}
      </main>
      <footer>
        <a className="wordmark" href="/">
          norby<span>↗</span>
        </a>
        <p>{t('把下一步，交給更清楚的流程。', 'A clearer path to your next chapter.')}</p>
        <a className="text-link" href="/guide">
          {t('申請準備指南', 'Preparation guide')}
        </a>
        <span>Hong Kong · Taiwan</span>
        <small>© {new Date().getFullYear()} Norby</small>
      </footer>
    </LocaleContext.Provider>
  );
}
function Landing({ config, user }: { config?: PublicConfig; user?: User }) {
  const t = useT();
  return (
    <>
      <CityHero user={user} />
      <div className="service-strip">
        <div className="container">
          <span>{t('一次準備，完整起步', 'A considered start, from day one')}</span>
          <span>
            <Check size={16} />
            {t('公司設立', 'Incorporation')}
          </span>
          <span>
            <Check size={16} />
            {t('首年公司秘書', 'First-year secretary')}
          </span>
          <span>
            <Check size={16} />
            {t('首年香港註冊地址', 'First-year HK address')}
          </span>
        </div>
      </div>
      <section id="service" className="container section service-section">
        <div>
          <div className="eyebrow">01 / {t('你的起點', 'YOUR FOUNDATION')}</div>
          <h2>
            {t('專心經營，', 'Make room for')}
            <br />
            {t('起步的事交給我們。', 'what comes next.')}
          </h2>
          <p className="muted">
            {t(
              '為自然人股東的香港私人股份有限公司而設。單一方案，包含開始營運前的基本安排。',
              'A focused package for Hong Kong private companies limited by shares, with individual shareholders and standard articles.',
            )}
          </p>
        </div>
        <div className="service-lines">
          {[
            [
              t('香港公司設立', 'Hong Kong incorporation'),
              t(
                '資料整理、人工審核、正式提交及成立文件交付。',
                'Information preparation, human review, official filing and delivery of incorporation documents.',
              ),
            ],
            [
              t('首年公司秘書', 'Your first year of company secretary'),
              t(
                '由 Norby 安排秘書服務，建立公司行政的起點。',
                'Company secretary service arranged by Norby to support your first year.',
              ),
            ],
            [
              t('首年香港註冊地址', 'Your first year of registered address'),
              t('公司設立使用的香港註冊地址。', 'A Hong Kong registered address for your company.'),
            ],
          ].map(([title, body], i) => (
            <div className="service-line" key={title}>
              <span className="line-number">0{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
              <ArrowUpRight size={19} />
            </div>
          ))}
          <div className="payment-summary">
            <strong>HKD / USD / TWD</strong>
            <p>
              {t(
                '銀行轉帳，由 Norby 確認入帳。港幣及美元由香港公司收款；台幣由台灣公司收款，服務費與代收政府費合計另加 5% 營業稅。',
                'Pay by bank transfer, confirmed by Norby. HKD and USD go to the Hong Kong entity. TWD goes to the Taiwan entity with 5% business tax on service and collected government fees.',
              )}
            </p>
            <small>
              {t(
                '各幣別獨立定價，完整分項報價於申請內確認。',
                'Each currency has a fixed price. Confirm the itemized quote in your application.',
              )}
            </small>
          </div>
        </div>
      </section>
      <section id="process" className="process-section">
        <div className="container">
          <div className="section-heading">
            <div>
              <div className="eyebrow">02 / {t('清楚的每一步', 'A CLEAR PATH')}</div>
              <h2>{t('不用猜，下一步是什麼。', 'Know exactly what comes next.')}</h2>
            </div>
            <p>
              {t(
                '你的資料、付款、進度與文件，都在同一個地方。',
                'Your information, payment, progress and documents. All in one place.',
              )}
            </p>
          </div>
          <div className="process-grid">
            {[
              [
                t('準備資料', 'Prepare'),
                t(
                  '填寫公司與成員資料，上傳證明文件。你也可以授權 AI 代理協助備料。',
                  'Add company and member information and upload documents. Authorize an AI agent to help prepare.',
                ),
              ],
              [
                t('付款與審核', 'Pay & review'),
                t(
                  '確認分項報價、銀行轉帳。入帳後，Norby 人工核對資料，必要時請你補件。',
                  'Review your quote and make a bank transfer. Once received, Norby reviews your application.',
                ),
              ],
              [
                t('簽署與提交', 'Sign & file'),
                t(
                  'Norby 協助準備官方帳戶，完成必要簽署後正式提交。',
                  'Norby helps prepare official accounts. The application is filed after the required signatures.',
                ),
              ],
              [
                t('成立與交付', 'Incorporate & receive'),
                t(
                  'Norby 取得並核對公司註冊證明書及商業登記證，在平台交付給你。',
                  'Norby retrieves and checks both certificates, then delivers them through your account.',
                ),
              ],
            ].map(([title, body], i) => (
              <article className="process-step" key={title}>
                <div className="step-top">
                  <span>0{i + 1}</span>
                  {i < 3 && <ArrowRight size={20} />}
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section id="agents" className="container section agent-section">
        <div className="agent-visual">
          <div className="agent-symbol">
            <Sparkles size={28} />
          </div>
          <div className="connection-line" />
          <div className="agent-n">n↗</div>
          <div className="connection-line" />
          <div className="agent-symbol">
            <ShieldCheck size={28} />
          </div>
          <div className="agent-caption">
            YOUR AGENT <span>NORBY</span> YOUR CONTROL
          </div>
        </div>
        <div>
          <div className="eyebrow">03 / {t('人與 AI，各司其職', 'HUMAN CARE. AGENT READY.')}</div>
          <h2>
            {t('你的 AI 助手，', 'Bring your AI.')}
            <br />
            {t('也能一起開始。', 'Keep your control.')}
          </h2>
          <p>
            {t(
              '授權你使用的 AI 代理建立案件、整理資料和查詢進度。重要決定由你確認，合規審核由 Norby 完成；你隨時都能撤銷授權。',
              'Let your AI agent create a case, organize information and check progress. You confirm the important decisions; Norby handles the review. Revoke access whenever you need.',
            )}
          </p>
          <a className="text-link" href={user ? '/connections' : '/sign-up'}>
            {t('了解代理連線', 'Connect your agent')}
            <ArrowUpRight size={17} />
          </a>
        </div>
      </section>
      <section className="container contact-band">
        <div>
          <h2>{t('下一步，不必自己摸索。', 'Your next step, with a little guidance.')}</h2>
          <p>
            {t(
              '銀行開戶與 Stripe 申請需要協助？與 Norby 聊聊你的計畫。',
              'Need help with bank accounts or Stripe? Talk to Norby about your plans.',
            )}
          </p>
        </div>
        {config?.contactUrl ? (
          <a className="button light" href={config.contactUrl} target="_blank" rel="noreferrer">
            {t('聯絡 Norby', 'Talk to Norby')}
            <ArrowUpRight size={18} />
          </a>
        ) : (
          <a className="button light" href={user ? '/cases' : '/sign-up'}>
            {t('建立你的帳戶', 'Create your account')}
            <ArrowUpRight size={18} />
          </a>
        )}
      </section>
    </>
  );
}
function SignIn({ path, config }: { path: string; config?: PublicConfig }) {
  const t = useT();
  const signup = path === '/sign-up',
    forgot = path === '/forgot-password',
    reset = path === '/reset-password';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [sent, setSent] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const f = new FormData(e.currentTarget);
    try {
      const email = String(f.get('email') || ''),
        password = String(f.get('password') || '');
      const r = forgot
        ? await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' })
        : reset
          ? await authClient.resetPassword({
              newPassword: password,
              token: new URLSearchParams(location.search).get('token') || '',
            })
          : signup
            ? await authClient.signUp.email({
                email,
                password,
                name: String(f.get('name')),
                callbackURL: '/cases',
              })
            : await authClient.signIn.email({ email, password, callbackURL: '/cases' });
      if (r.error) throw new Error(r.error.code || r.error.message);
      if (forgot || reset || (signup && config?.emailVerificationRequired !== false)) setSent(true);
      else if (!('url' in (r.data || {}))) window.location.assign('/cases');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="auth-layout container">
      <div className="auth-story">
        <div className="eyebrow">YOUR NEXT CHAPTER</div>
        <h1>
          {t('準備好，', 'A little closer')}
          <br />
          {t('開始下一步。', 'to your next step.')}
        </h1>
        <p>{t('為你的事業，留一個清楚的起點。', 'Give your business a clear place to begin.')}</p>
        <div className="auth-city">
          <CityIllustration />
        </div>
      </div>
      <div className="auth-panel">
        <h2>
          {forgot
            ? t('重設密碼', 'Reset password')
            : reset
              ? t('設定新密碼', 'Set a new password')
              : signup
                ? t('建立 Norby 帳戶', 'Create your Norby account')
                : t('歡迎回來', 'Welcome back')}
        </h2>
        <p className="muted">
          {t(
            '案件、進度與文件，一個帳戶掌握。',
            'Your cases, progress and documents, in one account.',
          )}
        </p>
        <ErrorMessage error={error} />
        {sent ? (
          <div className="notice success">
            {reset
              ? t('密碼已更新，你可以重新登入。', 'Your password is updated. You can sign in now.')
              : t(
                  '請查看你的信箱，依照信中連結繼續。',
                  'Check your inbox and follow the link to continue.',
                )}
            <a href="/sign-in">{t('前往登入', 'Go to sign in')}</a>
          </div>
        ) : (
          <form onSubmit={submit}>
            {signup && (
              <Field label={t('你的姓名', 'Your name')}>
                <input name="name" autoComplete="name" required maxLength={100} />
              </Field>
            )}
            {!reset && (
              <Field label={t('電子郵件', 'Email')}>
                <input name="email" type="email" autoComplete="email" required />
              </Field>
            )}
            {!forgot && (
              <Field
                label={t('密碼', 'Password')}
                hint={signup || reset ? t('至少 12 個字元', 'At least 12 characters') : undefined}
              >
                <input
                  name="password"
                  type="password"
                  autoComplete={signup || reset ? 'new-password' : 'current-password'}
                  minLength={signup || reset ? 12 : 1}
                  required
                />
              </Field>
            )}
            <button className="button full" disabled={busy}>
              {busy
                ? t('處理中…', 'Please wait…')
                : forgot
                  ? t('寄送重設連結', 'Send reset link')
                  : reset
                    ? t('儲存新密碼', 'Save password')
                    : signup
                      ? t('建立帳戶', 'Create account')
                      : t('登入', 'Sign in')}
              <ArrowRight size={17} />
            </button>
            <div className="auth-links">
              {!forgot && !reset && (
                <a href={`${signup ? '/sign-in' : '/sign-up'}${location.search}`}>
                  {signup
                    ? t('已有帳戶？登入', 'Already have an account? Sign in')
                    : t('還沒有帳戶？開始申請', 'New here? Create an account')}
                </a>
              )}
              {!signup && !forgot && !reset && (
                <a href="/forgot-password">{t('忘記密碼', 'Forgot password')}</a>
              )}
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
function Consent() {
  const t = useT();
  const { data, error } = useLoad<{
    client: { client_name?: string; name?: string; client_id?: string };
    scopes: string[];
  }>(`/api/consent?query=${encodeURIComponent(location.search.slice(1))}`);
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const decide = async (accept: boolean) => {
    setBusy(true);
    try {
      const value = await api<{ url?: string; redirect_uri?: string }>('/api/auth/oauth2/consent', {
        method: 'POST',
        body: JSON.stringify({ accept, oauth_query: location.search.slice(1) }),
      });
      if (value?.url || value?.redirect_uri) location.assign(value.url || value.redirect_uri!);
      else location.assign('/connections');
    } catch (e) {
      setFailure(e);
      setBusy(false);
    }
  };
  return (
    <section className="narrow section">
      <span className="round-icon">
        <Link2 />
      </span>
      <h1>{t('連結你的 AI 代理', 'Connect your AI agent')}</h1>
      <ErrorMessage error={error || failure} />
      {data ? (
        <>
          <p>
            <strong>{data.client.client_name || data.client.name || data.client.client_id}</strong>{' '}
            {t('希望存取你的 Norby 帳戶。', 'wants access to your Norby account.')}
          </p>
          <div className="panel">
            <h3>{t('你將授予的權限', 'Permissions you will grant')}</h3>
            <ul className="check-list">
              {data.scopes.map((s) => (
                <li key={s}>
                  <Check size={16} />
                  {s === 'cases:read'
                    ? t('讀取你的案件資料與進度', 'Read your case information and progress')
                    : s === 'cases:write'
                      ? t(
                          '建立案件並更新可編輯的資料',
                          'Create cases and update editable information',
                        )
                      : s === 'offline_access'
                        ? t('在你離線時維持授權', 'Maintain access while you are offline')
                        : s === 'email'
                          ? t('讀取電子郵件地址', 'Read your email address')
                          : t('識別你的帳戶', 'Identify your account')}
                  <code>{s}</code>
                </li>
              ))}
            </ul>
          </div>
          <p className="muted">
            {t(
              '代理無法確認收款、批准審核、代替你簽署或提交。你可以隨時在「代理授權」撤銷。',
              'The agent cannot confirm payments, approve reviews, sign for you or file applications. Revoke access at any time in Agent connections.',
            )}
          </p>
          <div className="actions">
            <button className="button" disabled={busy} onClick={() => decide(true)}>
              {t('同意授權', 'Allow access')}
            </button>
            <button className="button secondary" disabled={busy} onClick={() => decide(false)}>
              {t('拒絕', 'Deny')}
            </button>
          </div>
        </>
      ) : (
        !error && <Loading />
      )}
    </section>
  );
}
function Connections({ config }: { config?: PublicConfig }) {
  const t = useT();
  const { data, error, reload } =
    useLoad<{ id: string; clientId: string; scopes: string[]; createdAt: string }[]>(
      '/api/connections',
    );
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  return (
    <section className="container section workspace">
      <div className="eyebrow">CONNECTED, WITH YOUR PERMISSION</div>
      <h1>{t('你的代理，你掌握。', 'Your agent. Your control.')}</h1>
      <p className="lead">
        {t(
          '將 Norby 加入支援 MCP 的 AI 工具，登入後選擇授權範圍。',
          'Add Norby to an AI tool that supports MCP, sign in and choose what it can access.',
        )}
      </p>
      <div className="panel connection-setup">
        <div>
          <h3>{t('Norby MCP 連線位址', 'Norby MCP connection URL')}</h3>
          <code>{config?.mcpUrl}</code>
        </div>
        <button
          className="button secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(config?.mcpUrl || '');
              setCopied(true);
            } catch (e) {
              setFailure(e);
            }
          }}
        >
          {copied ? t('已複製', 'Copied') : t('複製位址', 'Copy URL')}
        </button>
      </div>
      <p className="muted">
        {t(
          '在 AI 工具中新增遠端 MCP 連線，貼上位址，再透過 Norby 登入頁完成授權。請勿將官方帳戶密碼交給代理。',
          'Add a remote MCP connection in your AI tool, paste the URL, and authorize through the Norby sign-in page. Never share your Registry password with an agent.',
        )}
      </p>
      <h2 className="subheading">{t('已授權的連線', 'Authorized connections')}</h2>
      <ErrorMessage error={error || failure} />
      {!data && !error ? (
        <Loading />
      ) : data?.length ? (
        data.map((c) => (
          <div className="connection-row" key={c.id}>
            <Link2 size={22} />
            <div>
              <strong>{c.clientId}</strong>
              <p>{(Array.isArray(c.scopes) ? c.scopes : []).join(' · ')}</p>
            </div>
            <button
              className="button secondary danger"
              disabled={busy === c.id}
              onClick={async () => {
                setBusy(c.id);
                try {
                  await api(`/api/connections/${c.id}/revoke`, { method: 'POST', body: '{}' });
                  await reload();
                } catch (e) {
                  setFailure(e);
                } finally {
                  setBusy('');
                }
              }}
            >
              {t('撤銷授權', 'Revoke access')}
            </button>
          </div>
        ))
      ) : (
        <div className="empty compact">
          <ShieldCheck size={30} />
          <h3>{t('目前沒有代理能存取你的案件', 'No agents have access to your cases')}</h3>
          <p>
            {t(
              '完成一次登入授權後，連線會顯示在這裡。',
              'Connections will appear here after you authorize them.',
            )}
          </p>
        </div>
      )}
    </section>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
