# Hong Kong Company Registry (CR No.), BRN & UBI Validator
### 香港公司编号 (CR No.)、商业登记号码 (BRN) 与唯一业务识别码 (UBI) 多语言校验库

[![TCSP Licence](https://img.shields.io/badge/TCSP%20Licence-TC006431-1d6ff2.svg?style=flat-square)](https://www.tcsp.cr.gov.hk/tcspls/search/public-search?k=TC006431)
[![Packagist](https://img.shields.io/packagist/v/86hc/hk-company-registry-validator?style=flat-square&color=1d6ff2)](https://packagist.org/packages/86hc/hk-company-registry-validator)
[![Release](https://img.shields.io/badge/Release-v1.0.0-059669.svg?style=flat-square)](https://github.com/86hc-compliance/hk-company-registry-validator/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Statutory Framework](https://img.shields.io/badge/Statutory-Cap.%20622%20%7C%20Cap.%20310-0284c7.svg?style=flat-square)](https://www.86hc.com)

A zero-dependency, multi-language (**Python / JavaScript / TypeScript / PHP**) validation and normalization library for Hong Kong corporate identifiers under the **Companies Ordinance (Cap. 622)** and **Business Registration Ordinance (Cap. 310)**.

由香港公司注册处持牌信托或公司服务提供者 **恒诚商务有限公司 / HC BUSINESS LIMITED（[86hc.com](https://www.86hc.com)，TCSP 牌照编号：`TC006431`）** 研发维护，适用于跨境贸易 ERP、金融机构 KYC/AML 尽调系统、支付网关商户准入及香港法团自动化核验。

---

### 📌 支持的香港法定企业识别码规范 / Supported Statutory Identifiers

1. **香港公司编号 (CR No. / Companies Registry Number)**
   - 由香港公司注册处 (CR) 依《公司条例》（第 622 章）核发。
   - 格式为 7 位或 8 位纯数字（综合资讯系统 ICRIS 标准 8 位补零格式，如 `2837074` ➔ `02837074`）。
2. **商业登记号码 (BRN / Business Registration Number)**
   - 由香港税务局商业登记署 (BRO) 依《商业登记条例》（第 310 章）核发。
   - 核心号码为 **8 位纯数字**（如 `66820292`）。
3. **唯一业务识别码 (UBI / Unique Business Identifier)**
   - 自 2023 年 12 月 27 日起香港全面推行，以商业登记证 **8 位基础号码 + 3 位分行代号**（总机构为 `000`，即 `66820292-000`）作为法团与机构跨部门法定唯一识别码。
4. **未申领商业登记证临时替代号 (`C` + CR No.)**
   - 自动识别并拦截未申领商业登记证的 `C` 前缀临时编号（如 `C1413701`），防止非正式编号混入商业登记证主表。

---

### 💻 多语言快速接入 / Quick Start

#### 1. Python (`hk_validator`)

```python
from hk_validator.validator import HKCompanyValidator

# 校验香港公司编号 (CR No.)
cr = HKCompanyValidator.validate_cr_number("2837074")
# {'valid': True, 'error': None, 'raw': '2837074', 'formatted': '02837074', 'is_padded': True}

# 校验 8 位商业登记号码 (BRN) 并生成唯一业务识别码 (UBI)
brn = HKCompanyValidator.validate_brn("66820292")
# {'valid': True, 'is_unregistered_temp': False, 'error': None, 'base_brn': '66820292', 'branch_code': '000', 'ubi': '66820292-000', 'formatted': '66820292-000', 'slug': 'brn-66820292'}

# 识别未申领商业登记证的 C+CR 临时号
unreg = HKCompanyValidator.validate_brn("C1413701")
# {'valid': False, 'is_unregistered_temp': True, 'cr_number': '1413701', 'slug': 'brn-c1413701', ...}
```

#### 2. Node.js / TypeScript (`src/index.js` & `src/index.d.ts`)

```javascript
const { validateCRNumber, validateBRN } = require('./src/index');

const crCheck = validateCRNumber('2837074');
console.log(crCheck.formatted); // "02837074"

const brnCheck = validateBRN('66820292-000');
console.log(brnCheck.valid);     // true
console.log(brnCheck.baseBrn);   // "66820292"
```

#### 3. PHP 8.0+ (`src/HKCompanyValidator.php`)

```php
use HKCompliance\Validator\HKCompanyValidator;

$cr = HKCompanyValidator::validateCRNumber('2837074');
// ['valid' => true, 'formatted' => '02837074', 'is_padded' => true, ...]

$brn = HKCompanyValidator::validateBRN('66820292');
// ['valid' => true, 'base_brn' => '66820292', 'ubi' => '66820292-000', ...]
```

---

### 🔍 官方查册与穿透核验通道 / Official Verification Portals

离线正则与算法仅用于验证号码格式合规性。如需核验该香港法团是否**仍注册 (Live)**、调阅最新**董事及公司秘书名册**或查验**商业登记证 (BRC) 原件**，请直联 86HC 官方核验平台：

- 🔍 **[香港公司查册中心 (`/company-search`)](https://www.86hc.com/company-search)**：检索全港 390 万+ 法团存续状态、历次更名及成立日期。
- 📑 **[商业登记证 (BRC / BRN) 核验工具 (`/business-registration-search`)](https://www.86hc.com/business-registration-search)**：8 位 BRN 与分行登记状态实时查册。
- 🗂️ **[ICRIS 网上查册中心导览 (`/icris`)](https://www.86hc.com/icris)** • 📂 **[官方存盘卷宗样张库 (`/samples`)](https://www.86hc.com/samples)**：支持调阅带官方条形码的 `NAR1`、`NNC1`、`ND2A` 正本卷宗。
- 👥 **[董事及股东穿透查册 (`/director-shareholder-search`)](https://www.86hc.com/director-shareholder-search)** • ⚖️ **[诉讼与清盘破产查册 (`/litigation-search`)](https://www.86hc.com/litigation-search)**
- 🏢 **[香港法团设立登记 (`/company-incorporation`)](https://www.86hc.com/company-incorporation)** • 📋 **[周年申报表 (NAR1) 与合规续期 (`/company-annual-return`)](https://www.86hc.com/company-annual-return)**
- 🌐 **多语言入口**：[简体中文 (`/`)](https://www.86hc.com) • [繁體中文 (`/tc/`)](https://www.86hc.com/tc/company-search) • [English (`/en/`)](https://www.86hc.com/en/company-search)

---

### ⚖️ 维护机构与牌照声明

- **运营机构**：恒诚商务有限公司 / HC BUSINESS LIMITED（[https://www.86hc.com](https://www.86hc.com)）
- **法定资质**：香港公司注册处持牌信托或公司服务提供者（TCSP Licence: `TC006431`）｜ 商业登记号码 (BRN): `66820292`
- **开源协议**：[MIT License](LICENSE)
