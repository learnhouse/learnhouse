"""Tests for src/services/orgs/signup_fields.py.

These cover the security boundary of the custom-signup-fields feature: the
signup endpoints are public, so the server must build `extra_metadata` from the
org's declared fields alone and never from what the caller submitted.
"""

import pytest
from fastapi import HTTPException

from src.db.organization_config import SignupFieldItem
from src.services.orgs.signup_fields import (
    MAX_TEXT_LENGTH,
    MAX_TOTAL_SERIALIZED_BYTES,
    get_signup_fields,
    missing_required_fields,
    validate_signup_field_values,
)


def _fields():
    return [
        SignupFieldItem(key="company", label="Company", type="text", required=True, max_length=10),
        SignupFieldItem(key="notes", label="Notes", type="textarea"),
        SignupFieldItem(key="cohort", label="Cohort", type="select", options=["A", "B"]),
        SignupFieldItem(key="news", label="Newsletter", type="checkbox"),
        SignupFieldItem(key="age", label="Age", type="number", min_value=18, max_value=120),
        SignupFieldItem(key="start", label="Start", type="date"),
    ]


class TestGetSignupFields:
    def test_reads_v2_config_ordered_by_order(self):
        config = {
            "config_version": "2.0",
            "customization": {
                "signup_fields": {
                    "fields": [
                        {"key": "second", "order": 2},
                        {"key": "first", "order": 1},
                    ]
                }
            },
        }
        assert [f.key for f in get_signup_fields(config)] == ["first", "second"]

    def test_reads_v1_config(self):
        config = {
            "config_version": "1.4",
            "general": {"signup_fields": {"fields": [{"key": "company"}]}},
        }
        assert [f.key for f in get_signup_fields(config)] == ["company"]

    def test_missing_or_empty_config_yields_no_fields(self):
        assert get_signup_fields(None) == []
        assert get_signup_fields({}) == []
        assert get_signup_fields({"config_version": "2.0", "customization": {}}) == []

    def test_disabled_and_keyless_fields_are_skipped(self):
        config = {
            "config_version": "2.0",
            "customization": {
                "signup_fields": {
                    "fields": [
                        {"key": "on"},
                        {"key": "off", "enabled": False},
                        {"key": ""},
                    ]
                }
            },
        }
        assert [f.key for f in get_signup_fields(config)] == ["on"]

    def test_malformed_entries_do_not_break_signup(self):
        """A bad config must degrade to "no fields", never raise — otherwise a
        malformed entry would take the whole signup page down."""
        config = {
            "config_version": "2.0",
            "customization": {
                "signup_fields": {
                    "fields": ["not-a-dict", {"key": "good"}, {"type": "text"}]
                }
            },
        }
        assert [f.key for f in get_signup_fields(config)] == ["good"]

    def test_non_list_fields_value_is_ignored(self):
        config = {
            "config_version": "2.0",
            "customization": {"signup_fields": {"fields": "nope"}},
        }
        assert get_signup_fields(config) == []


class TestValidateSignupFieldValues:
    def test_accepts_and_coerces_every_supported_type(self):
        result = validate_signup_field_values(
            _fields(),
            {
                "company": " Acme ",
                "notes": "hello",
                "cohort": "A",
                "news": "true",
                "age": "42",
                "start": "2026-01-05",
            },
        )
        assert result == {
            "company": "Acme",
            "notes": "hello",
            "cohort": "A",
            "news": True,
            "age": 42,
            "start": "2026-01-05",
        }

    def test_undeclared_keys_are_dropped_not_stored(self):
        """The whole point of the feature's server side: a public caller cannot
        smuggle arbitrary keys into extra_metadata."""
        result = validate_signup_field_values(
            _fields(),
            {"company": "Acme", "is_superadmin": True, "anything": {"deep": [1, 2]}},
        )
        assert set(result) == {"company", "news"}
        assert "is_superadmin" not in result
        assert "anything" not in result

    def test_no_declared_fields_stores_nothing(self):
        assert validate_signup_field_values([], {"company": "Acme"}) == {}

    def test_non_dict_submission_is_tolerated(self):
        fields = [SignupFieldItem(key="opt", type="text")]
        assert validate_signup_field_values(fields, None) == {}
        assert validate_signup_field_values(fields, "junk") == {}  # type: ignore[arg-type]

    def test_missing_required_field_is_rejected(self):
        with pytest.raises(HTTPException) as exc:
            validate_signup_field_values(_fields(), {})
        assert exc.value.status_code == 400
        assert exc.value.detail["code"] == "SIGNUP_FIELD_INVALID"
        assert exc.value.detail["field"] == "company"

    def test_blank_required_field_is_rejected(self):
        with pytest.raises(HTTPException):
            validate_signup_field_values(_fields(), {"company": "   "})

    def test_optional_blank_fields_are_omitted(self):
        result = validate_signup_field_values(_fields(), {"company": "Acme", "notes": ""})
        assert "notes" not in result

    def test_select_value_outside_options_is_rejected(self):
        with pytest.raises(HTTPException) as exc:
            validate_signup_field_values(_fields(), {"company": "Acme", "cohort": "Z"})
        assert exc.value.detail["field"] == "cohort"

    def test_required_checkbox_must_be_ticked(self):
        fields = [SignupFieldItem(key="terms", type="checkbox", required=True)]
        with pytest.raises(HTTPException):
            validate_signup_field_values(fields, {"terms": False})
        assert validate_signup_field_values(fields, {"terms": "on"}) == {"terms": True}

    def test_optional_checkbox_defaults_to_false(self):
        fields = [SignupFieldItem(key="news", type="checkbox")]
        assert validate_signup_field_values(fields, {}) == {"news": False}

    @pytest.mark.parametrize("value", ["5", 5, 200, "nope", None])
    def test_number_out_of_range_or_unparseable_is_rejected(self, value):
        payload = {"company": "Acme", "age": value}
        if value is None:
            # None is "blank" on an optional field, so it is simply omitted.
            assert "age" not in validate_signup_field_values(_fields(), payload)
            return
        with pytest.raises(HTTPException):
            validate_signup_field_values(_fields(), payload)

    def test_whole_numbers_are_stored_as_ints(self):
        result = validate_signup_field_values(_fields(), {"company": "A", "age": "42.0"})
        assert result["age"] == 42
        assert isinstance(result["age"], int)

    def test_invalid_date_is_rejected(self):
        with pytest.raises(HTTPException) as exc:
            validate_signup_field_values(_fields(), {"company": "A", "start": "05/01/2026"})
        assert exc.value.detail["field"] == "start"

    def test_value_longer_than_field_max_length_is_rejected(self):
        with pytest.raises(HTTPException):
            validate_signup_field_values(_fields(), {"company": "x" * 11})

    def test_hard_text_ceiling_applies_without_a_configured_max_length(self):
        fields = [SignupFieldItem(key="notes", type="textarea")]
        with pytest.raises(HTTPException):
            validate_signup_field_values(fields, {"notes": "x" * (MAX_TEXT_LENGTH + 1)})

    def test_urls_in_free_text_are_rejected(self):
        """Public signup free-text is a standard phishing/spam relay — the same
        reason display-name fields reject links."""
        # Deliberately a field with no tight max_length, so the URL check is
        # what rejects this rather than the length check.
        fields = [SignupFieldItem(key="notes", label="Notes", type="textarea")]
        with pytest.raises(HTTPException) as exc:
            validate_signup_field_values(fields, {"notes": "visit http://spam.example now"})
        assert exc.value.detail["field"] == "notes"

    @pytest.mark.parametrize("value", ["nan", "inf", "-inf", float("nan"), float("inf")])
    def test_non_finite_numbers_are_rejected(self, value):
        """float() happily parses 'nan'/'inf'; neither belongs in stored JSON."""
        with pytest.raises(HTTPException) as exc:
            validate_signup_field_values(_fields(), {"company": "Acme", "age": value})
        assert exc.value.detail["field"] == "age"

    def test_total_payload_size_is_capped(self):
        # Many generous fields, each individually legal, must still not add up
        # to an unbounded blob on the user row.
        fields = [
            SignupFieldItem(key=f"f{i}", type="textarea", max_length=MAX_TEXT_LENGTH)
            for i in range(20)
        ]
        payload = {f"f{i}": "x" * MAX_TEXT_LENGTH for i in range(20)}
        with pytest.raises(HTTPException) as exc:
            validate_signup_field_values(fields, payload)
        assert exc.value.detail["code"] == "SIGNUP_FIELDS_TOO_LARGE"
        assert len(str(payload)) > MAX_TOTAL_SERIALIZED_BYTES


class TestMissingRequiredFields:
    """Drives the post-OAuth "complete your profile" prompt."""

    def test_optional_fields_are_never_outstanding(self):
        fields = [SignupFieldItem(key="notes", type="textarea", required=False)]
        assert missing_required_fields(fields, {}) == []

    def test_unanswered_required_text_is_outstanding(self):
        fields = [SignupFieldItem(key="company", type="text", required=True)]
        assert [f.key for f in missing_required_fields(fields, None)] == ["company"]
        assert [f.key for f in missing_required_fields(fields, {"company": "  "})] == ["company"]

    def test_answered_required_text_is_not_outstanding(self):
        fields = [SignupFieldItem(key="company", type="text", required=True)]
        assert missing_required_fields(fields, {"company": "Acme"}) == []

    def test_unticked_required_checkbox_is_outstanding(self):
        fields = [SignupFieldItem(key="terms", type="checkbox", required=True)]
        assert [f.key for f in missing_required_fields(fields, {"terms": False})] == ["terms"]
        assert missing_required_fields(fields, {"terms": True}) == []

    def test_mixed_set_reports_only_the_outstanding_ones(self):
        fields = [
            SignupFieldItem(key="company", type="text", required=True),
            SignupFieldItem(key="notes", type="textarea", required=False),
            SignupFieldItem(key="terms", type="checkbox", required=True),
        ]
        outstanding = missing_required_fields(fields, {"company": "Acme", "terms": False})
        assert [f.key for f in outstanding] == ["terms"]
