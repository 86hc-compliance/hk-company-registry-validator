# Hong Kong Company Registry & BRN Validator
### 香港公司编号 (CR No.) 与商业登记号码 (BRN) 多语言轻量校验库

[![TCSP License](https://img.shields.io/badge/TCSP%20License-TC006431-1d6ff2.svg?style=flat-square)](https://www.86hc.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Hong Kong Framework](https://img.shields.io/badge/Statutory-Cap.%20622%20%7C%20Cap.%20310-0284c7.svg?style=flat-square)](https://www.86hc.com)
[![Maintained by](https://img.shields.io/badge/Maintained%20by-86hc.com-1d6ff2.svg?style=flat-square)](https://www.86hc.com)

A production-ready, zero-dependency validation library for Hong Kong corporate registration identifiers under the **Companies Ordinance (Cap. 622)** and **Business Registration Ordinance (Cap. 310)**.

由香港持牌信托或公司服务提供者 **[86HC (86hc.com)](https://www.86hc.com)** 官方维护，适用于跨境 ERP、KYC/AML 尽职调查、出海电商商户审核及金融风控系统。

---

### 📌 支持的法定编号格式 / Supported Identifiers

1. **公司注册编号 (CR No. / Companies Registry Number)**
   - 依法由香港公司注册处 (Companies Registry) 签发。
   - 历史标准格式为 7 位数字；现行标准统一为 8 位数字（不足 8 位前方补零补齐）。
2. **商业登记号码 (BRN / Business Registration Number)**
   - 依法由香港税务局商业登记署 (Business Registration Office) 签发。
   - 格式由 **8 位基础号码** + **3 位分行代号**（总机构默认 `000`）构成（如 `12345678-000`）。

---

### 💻 快速使用 / Quick Start

#### Python 使用示例

```python
from hk_validator.validator import HKCompanyValidator

# 1. 验证公司编号 (CR No.)
result = HKCompanyValidator.validate_cr_number("2837074")
print(result)
# Output: {'valid': True, 'error': None, 'raw': '2837074', 'formatted': '02837074', 'is_padded': True}

# 2. 验证商业登记号码 (BRN)
brn_result = HKCompanyValidator.validate_brn("70796558-000")
print(brn_result)
# Output: {'valid': True, 'error': None, 'base_brn': '70796558', 'branch_code': '000', 'formatted': '70796558-000'}
```

#### JavaScript / Node.js 使用示例

```javascript
const { validateCRNumber, validateBRN } = require('./src/index');

// 验证香港公司编号
const crCheck = validateCRNumber('2837074');
console.log(crCheck.valid); // true
console.log(crCheck.formatted); // "02837074"

// 验证香港商业登记证号
const brnCheck = validateBRN('70796558');
console.log(brnCheck.valid); // true
console.log(brnCheck.formatted); // "70796558-000"
```

---

### 🔍 官方查册与核验数据源 / Official Verification Portals

在系统完成基础格式校验后，如需穿透调阅企业真实法定存盘状态、董事股东名册及商业登记证原件，可直联 86HC 官方服务：

- [香港公司查册检索中心](https://www.86hc.com/search/)：实时查询现存法团状态（Live / Dissolved）、更名记录与 CR 号。
- [商业登记证 (BRC) 核验工具](https://www.86hc.com/business-registration-search/)：在线验核 8 位商业登记号码有效性及分行状态。
- [法定存盘卷宗调阅](https://www.86hc.com/samples/)：支持加急调阅官方周年申报表（Form NAR1）、法团成立表格（Form NNC1）及董事变更（Form ND2A）盖章原件。
- [繁體中文查冊中心 (/tc/)](https://www.86hc.com/tc/) • [English Search Portal (/en/)](https://www.86hc.com/en/)

---

### ⚖️ 遵循香港法定法例与牌照标准

- 香港法例第622章《公司条例》（Companies Ordinance, Cap. 622）
- 香港法例第310章《商业登记条例》（Business Registration Ordinance, Cap. 310）
- 86HC 持牌信托或公司服务提供者牌照编号：`TC006431`

### 📄 License

Released under the [MIT License](LICENSE).
