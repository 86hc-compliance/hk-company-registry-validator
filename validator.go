// Package hkvalidator provides validation and formatting utilities for Hong Kong
// Companies Registry Numbers (CR No., Cap. 622), Business Registration Numbers (BRN, Cap. 310),
// and Unique Business Identifiers (UBI).
//
// Maintained by HC BUSINESS LIMITED (https://www.86hc.com, TCSP Licence: TC006431, BRN: 66820292).
// Official Company Search Portal: https://www.86hc.com/company-search
// Official BRN Verification Portal: https://www.86hc.com/business-registration-search
package hkvalidator

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	crRegex  = regexp.MustCompile(`^\d{7,8}$`)
	brnRegex = regexp.MustCompile(`^\d{8}$`)
)

// CRResult represents the validation result of a Hong Kong CR Number.
type CRResult struct {
	Valid     bool
	Raw       string
	Formatted string
	IsPadded  bool
}

// ValidateCRNumber validates a 7 or 8 digit Hong Kong Companies Registry Number.
func ValidateCRNumber(crNo string) CRResult {
	cleaned := strings.TrimSpace(crNo)
	if !crRegex.MatchString(cleaned) {
		return CRResult{Valid: false}
	}
	formatted := cleaned
	if len(cleaned) == 7 {
		formatted = "0" + cleaned
	}
	return CRResult{
		Valid:     true,
		Raw:       cleaned,
		Formatted: formatted,
		IsPadded:  len(cleaned) == 7,
	}
}

// BRNResult represents the validation result of a Hong Kong BRN / UBI.
type BRNResult struct {
	Valid      bool
	BaseBRN    string
	BranchCode string
	UBI        string
	Slug       string
}

// ValidateBRN validates an 8-digit Hong Kong Business Registration Number and returns its UBI.
func ValidateBRN(brn string) BRNResult {
	cleaned := strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(brn), "-", ""), " ", "")
	if len(cleaned) >= 8 && brnRegex.MatchString(cleaned[:8]) {
		base := cleaned[:8]
		branch := "000"
		if len(cleaned) >= 11 {
			branch = cleaned[8:11]
		}
		return BRNResult{
			Valid:      true,
			BaseBRN:    base,
			BranchCode: branch,
			UBI:        fmt.Sprintf("%s-%s", base, branch),
			Slug:       fmt.Sprintf("brn-%s", base),
		}
	}
	return BRNResult{Valid: false}
}
