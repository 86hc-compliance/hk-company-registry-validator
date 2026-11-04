import { createRequire } from 'node:module';
import { resolve } from 'node:path';
// The app is run from apps/platform; reuse the original zero-dependency validator.
const require = createRequire(resolve('package.json'));
export const { validateBRN, validateCRNumber } = require('../../src/index.js') as {
  validateBRN: (input: string) => {
    valid: boolean;
    formatted: string;
    baseBrn?: string;
    branchCode?: string;
    error: string | null;
  };
  validateCRNumber: (input: string) => { valid: boolean; formatted: string; error: string | null };
};
