"""
Hong Kong Company Registration (CR No.), Business Registration (BRN) & UBI Validator
Maintained by HC BUSINESS LIMITED / 86HC Compliance Team (https://www.86hc.com)
Under Hong Kong Companies Ordinance (Cap. 622) & Business Registration Ordinance (Cap. 310)
"""
import re
from typing import Dict, Any

class HKCompanyValidator:
    """
    Validator for Hong Kong Statutory Corporate Identifiers:
    - CR Number (Companies Registry Number, 7-8 numeric digits)
    - BRN (Business Registration Number, 8 numeric digits)
    - UBI (Unique Business Identifier, 8-digit BRN + 3-digit branch code, e.g. 66820292-000)
    - Unregistered BRN Temporary Code (C + CR No., e.g. C1413701)
    """

    CR_PATTERN = re.compile(r"^\d{7,8}$")
    BRN_8_PATTERN = re.compile(r"^\d{8}$")
    BRN_EXTENDED_PATTERN = re.compile(r"^(\d{8})[- ]?(\d{3})?(?:[- ]?(\d{2})[- ]?(\d{2})[- ]?([A-Za-z0-9]))?$")
    UNREGISTERED_BRN_PATTERN = re.compile(r"^[Cc](\d{7,8})$")

    @classmethod
    def validate_cr_number(cls, cr_no: Any) -> Dict[str, Any]:
        """
        Validate a Hong Kong Companies Registry Number (CR No.).
        """
        if not cr_no:
            return {"valid": False, "error": "CR number cannot be empty", "formatted": ""}

        cleaned = str(cr_no).strip()
        if not cls.CR_PATTERN.match(cleaned):
            return {
                "valid": False,
                "error": "Invalid format: HK CR Number must be 7 or 8 numeric digits",
                "formatted": ""
            }

        formatted = cleaned.zfill(8)
        return {
            "valid": True,
            "error": None,
            "raw": cleaned,
            "formatted": formatted,
            "is_padded": len(cleaned) == 7
        }

    @classmethod
    def validate_brn(cls, brn: Any) -> Dict[str, Any]:
        """
        Validate a Hong Kong Business Registration Number (BRN) or Unique Business Identifier (UBI).
        Also identifies temporary C+CR identifiers for corporations without a registered BRC.
        """
        if not brn:
            return {"valid": False, "error": "BRN cannot be empty", "formatted": ""}

        raw = str(brn).strip()

        # Check temporary C+CR identifier (unregistered BRC)
        unreg_match = cls.UNREGISTERED_BRN_PATTERN.match(raw)
        if unreg_match:
            cr_part = unreg_match.group(1)
            return {
                "valid": False,
                "is_unregistered_temp": True,
                "cr_number": cr_part,
                "error": "Unregistered BRN temporary identifier (C+CR); not an official 8-digit BRO BRN",
                "slug": f"brn-c{cr_part}"
            }

        cleaned = raw.replace("-", "").replace(" ", "")
        if cls.BRN_8_PATTERN.match(cleaned):
            return {
                "valid": True,
                "is_unregistered_temp": False,
                "error": None,
                "base_brn": cleaned,
                "branch_code": "000",
                "ubi": f"{cleaned}-000",
                "formatted": f"{cleaned}-000",
                "slug": f"brn-{cleaned}"
            }

        match = cls.BRN_EXTENDED_PATTERN.match(raw)
        if match:
            base = match.group(1)
            branch = match.group(2) or "000"
            return {
                "valid": True,
                "is_unregistered_temp": False,
                "error": None,
                "base_brn": base,
                "branch_code": branch,
                "ubi": f"{base}-{branch}",
                "formatted": f"{base}-{branch}",
                "slug": f"brn-{base}"
            }

        return {
            "valid": False,
            "is_unregistered_temp": False,
            "error": "Invalid BRN: Hong Kong BRN must contain an 8-digit numeric base number",
            "formatted": ""
        }

    @classmethod
    def sanitize_company_name(cls, name: str) -> str:
        """
        Sanitize Hong Kong corporate legal names (removes redundant spaces between CJK characters and brackets).
        """
        if not name:
            return ""
        cleaned = re.sub(r"\s+", " ", name).strip()
        cleaned = re.sub(r"(?<=[\u4e00-\u9fa5）\)])\s+(?=[\u4e00-\u9fa5（\(])", "", cleaned)
        return cleaned
