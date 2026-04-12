import logging

import pytest

from src.services.webhooks.events import WEBHOOK_EVENTS, validate_event_data


class TestWebhookEventRegistry:
    """Tests for the WEBHOOK_EVENTS registry structure."""

    def test_all_events_have_required_fields(self):
        for name, definition in WEBHOOK_EVENTS.items():
            assert "category" in definition, f"{name} missing 'category'"
            assert "description" in definition, f"{name} missing 'description'"
            assert "data_schema" in definition, f"{name} missing 'data_schema'"

    def test_all_data_schemas_are_dicts(self):
        for name, definition in WEBHOOK_EVENTS.items():
            assert isinstance(definition["data_schema"], dict), (
                f"{name} data_schema is not a dict"
            )

    def test_event_categories_are_strings(self):
        for name, definition in WEBHOOK_EVENTS.items():
            cat = definition["category"]
            assert isinstance(cat, str) and len(cat) > 0, (
                f"{name} has invalid category: {cat!r}"
            )


class TestValidateEventData:
    """Tests for the validate_event_data runtime checker."""

    def test_validate_event_data_correct_data_no_warnings(self, caplog):
        schema = WEBHOOK_EVENTS["ping"]["data_schema"]
        data = {key: "value" for key in schema}

        with caplog.at_level(logging.WARNING):
            validate_event_data("ping", data)

        assert caplog.text == ""

    def test_validate_event_data_missing_keys_warns(self, caplog):
        with caplog.at_level(logging.WARNING):
            validate_event_data("ping", {})

        assert "missing keys" in caplog.text.lower()

    def test_validate_event_data_extra_keys_warns(self, caplog):
        schema = WEBHOOK_EVENTS["ping"]["data_schema"]
        data = {key: "value" for key in schema}
        data["unexpected_key"] = "surprise"

        with caplog.at_level(logging.WARNING):
            validate_event_data("ping", data)

        assert "not defined" in caplog.text.lower()

    def test_validate_event_data_unknown_event_warns(self, caplog):
        with caplog.at_level(logging.WARNING):
            validate_event_data("totally_fake_event", {"a": 1})

        assert "not registered" in caplog.text.lower()
