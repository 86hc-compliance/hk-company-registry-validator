import { test, expect, type Page } from '@playwright/test';
import { randomBytes, createHash } from 'node:crypto';

const password = 'Fictional-test-password-123!';
async function signup(page: Page, email: string) {
  await page.goto('/sign-up');
  await page.getByLabel('你的姓名', { exact: true }).fill('測試使用者');
  await page.getByLabel('電子郵件', { exact: true }).fill(email);
  await page.getByLabel('密碼', { exact: true }).fill(password);
  await page.getByRole('button', { name: '建立帳戶', exact: true }).click();
  await page.waitForURL('**/cases');
}
test('customer and staff complete TWD quote, evidence, deposit, review and full refund', async ({
  browser,
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const adminContext = await browser.newContext({ baseURL: 'http://localhost:3188' }),
    admin = await adminContext.newPage();
  try {
    const created = await admin.request.post('/api/auth/sign-up/email', {
      data: { email: 'e2e-ops@example.test', password, name: 'Fictional staff' },
      headers: { Origin: 'http://localhost:3188' },
    });
    if (!created.ok())
      await admin.request.post('/api/auth/sign-in/email', {
        data: { email: 'e2e-ops@example.test', password },
        headers: { Origin: 'http://localhost:3188' },
      });
    await admin.goto('/settings');
    const pricing = admin.locator('.settings-prices form').nth(2);
    await pricing.getByLabel('服務費（未稅）', { exact: true }).fill('8001');
    await pricing.getByLabel('代收政府費（未稅）', { exact: true }).fill('2000');
    await pricing.getByLabel('收款公司法定名稱').fill('虛構測試台灣公司');
    await pricing.getByLabel('銀行名稱').fill('Fictional test bank');
    await pricing.getByLabel('收款帳號').fill('TEST-NOT-A-BANK-ACCOUNT');
    await pricing.getByRole('button', { name: '儲存報價' }).click();
    await expect(pricing.getByRole('status')).toHaveText('已儲存');
    const stamp = Date.now(),
      email = `e2e-${stamp}@example.test`,
      name = `NORTHWARD TEST ${String(stamp).slice(-5)} LIMITED`;
    await signup(page, email);
    await page.getByRole('button', { name: '新增申請' }).click();
    await page.getByLabel('付款幣別').selectOption('TWD');
    await page.getByRole('button', { name: '建立草稿' }).click();
    await page.waitForURL(/\/cases\/.+/);
    const caseUrl = page.url();
    await page.getByRole('button', { name: '申請資料', exact: true }).click();
    for (const [label, value] of [
      ['英文公司名稱', name],
      ['業務性質代碼', '620'],
      ['業務內容', 'Fictional software test company'],
      ['資金來源與成立目的', 'Fictional personal savings'],
      ['發行股份總數', '100'],
      ['已繳股本總額', '100'],
    ])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('button', { name: '新增成員' }).click();
    for (const [label, value] of [
      ['英文姓氏', 'TEST'],
      ['英文名字', 'ALICE'],
      ['電子郵件', email],
      ['國籍代碼（如 TWN）', 'TWN'],
      ['出生日期', '1990-01-01'],
      ['證件號碼', 'FAKE0001'],
      ['持有普通股數目', '100'],
      ['出資金額', '100'],
      ['官方個人帳戶 ID（如已登記）', 'FAKEUSER'],
      ['護照簽發國家代碼（如 TWN）', 'TWN'],
    ])
      await page.getByLabel(label, { exact: true }).fill(value);
    const address = page.getByRole('group', { name: '通常住址', exact: true });
    await address.getByLabel('街道／屋苑／地段', { exact: true }).fill('1 Fictional Road');
    await address.getByLabel('國家或地區代碼（例如 HKG、TWN）', { exact: true }).fill('TWN');
    await page.getByRole('button', { name: '將住址複製為通訊地址' }).click();
    await page.getByLabel('創辦成員簽署人', { exact: true }).selectOption({ label: 'TEST ALICE' });
    await page.getByLabel('證件類型', { exact: true }).selectOption('hkid');
    await page.getByLabel('證件號碼', { exact: true }).fill('a123456(7)');
    await page.getByRole('button', { name: '儲存資料', exact: true }).click();
    await expect(page.getByText('資料已儲存', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '進度總覽', exact: true }).click();
    await expect(
      page.getByText('香港身分證號碼格式不正確，請使用大寫字母，例如 A123456(7)'),
    ).toBeVisible();
    await page.getByRole('button', { name: '報價與付款', exact: true }).click();
    await page.getByLabel('我已核對資料、報價及上述服務與退款範圍。', { exact: true }).check();
    await expect(page.getByRole('button', { name: '確認報價，取得轉帳資訊' })).toBeDisabled();
    await page.getByRole('button', { name: '申請資料', exact: true }).click();
    await page.getByLabel('證件號碼', { exact: true }).fill('A123456(7)');
    await page.getByRole('button', { name: '儲存資料', exact: true }).click();
    await expect(page.getByText('資料已儲存', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '文件', exact: true }).click();
    for (const [kind, name] of [
      ['identity', '身分證明.pdf'],
      ['address', '地址證明.pdf'],
      ['payment_proof', '轉帳憑證.pdf'],
    ]) {
      await page.getByLabel('文件類型', { exact: true }).selectOption(kind);
      await page.locator('input[type=file]').setInputFiles({
        name,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\nFictional test evidence only'),
      });
      await page.getByRole('button', { name: '上傳文件', exact: true }).click();
      const link = page.getByRole('link', { name: `下載 ${name}` });
      await expect(link).toBeVisible();
      const download = page.waitForEvent('download');
      await link.click();
      expect((await download).suggestedFilename()).toBe(name);
    }
    await page.getByRole('button', { name: '報價與付款', exact: true }).click();
    await expect(page.locator('.quote-total')).toContainText('10,501');
    await page.getByLabel('我已核對資料、報價及上述服務與退款範圍。', { exact: true }).check();
    await page.getByRole('button', { name: '確認報價，取得轉帳資訊' }).click();
    await page.getByLabel('銀行交易編號', { exact: true }).fill(`CUSTOMER-${stamp}`);
    await page.getByRole('button', { name: '已轉帳，通知 Norby 核對' }).click();
    await expect(page.locator('.page-heading .status')).toContainText('待確認入帳');
    await admin.goto(caseUrl);
    await admin.getByLabel('實際入帳金額 (TWD)', { exact: true }).fill('10501');
    await admin.getByLabel('銀行交易編號', { exact: true }).fill(`DEPOSIT-${stamp}`);
    await admin.getByRole('button', { name: '確認實際入帳', exact: true }).click();
    await expect(admin.locator('.page-heading .status')).toContainText('Norby 審核中');
    await page.reload();
    await expect(page.locator('.page-heading .status')).toContainText('Norby 審核中');
    await page.screenshot({ path: '../../.context/norby-case-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '../../.context/norby-case-mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await admin
      .getByLabel('審核／核對紀錄（客戶可見）')
      .fill('Fictional review completed for automated testing.');
    const reviewChecks = [
      '身分及證明文件已核實',
      '實益擁有人已核實',
      '業務目的與資金來源已核實',
      '已完成制裁／PEP 等必要篩查',
    ];
    for (const label of reviewChecks) await admin.getByLabel(label, { exact: true }).check();
    await admin
      .getByLabel('審核／核對紀錄（客戶可見）')
      .fill('Fictional request to reconfirm the supplied information.');
    await admin.getByRole('button', { name: '要求補件', exact: true }).click();
    await expect(admin.locator('.page-heading .status')).toContainText('待補件');
    await expect(admin.getByLabel('審核／核對紀錄（客戶可見）')).toHaveValue('');
    await page.getByRole('button', { name: '更新進度', exact: true }).click();
    await page.getByRole('button', { name: '資料已補齊，重新送審', exact: true }).click();
    await expect(page.locator('.page-heading .status')).toContainText('Norby 審核中');
    await admin.getByRole('button', { name: '更新進度', exact: true }).click();
    await expect(admin.locator('.page-heading .status')).toContainText('Norby 審核中');
    for (const label of reviewChecks) {
      await expect(admin.getByLabel(label, { exact: true })).not.toBeChecked();
      await admin.getByLabel(label, { exact: true }).check();
    }
    await admin
      .getByLabel('審核／核對紀錄（客戶可見）')
      .fill('Fictional review completed for automated testing.');
    await admin.getByRole('button', { name: '人工審核通過', exact: true }).click();
    await expect(admin.locator('.page-heading .status')).toContainText('準備簽署');
    await expect(admin.getByLabel('審核／核對紀錄（客戶可見）')).toHaveValue('');
    await expect(admin.getByRole('button', { name: '拒絕審核並啟動全額退款' })).toBeDisabled();
    const rejectionNote = 'Fictional rejection reason for the refund regression test.';
    await admin.getByLabel('審核／核對紀錄（客戶可見）').fill(rejectionNote);
    await admin.getByRole('button', { name: '拒絕審核並啟動全額退款' }).click();
    await expect(admin.locator('.page-heading .status')).toContainText('全額退款處理中');
    await expect(admin.getByLabel('實際退款金額 (TWD)', { exact: true })).toHaveValue('');
    await expect(admin.getByLabel('銀行交易編號', { exact: true })).toHaveValue('');
    await expect(admin.getByRole('button', { name: '確認已全額退款', exact: true })).toBeDisabled();
    await admin.getByLabel('實際退款金額 (TWD)', { exact: true }).fill('10501');
    await admin.getByLabel('銀行交易編號', { exact: true }).fill(`REFUND-${stamp}`);
    await admin.getByRole('button', { name: '確認已全額退款', exact: true }).click();
    await expect(admin.locator('.page-heading .status')).toContainText('已全額退款');
    await page.reload();
    await expect(page.locator('.page-heading .status')).toContainText('已全額退款');
    const refunded = await (await page.request.get(`/api${new URL(caseUrl).pathname}`)).json();
    expect(
      refunded.events.find((event: { action: string }) => event.action === 'reject').note,
    ).toBe(rejectionNote);
    expect(
      refunded.ledger.find((entry: { kind: string }) => entry.kind === 'customer_refund').reference,
    ).toBe(`REFUND-${stamp}`);
    expect(errors).toEqual([]);
  } finally {
    await adminContext.close();
  }
});

for (const locale of ['zh-Hant', 'en']) {
  test(`sign-up explains email verification in TPSI preview (${locale})`, async ({ page }) => {
    await page.addInitScript(
      (language) => localStorage.setItem('norby-language', language),
      locale,
    );
    await page.route('**/api/public', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), preview: true, emailVerificationRequired: true },
      });
    });
    await page.route('**/api/auth/sign-up/email', (route) =>
      route.fulfill({
        json: {
          token: null,
          user: {
            id: 'fictional-unverified',
            email: 'unverified@example.test',
            name: 'Test',
            emailVerified: false,
          },
        },
      }),
    );
    await page.goto('/sign-up');
    await page.locator('input[name=name]').fill('Test');
    await page.locator('input[name=email]').fill('unverified@example.test');
    await page.locator('input[name=password]').fill(password);
    await page.locator('.auth-panel button[type=submit], .auth-panel form button').click();
    await expect(page.locator('.auth-panel .notice.success')).toContainText(
      locale === 'en'
        ? 'Check your inbox and follow the link to continue.'
        : '請查看你的信箱，依照信中連結繼續。',
    );
    await expect(page).toHaveURL(/\/sign-up$/);
  });
}
test('real browser OAuth consent and revocation; English and mobile navigation', async ({
  page,
  request,
}) => {
  await signup(page, `oauth-${Date.now()}@example.test`);
  const registered = await request.post('/api/auth/oauth2/register', {
    data: {
      client_name: 'Fictional Research Agent',
      redirect_uris: ['http://127.0.0.1:7777/callback'],
      token_endpoint_auth_method: 'none',
      scope: 'openid cases:read cases:write',
    },
    headers: { Origin: 'http://localhost:3188' },
  });
  expect(registered.status()).toBe(201);
  const { client_id } = await registered.json();
  const verifier = randomBytes(48).toString('base64url');
  const params = new URLSearchParams({
    client_id,
    redirect_uri: 'http://127.0.0.1:7777/callback',
    response_type: 'code',
    scope: 'openid cases:read cases:write',
    state: 'browser-test-state',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource: 'http://localhost:3188/mcp',
  });
  await page.route('http://127.0.0.1:7777/callback**', (route) =>
    route.fulfill({ body: 'Fictional OAuth client callback' }),
  );
  await page.goto(`/api/auth/oauth2/authorize?${params}`);
  await page.waitForURL('**/consent?**');
  await expect(page.getByText('Fictional Research Agent', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '同意授權', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:7777/callback**');
  expect(new URL(page.url()).searchParams.get('code')).toBeTruthy();
  await page.goto('/connections');
  await page.getByRole('button', { name: '撤銷授權' }).click();
  await expect(page.getByText('目前沒有代理能存取你的案件')).toBeVisible();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your agent. Your control.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('link', { name: 'My cases', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
