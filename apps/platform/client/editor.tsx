import { useState, type FormEvent } from 'react';
import { Plus, Trash2, Check, Save } from 'lucide-react';
import { emptyAddress, type Application, type Address } from '../shared/domain';
import { api, ErrorMessage, Field, useT } from './common';
import type { CaseView } from '../shared/domain';

export const issueLabel = (code: string, t: (zh: string, en: string) => string) => {
  const fixed: Record<string, [string, string]> = {
    company_name: ['公司名稱', 'Company name'],
    english_name_suffix: ['英文公司名稱須以 Limited 結尾', 'English name must end with Limited'],
    chinese_name_suffix: [
      '中文公司名稱須以「有限公司」結尾',
      'Chinese name must end with 有限公司',
    ],
    business_information: [
      '業務類別、描述與資金來源',
      'Business category, description and source of funds',
    ],
    share_capital: ['股份數量與股本', 'Share count and capital'],
    founders: ['至少一位自然人股東', 'At least one individual shareholder'],
    director: ['至少一位自然人董事', 'At least one individual director'],
    share_allocation: ['股東持股合計須等於發行股份', 'Share allocations must match issued shares'],
    capital_allocation: ['成員出資合計須等於股本', 'Contributions must match share capital'],
    founder_signer: ['指定創辦成員簽署人', 'Select a founder to sign'],
    duplicate_person: ['成員資料重複', 'Duplicate person'],
  };
  if (code === 'unique_signer_email')
    return t(
      '每位簽署人需有自己的電郵與登入帳戶',
      'Each signer needs a distinct email and login account',
    );
  const label = fixed[code];
  if (label) return t(...label);
  if (code.startsWith('hkid:'))
    return t(
      '香港身分證號碼格式不正確，請使用大寫字母，例如 A123456(7)',
      'Invalid HK identity number format; use uppercase letters, e.g. A123456(7)',
    );
  return code.startsWith('director_age:')
    ? t(
        '董事須年滿 18 歲，請檢查出生日期',
        'Check the director’s date of birth; directors must be 18 or older',
      )
    : code.startsWith('director:')
      ? t('董事出生日期與通訊地址', 'Director date of birth and correspondence address')
      : t(
          '成員姓名、電郵、國籍、證件與住址',
          'Member name, email, nationality, identification and address',
        );
};
export function AddressFields({
  value,
  onChange,
  title,
  disabled = false,
}: {
  value: Address;
  onChange: (v: Address) => void;
  title: string;
  disabled?: boolean;
}) {
  const t = useT();
  const fields: [keyof Address, string, string][] = [
    ['flat', '室／樓層／座', 'Flat / floor / block'],
    ['building', '大廈名稱', 'Building'],
    ['street', '街道／屋苑／地段', 'Street / estate / lot'],
    ['district', '地區／城市／郵遞區號', 'District / city / postal code'],
    ['country', '國家或地區代碼（例如 HKG、TWN）', 'Country code (e.g. HKG, TWN)'],
  ];
  return (
    <fieldset className="address-fields" disabled={disabled}>
      <legend>{title}</legend>
      <div className="form-grid">
        {fields.map(([key, zh, en]) => (
          <Field key={key} label={t(zh, en)}>
            <input
              value={value[key]}
              maxLength={key === 'country' ? 3 : 60}
              onChange={(e) =>
                onChange({
                  ...value,
                  [key]: key === 'country' ? e.target.value.toUpperCase() : e.target.value,
                })
              }
            />
          </Field>
        ))}
      </div>
    </fieldset>
  );
}
export function ApplicationEditor({ c, onSaved }: { c: CaseView; onSaved: (c: CaseView) => void }) {
  const t = useT();
  const [data, setData] = useState<Application>(structuredClone(c.data));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const editable = ['draft', 'needs_information', 'awaiting_payment', 'payment_check'].includes(
    c.status,
  );
  const set = <K extends keyof Application>(key: K, value: Application[K]) => {
    setData((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };
  const person = (index: number, key: string, value: unknown) => {
    set(
      'people',
      data.people.map((p, i) => (i === index ? { ...p, [key]: value } : p)),
    );
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<CaseView>(`/api/cases/${c.id}`, {
        method: 'PUT',
        body: JSON.stringify({ version: c.version, data }),
      });
      onSaved(result);
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <ErrorMessage error={error} />
      {!editable && (
        <div className="notice">
          {t(
            '這份資料已送交審核或提交，目前為唯讀。如需更正，請聯絡 Norby。',
            'This information is under review or has been filed and is read-only. Contact Norby for corrections.',
          )}
        </div>
      )}
      <fieldset disabled={!editable || busy} className="editor-section">
        <div className="section-number">01</div>
        <h2>{t('先替你的公司取個名字', 'Start with a name')}</h2>
        <p className="muted">
          {t(
            '可以填寫英文、中文，或兩者。名稱能否使用須由註冊處確認。',
            'Use an English name, a Chinese name, or both. Availability is subject to the Registry.',
          )}
        </p>
        <div className="form-grid">
          <Field
            label={t('英文公司名稱', 'English company name')}
            hint={t('以 Limited 結尾', 'End with Limited')}
          >
            <input
              value={data.englishName}
              maxLength={150}
              onChange={(e) => set('englishName', e.target.value)}
              placeholder="Your Company Limited"
            />
          </Field>
          <Field
            label={t('中文公司名稱（選填）', 'Chinese company name (optional)')}
            hint={t('以「有限公司」結尾', 'End with 有限公司')}
          >
            <input
              value={data.chineseName}
              maxLength={150}
              onChange={(e) => set('chineseName', e.target.value)}
            />
          </Field>
        </div>
        <div className="form-grid">
          <Field
            label={t('業務性質代碼', 'Business nature code')}
            hint={t(
              '使用註冊處的三位數代碼，Norby 會於審核時核對。',
              'Use the Registry’s three-digit code. Norby will check it during review.',
            )}
          >
            <input
              value={data.businessCode}
              pattern="[0-9]{3}"
              maxLength={3}
              onChange={(e) => set('businessCode', e.target.value)}
              inputMode="numeric"
            />
          </Field>
          <Field label={t('業務內容', 'Business description')}>
            <textarea
              value={data.businessDescription}
              maxLength={500}
              onChange={(e) => set('businessDescription', e.target.value)}
              rows={3}
            />
          </Field>
        </div>
        <Field label={t('資金來源與成立目的', 'Source of funds and purpose')}>
          <textarea
            value={data.sourceOfFunds}
            maxLength={1000}
            onChange={(e) => set('sourceOfFunds', e.target.value)}
            rows={3}
          />
        </Field>
      </fieldset>
      <fieldset disabled={!editable || busy} className="editor-section">
        <div className="section-number">02</div>
        <h2>{t('股份與股本', 'Shares and capital')}</h2>
        <p className="muted">
          {t(
            '第一版採普通股、全數繳足股本及標準章程。',
            'Version one supports ordinary shares, fully paid capital and standard articles.',
          )}
        </p>
        <div className="form-grid three">
          <Field label={t('股份幣別', 'Share currency')}>
            <input
              value={data.shareCurrency}
              maxLength={3}
              onChange={(e) => set('shareCurrency', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t('發行股份總數', 'Total issued shares')}>
            <input
              type="number"
              min={1}
              max={999999999999}
              value={data.shareCount || ''}
              onChange={(e) => set('shareCount', Number(e.target.value))}
            />
          </Field>
          <Field label={t('已繳股本總額', 'Total paid-up capital')}>
            <input
              inputMode="decimal"
              value={data.shareCapital}
              onChange={(e) => set('shareCapital', e.target.value)}
              maxLength={16}
            />
          </Field>
        </div>
      </fieldset>
      <fieldset disabled={!editable || busy} className="editor-section">
        <div className="section-number">03</div>
        <h2>{t('一起開始的成員', 'The people behind your company')}</h2>
        <p className="muted">
          {t(
            '可加入多位自然人股東或董事。同一人兼任股東與董事，只需填寫一次。',
            'Add individual shareholders and directors. A person holding both roles only needs one entry.',
          )}
        </p>
        {data.people.map((p, i) => (
          <section className="person-form" key={p.id}>
            <div className="person-heading">
              <h3>
                {t('成員', 'Person')} {String(i + 1).padStart(2, '0')}{' '}
                {p.surname && (
                  <small>
                    · {p.surname} {p.givenName}
                  </small>
                )}
              </h3>
              {editable && (
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={t(`移除成員 ${i + 1}`, `Remove person ${i + 1}`)}
                  onClick={() =>
                    set(
                      'people',
                      data.people.filter((x) => x.id !== p.id),
                    )
                  }
                >
                  <Trash2 size={17} />
                </button>
              )}
            </div>
            <div className="form-grid three">
              {(
                [
                  ['surname', '英文姓氏', 'Surname'],
                  ['givenName', '英文名字', 'Given names'],
                  ['chineseName', '中文姓名（選填）', 'Chinese name (optional)'],
                  ['email', '電子郵件', 'Email'],
                  ['nationality', '國籍代碼（如 TWN）', 'Nationality code (e.g. TWN)'],
                ] as const
              ).map(([key, zh, en]) => (
                <Field key={key} label={t(zh, en)}>
                  <input
                    value={p[key]}
                    type={key === 'email' ? 'email' : 'text'}
                    maxLength={key === 'nationality' ? 3 : 60}
                    onChange={(e) =>
                      person(
                        i,
                        key,
                        key === 'nationality' ? e.target.value.toUpperCase() : e.target.value,
                      )
                    }
                  />
                </Field>
              ))}
              <Field label={t('出生日期', 'Date of birth')}>
                <input
                  type="date"
                  value={p.birthDate}
                  onChange={(e) => person(i, 'birthDate', e.target.value)}
                />
              </Field>
              <Field label={t('證件類型', 'Identification type')}>
                <select
                  value={p.identityType}
                  onChange={(e) => person(i, 'identityType', e.target.value)}
                >
                  <option value="passport">{t('護照', 'Passport')}</option>
                  <option value="hkid">{t('香港身分證', 'HK identity card')}</option>
                </select>
              </Field>
              <Field
                label={t('證件號碼', 'Identification number')}
                hint={
                  p.identityType === 'hkid'
                    ? t(
                        '使用大寫字母，例如 A123456(7)。',
                        'Use uppercase letters, e.g. A123456(7).',
                      )
                    : undefined
                }
              >
                <input
                  value={p.identityNumber}
                  maxLength={25}
                  onChange={(e) => person(i, 'identityNumber', e.target.value)}
                />
              </Field>
              <Field label={t('持有普通股數目', 'Ordinary shares held')}>
                <input
                  type="number"
                  min={0}
                  max={999999999999}
                  value={p.shares}
                  onChange={(e) => person(i, 'shares', Number(e.target.value))}
                />
              </Field>
              <Field label={t('出資金額', 'Capital contribution')}>
                <input
                  value={p.contribution}
                  inputMode="decimal"
                  maxLength={16}
                  onChange={(e) => person(i, 'contribution', e.target.value)}
                />
              </Field>
              <Field label={t('官方個人帳戶 ID（如已登記）', 'Registry user ID (if registered)')}>
                <input
                  value={p.officialUserId}
                  maxLength={16}
                  autoComplete="off"
                  onChange={(e) => person(i, 'officialUserId', e.target.value)}
                />
              </Field>
            </div>
            <div className="form-grid">
              {(
                [
                  [
                    'passportCountry',
                    '護照簽發國家代碼（如 TWN）',
                    'Passport issuing country (e.g. TWN)',
                  ],
                  ['previousEnglishName', '曾用英文姓名（如有）', 'Previous English name (if any)'],
                  ['previousChineseName', '曾用中文姓名（如有）', 'Previous Chinese name (if any)'],
                  ['aliasEnglishName', '英文別名（如有）', 'English alias (if any)'],
                  ['aliasChineseName', '中文別名（如有）', 'Chinese alias (if any)'],
                ] as const
              ).map(([key, zh, en]) => (
                <Field key={key} label={t(zh, en)}>
                  <input
                    value={p[key] || ''}
                    maxLength={key === 'passportCountry' ? 3 : 160}
                    onChange={(e) => person(i, key, e.target.value)}
                  />
                </Field>
              ))}
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={p.director}
                onChange={(e) => person(i, 'director', e.target.checked)}
              />
              {t('同時擔任董事', 'This person is a director')}
            </label>
            <AddressFields
              title={t('通常住址', 'Residential address')}
              value={p.address}
              onChange={(v) => person(i, 'address', v)}
            />
            {p.director && (
              <>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => person(i, 'correspondence', { ...p.address })}
                >
                  {t('將住址複製為通訊地址', 'Copy residential address to correspondence')}
                </button>
                <AddressFields
                  title={t('董事通訊地址', 'Director correspondence address')}
                  value={p.correspondence}
                  onChange={(v) => person(i, 'correspondence', v)}
                />
              </>
            )}
          </section>
        ))}
        {editable && (
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              set('people', [
                ...data.people,
                {
                  id: crypto.randomUUID(),
                  surname: '',
                  givenName: '',
                  chineseName: '',
                  email: '',
                  nationality: '',
                  birthDate: '',
                  identityType: 'passport',
                  identityNumber: '',
                  address: { ...emptyAddress },
                  correspondence: { ...emptyAddress },
                  shares: 0,
                  contribution: '0',
                  director: true,
                  officialUserId: '',
                  passportCountry: '',
                  previousEnglishName: '',
                  previousChineseName: '',
                  aliasEnglishName: '',
                  aliasChineseName: '',
                },
              ])
            }
          >
            <Plus size={17} />
            {t('新增成員', 'Add a person')}
          </button>
        )}
        <Field
          label={t('創辦成員簽署人', 'Founder member who will sign')}
          hint={t(
            '選擇一位股東作為公司設立表格的簽署人。',
            'Select a shareholder to sign the incorporation form.',
          )}
        >
          <select
            value={data.founderSignerId}
            onChange={(e) => set('founderSignerId', e.target.value)}
          >
            <option value="">{t('請選擇', 'Select a founder')}</option>
            {data.people
              .filter((p) => p.shares > 0)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.surname} {p.givenName}
                </option>
              ))}
          </select>
        </Field>
      </fieldset>
      {editable && (
        <div className="save-bar">
          <span>
            {saved ? (
              <>
                <Check size={17} />
                {t('資料已儲存', 'Changes saved')}
              </>
            ) : (
              t('可隨時儲存，稍後繼續。', 'Save your progress and continue later.')
            )}
          </span>
          <button className="button" disabled={busy}>
            <Save size={17} />
            {busy ? t('儲存中…', 'Saving…') : t('儲存資料', 'Save information')}
          </button>
        </div>
      )}
    </form>
  );
}
