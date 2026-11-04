/**
 * Hong Kong Company Registration (CR No.) and Business Registration (BRN) Validator
 * Maintained by 86HC Compliance Team (https://www.86hc.com)
 * Under Hong Kong Companies Ordinance (Cap. 622) & Business Registration Ordinance (Cap. 310)
 */

const CR_REGEX = /^\d{7,8}$/;
const BRN_8_REGEX = /^\d{8}$/;
const BRN_EXTENDED_REGEX = /^(\d{8})(?:[- ]?(\d{3}))?$/;

function validateCRNumber(crNo) {
  if (!crNo) {
    return { valid: false, error: 'CR number cannot be empty', formatted: '' };
  }
  const cleaned = String(crNo).trim();
  if (!CR_REGEX.test(cleaned)) {
    return {
      valid: false,
      error: 'Invalid format: HK CR Number must be 7 or 8 numeric digits',
      formatted: ''
    };
  }
  const formatted = cleaned.padStart(8, '0');
  return {
    valid: true,
    error: null,
    raw: cleaned,
    formatted,
    isPadded: cleaned.length === 7
  };
}

function validateBRN(brn) {
  if (!brn) {
    return { valid: false, error: 'BRN cannot be empty', formatted: '' };
  }
  const raw = String(brn).trim();
  const cleaned = raw;

  if (BRN_8_REGEX.test(cleaned)) {
    return {
      valid: true,
      error: null,
      baseBrn: cleaned,
      branchCode: '000',
      formatted: `${cleaned}-000`
    };
  }

  const match = raw.match(BRN_EXTENDED_REGEX);
  if (match) {
    const base = match[1];
    const branch = match[2] || '000';
    return {
      valid: true,
      error: null,
      baseBrn: base,
      branchCode: branch,
      formatted: `${base}-${branch}`
    };
  }

  return {
    valid: false,
    error: 'Invalid BRN: Hong Kong BRN must contain an 8-digit base number',
    formatted: ''
  };
}

module.exports = {
  validateCRNumber,
  validateBRN
};
