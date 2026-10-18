<?php
/**
 * Hong Kong Company Registration (CR No.), Business Registration (BRN) & UBI Validator
 * Maintained by HC BUSINESS LIMITED / 86HC Compliance Team (https://www.86hc.com)
 * Under Hong Kong Companies Ordinance (Cap. 622) & Business Registration Ordinance (Cap. 310)
 */

namespace HKCompliance\Validator;

class HKCompanyValidator
{
    private const CR_PATTERN = '/^\d{7,8}$/';
    private const BRN_8_PATTERN = '/^\d{8}$/';
    private const BRN_EXTENDED_PATTERN = '/^(\d{8})[- ]?(\d{3})?(?:[- ]?(\d{2})[- ]?(\d{2})[- ]?([A-Za-z0-9]))?$/';
    private const UNREGISTERED_BRN_PATTERN = '/^[Cc](\d{7,8})$/';

    /**
     * Validate Hong Kong Companies Registry Number (CR No., 7-8 digits)
     *
     * @param string|int|null $crNo
     * @return array<string, mixed>
     */
    public static function validateCRNumber($crNo): array
    {
        if ($crNo === null || trim((string)$crNo) === '') {
            return [
                'valid' => false,
                'error' => 'CR number cannot be empty',
                'formatted' => ''
            ];
        }

        $cleaned = trim((string)$crNo);
        if (!preg_match(self::CR_PATTERN, $cleaned)) {
            return [
                'valid' => false,
                'error' => 'Invalid format: HK CR Number must be 7 or 8 numeric digits',
                'formatted' => ''
            ];
        }

        $formatted = str_pad($cleaned, 8, '0', STR_PAD_LEFT);
        return [
            'valid' => true,
            'error' => null,
            'raw' => $cleaned,
            'formatted' => $formatted,
            'is_padded' => strlen($cleaned) === 7
        ];
    }

    /**
     * Validate Hong Kong Business Registration Number (BRN, 8 digits) & UBI
     *
     * @param string|int|null $brn
     * @return array<string, mixed>
     */
    public static function validateBRN($brn): array
    {
        if ($brn === null || trim((string)$brn) === '') {
            return [
                'valid' => false,
                'error' => 'BRN cannot be empty',
                'formatted' => ''
            ];
        }

        $raw = trim((string)$brn);

        if (preg_match(self::UNREGISTERED_BRN_PATTERN, $raw, $unregMatch)) {
            $crPart = $unregMatch[1];
            return [
                'valid' => false,
                'is_unregistered_temp' => true,
                'cr_number' => $crPart,
                'error' => 'Unregistered BRN temporary identifier (C+CR); not an official 8-digit BRO BRN',
                'slug' => 'brn-c' . $crPart
            ];
        }

        $cleaned = str_replace(['-', ' '], '', $raw);
        if (preg_match(self::BRN_8_PATTERN, $cleaned)) {
            return [
                'valid' => true,
                'is_unregistered_temp' => false,
                'error' => null,
                'base_brn' => $cleaned,
                'branch_code' => '000',
                'ubi' => $cleaned . '-000',
                'formatted' => $cleaned . '-000',
                'slug' => 'brn-' . $cleaned
            ];
        }

        if (preg_match(self::BRN_EXTENDED_PATTERN, $raw, $matches)) {
            $base = $matches[1];
            $branch = !empty($matches[2]) ? $matches[2] : '000';
            return [
                'valid' => true,
                'is_unregistered_temp' => false,
                'error' => null,
                'base_brn' => $base,
                'branch_code' => $branch,
                'ubi' => $base . '-' . $branch,
                'formatted' => $base . '-' . $branch,
                'slug' => 'brn-' . $base
            ];
        }

        return [
            'valid' => false,
            'is_unregistered_temp' => false,
            'error' => 'Invalid BRN: Hong Kong BRN must contain an 8-digit numeric base number',
            'formatted' => ''
        ];
    }

    /**
     * Sanitize Chinese & English Corporate Legal Name
     */
    public static function sanitizeCompanyName(string $name): string
    {
        $cleaned = trim(preg_replace('/\s+/u', ' ', $name) ?? '');
        return preg_replace('/(?<=[\x{4e00}-\x{9fa5}）\)])\s+(?=[\x{4e00}-\x{9fa5}（\(])/u', '', $cleaned) ?? $cleaned;
    }
}
