import { useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import {
  currencies,
  minorUnits,
  type Currency,
  type Price,
  type OrganisationSettings,
} from '../shared/domain';
import { api, ErrorMessage, Field, Loading, useLoad, useT } from './common';
import { AddressFields } from './editor';

export function Settings() {
  const t = useT();
  const { data, error } = useLoad<{ prices: Price[]; organisation: OrganisationSettings }>(
    '/api/settings',
  );
  if (!data)
    return (
      <section className="container section">
        <ErrorMessage error={error} />
        {!error && <Loading />}
      </section>
    );
  return (
    <section className="container section workspace">
      <div className="eyebrow">NORBY OPERATIONS</div>
      <h1>{t('讓每一筆申請，有所依據。', 'Set the foundation for every application.')}</h1>
      <p className="lead">
        {t(
          '設定正式報價、收款帳戶、公司秘書與註冊地址。已確認的案件保留原報價。',
          'Configure pricing, bank accounts, company secretary and registered address. Accepted quotes retain their original terms.',
        )}
      </p>
      <h2 className="subheading">{t('三幣別獨立定價', 'Fixed pricing in three currencies')}</h2>
      <div className="settings-prices">
        {currencies.map((currency) => (
          <PriceForm
            key={currency}
            currency={currency}
            price={data.prices.find((p) => p.currency === currency)}
          />
        ))}
      </div>
      <OrganisationForm initial={data.organisation} />
    </section>
  );
}
function PriceForm({ currency, price }: { currency: Currency; price?: Price }) {
  const t = useT();
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await api('/api/settings/prices', {
        method: 'PUT',
        body: JSON.stringify({
          currency,
          service: minorUnits(String(f.get('service')), currency),
          government: minorUnits(String(f.get('government')), currency),
          bank: Object.fromEntries(
            ['company', 'bank', 'account', 'swift', 'instructions'].map((k) => [k, f.get(k)]),
          ),
        }),
      });
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="panel">
      <div className="quote-heading">
        <h3>{currency}</h3>
        <span>
          {t(
            currency === 'TWD' ? '台灣收款 · 另加 5%' : '香港收款',
            currency === 'TWD' ? 'Taiwan · +5% tax' : 'Hong Kong',
          )}
        </span>
      </div>
      <ErrorMessage error={error} />
      <div className="form-grid">
        <Field label={t('服務費（未稅）', 'Service fee (before tax)')}>
          <input
            name="service"
            inputMode="decimal"
            required
            defaultValue={price ? price.service / (currency === 'TWD' ? 1 : 100) : ''}
          />
        </Field>
        <Field label={t('代收政府費（未稅）', 'Government fees (before tax)')}>
          <input
            name="government"
            inputMode="decimal"
            required
            defaultValue={price ? price.government / (currency === 'TWD' ? 1 : 100) : ''}
          />
        </Field>
      </div>
      {(
        [
          ['company', '收款公司法定名稱', 'Beneficiary legal name'],
          ['bank', '銀行名稱', 'Bank name'],
          ['account', '收款帳號', 'Account number'],
          ['swift', 'SWIFT（選填）', 'SWIFT (optional)'],
          ['instructions', '轉帳指示（選填）', 'Transfer instructions (optional)'],
        ] as const
      ).map(([key, zh, en]) => (
        <Field key={key} label={t(zh, en)}>
          <input
            name={key}
            defaultValue={price?.bank[key] || ''}
            required={!['swift', 'instructions'].includes(key)}
          />
        </Field>
      ))}
      <button className="button secondary" disabled={busy}>
        <Save size={16} />
        {t('儲存報價', 'Save quote')}
      </button>
      {saved && (
        <span role="status" className="saved">
          {t('已儲存', 'Saved')}
        </span>
      )}
    </form>
  );
}
function OrganisationForm({ initial }: { initial: OrganisationSettings }) {
  const t = useT();
  const [value, setValue] = useState(initial),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  return (
    <form
      className="panel organisation-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        setSaved(false);
        try {
          await api('/api/settings/organisation', { method: 'PUT', body: JSON.stringify(value) });
          setSaved(true);
        } catch (e) {
          setError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{t('秘書與聯絡設定', 'Secretary & contact details')}</h2>
      <ErrorMessage error={error} />
      <div className="form-grid">
        {(
          [
            ['secretaryName', '公司秘書英文法定名稱', 'Secretary English legal name'],
            ['secretaryChineseName', '公司秘書中文法定名稱', 'Secretary Chinese legal name'],
            ['secretaryBrn', '公司秘書 8 位數 BRN', 'Secretary 8-digit BRN'],
            ['tcspLicence', 'TCSP 牌照號碼', 'TCSP licence number'],
            ['secretaryEmail', '公司秘書電子郵件', 'Secretary email'],
            ['hkPhone', '香港電話號碼', 'Hong Kong phone number'],
            ['contactUrl', '客戶諮詢連結（HTTPS）', 'Customer consultation URL (HTTPS)'],
          ] as const
        ).map(([key, zh, en]) => (
          <Field label={t(zh, en)} key={key}>
            <input
              value={value[key]}
              type={key === 'secretaryEmail' ? 'email' : key === 'contactUrl' ? 'url' : 'text'}
              onChange={(e) => setValue({ ...value, [key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <AddressFields
        title={t(
          '香港註冊地址及秘書通訊地址',
          'Hong Kong registered and secretary correspondence address',
        )}
        value={value.office}
        onChange={(office) => setValue({ ...value, office })}
      />
      <button className="button" disabled={busy}>
        {t('儲存營運設定', 'Save settings')}
        <Save size={17} />
      </button>
      {saved && (
        <span className="saved" role="status">
          {t('已儲存', 'Saved')}
        </span>
      )}
    </form>
  );
}
