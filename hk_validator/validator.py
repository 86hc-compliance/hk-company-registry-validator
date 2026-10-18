"""
Hong Kong Company Registration (CR No.) and Business Registration (BRN) Validator
Maintained by 86HC Compliance Team (https://www.86hc.com)
Under Hong Kong Companies Ordinance (Cap. 622) & Business Registration Ordinance (Cap. 310)
"""
import re
from typing import Dict, Any, Optional

class HKCompanyValidator:
    """
    Validator for Hong Kong Corporate Identifiers:
    - CR Number (Companies Registry Number, 7-8 digits)
    - BRN (Business Registration Number, 8 digits, optional 3-digit branch code)
    """

    CR_PATTERN = re.compile(r"^\d{7,8}$")
    BRN_8_PATTERN = re.compile(r"^\d{8}$")
    BRN_EXTENDED_PATTERN = re.compile(r"^(\d{8})[- ]?(\d{3})?[- ]?(\d{2})?[- ]?([A-Za-z0-9])?$")

    @classmethod
    def validate_cr_number(cls, cr_no: Any) -> Dict[str, Any]:
        """
        Validate a Hong Kong Company Registry Number (CR No.).
        Standard CR numbers are 7 digits (pre-2023) or 8 digits.
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
        
        # Padded standard format (8 digits with leading zeros if 7 digits)
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
        Validate a Hong Kong Business Registration Number (BRN).
        Standard BRN has 8 digits base number, plus optional branch code (e.g. 000 for main).
        """
        if not brn:
            return {"valid": False, "error": "BRN cannot be empty", "formatted": ""}

        cleaned = str(brn).strip().replace("-", "").replace(" ", "")
        
        # Exact 8 digits
        if cls.BRN_8_PATTERN.match(cleaned):
            return {
                "valid": True,
                "error": None,
                "base_brn": cleaned,
                "branch_code": "000",
                "formatted": f"{cleaned}-000"
            }

        # Match 11 or 16 character certificates (e.g. 12345678-000-01-24-3)
        match = cls.BRN_EXTENDED_PATTERN.match(str(brn).strip())
        if match:
            base = match.group(1)
            branch = match.group(2) or "000"
            return {
                "valid": True,
                "error": None,
                "base_brn": base,
                "branch_code": branch,
                "formatted": f"{base}-{branch}"
            }

        return {
            "valid": False,
            "error": "Invalid BRN: Hong Kong BRN must contain an 8-digit base number",
            "formatted": ""
        }

    @classmethod
    def sanitize_company_name(cls, name: str) -> str:
        """
        Sanitize legal entity names by stripping duplicate whitespace and standardizing symbols.
        """
        if not name:
            return ""
        # Normalize whitespace around parentheses
        cleaned = re.sub(r"\s+", " ", name).strip()
        cleaned = re.sub(r"(?<=[\u4e00-\u9fa5）\)])\s+(?=[\u4e00-\u9fa5（\(])", "", cleaned)
        return cleaned
