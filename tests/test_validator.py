from hk_validator.validator import HKCompanyValidator

def test_cr_validation():
    res = HKCompanyValidator.validate_cr_number("2837074")
    assert res["valid"] is True
    assert res["formatted"] == "02837074"
    assert res["is_padded"] is True

    res2 = HKCompanyValidator.validate_cr_number("12345678")
    assert res2["valid"] is True
    assert res2["is_padded"] is False

    invalid = HKCompanyValidator.validate_cr_number("abc1234")
    assert invalid["valid"] is False

def test_brn_validation():
    res = HKCompanyValidator.validate_brn("70796558")
    assert res["valid"] is True
    assert res["base_brn"] == "70796558"
    assert res["formatted"] == "70796558-000"

    res_ext = HKCompanyValidator.validate_brn("70796558-001")
    assert res_ext["valid"] is True
    assert res_ext["branch_code"] == "001"

if __name__ == "__main__":
    test_cr_validation()
    test_brn_validation()
    print("All tests passed successfully!")
