/**
 * TypeScript Definitions for @86hc/company-registry-validator
 * Maintained by HC BUSINESS LIMITED (https://www.86hc.com)
 */

export interface CRValidationResult {
  valid: boolean;
  error: string | null;
  raw?: string;
  formatted: string;
  isPadded?: boolean;
}

export interface BRNValidationResult {
  valid: boolean;
  error: string | null;
  baseBrn?: string;
  branchCode?: string;
  formatted: string;
}

export function validateCRNumber(crNo: string | number): CRValidationResult;
export function validateBRN(brn: string | number): BRNValidationResult;
