export const knowledge = {
  reviewedAt: '2026-11-04',
  upstream: 'https://github.com/86hc-compliance/awesome-hong-kong-corporate-compliance',
  boundary: {
    zh: '此指南用於準備資料。格式校驗不能證明公司存在，亦不構成人工合規批准。',
    en: 'Preparation guidance only. Format validation does not verify company existence or constitute compliance approval.',
  },
  topics: [
    {
      id: 'formation',
      zh: '設立前準備',
      en: 'Before incorporation',
      textZh:
        '準備公司名稱、股東與董事資料、股本分配，以及秘書與香港註冊地址。Norby 會核對並協助申報。',
      textEn:
        'Prepare names, shareholder and director details, capital allocation, secretary and Hong Kong registered address. Norby reviews the application.',
      source: 'https://www.cr.gov.hk/en/services/register-company.htm',
    },
    {
      id: 'identity',
      zh: '號碼與身分核對',
      en: 'Identifiers and due diligence',
      textZh:
        '號碼格式、官方紀錄、個人身分與實益擁有人是不同檢查。代理可找出資料缺漏，Norby 完成人工審核。',
      textEn:
        'Identifier format, official records, personal identity and beneficial ownership are separate checks. Agents flag gaps; Norby performs the review.',
      source: 'https://www.cr.gov.hk/en/publications/docs/G_AntiMoney_TCSPs_(Mar2025)e.pdf',
    },
    {
      id: 'tpsi',
      zh: '簽署與官方提交',
      en: 'Signatures and official filing',
      textZh: '相關簽署人須備妥自己的官方帳戶。官方驗證及必要簽署完成後，才能透過 TPSI 正式提交。',
      textEn:
        'Signers need their own official accounts. Registry validation and required signatures precede TPSI filing.',
      source: 'https://www.cr.gov.hk/en/electronic/e-servicesportal/faq/tpsi.htm',
    },
    {
      id: 'ongoing',
      zh: '成立後的持續安排',
      en: 'After incorporation',
      textZh:
        '成立文件交付後，仍須分別安排周年申報、商業登記續期、帳務及稅務申報。第一版不自動辦理這些後續服務。',
      textEn:
        'After delivery, plan separately for annual returns, business registration renewal, accounting and tax filings. Version one does not automate these services.',
      source: 'https://www.cr.gov.hk/en/compliance/annual-return/private-company.htm',
    },
  ],
};
