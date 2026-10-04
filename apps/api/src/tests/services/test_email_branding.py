"""Per-organization email branding resolution (services/email/branding.py)."""

from types import SimpleNamespace
from unittest.mock import patch

from src.services.email.branding import (
    OrgEmailBranding,
    contrasting_text_color,
    normalize_brand_color,
    resolve_org_brand_color,
    resolve_org_email_branding,
    resolve_org_powered_by,
)


def _config(config: dict | None):
    return SimpleNamespace(config=config)


class TestNormalizeBrandColor:
    def test_accepts_six_digit_hex_and_lowercases(self):
        assert normalize_brand_color("#FF5500") == "#ff5500"
        assert normalize_brand_color("  #ff5500 ") == "#ff5500"

    def test_expands_three_digit_shorthand(self):
        assert normalize_brand_color("#abc") == "#aabbcc"

    def test_accepts_hex_without_hash(self):
        assert normalize_brand_color("ff5500") == "#ff5500"

    def test_rejects_anything_that_is_not_a_hex_triplet(self):
        # The value lands inside an inline style attribute unescaped, so a
        # named color, a CSS function or a style-breaking payload is dropped.
        for raw in ("red", "#12345", "#ff5500; color: red", "url(x)", "", None, 42, "#gggggg"):
            assert normalize_brand_color(raw) is None, raw


class TestContrastingTextColor:
    def test_dark_backgrounds_take_white_text(self):
        assert contrasting_text_color("#000000") == "#ffffff"
        assert contrasting_text_color("#1d4ed8") == "#ffffff"

    def test_light_backgrounds_take_black_text(self):
        assert contrasting_text_color("#ffffff") == "#000000"
        assert contrasting_text_color("#facc15") == "#000000"


class TestResolveOrgBrandColor:
    def test_reads_v2_customization_general_color(self):
        cfg = _config({"customization": {"general": {"color": "#FF5500"}}})
        assert resolve_org_brand_color(cfg) == "#ff5500"

    def test_falls_back_to_v1_general_color(self):
        assert resolve_org_brand_color(_config({"general": {"color": "#abc"}})) == "#aabbcc"

    def test_missing_or_null_sections_yield_none(self):
        assert resolve_org_brand_color(None) is None
        assert resolve_org_brand_color(_config(None)) is None
        assert resolve_org_brand_color(_config({"customization": None})) is None
        assert resolve_org_brand_color(_config({"customization": {"general": {}}})) is None

    def test_invalid_stored_color_yields_none(self):
        cfg = _config({"customization": {"general": {"color": "not-a-color"}}})
        assert resolve_org_brand_color(cfg) is None


class TestResolveOrgPoweredBy:
    def test_defaults_to_shown(self):
        for mode in ("oss", "ee", "saas"):
            with patch("src.core.deployment_mode.get_deployment_mode", return_value=mode):
                assert resolve_org_powered_by(None) is True, mode
                assert resolve_org_powered_by(_config({})) is True, mode
                assert resolve_org_powered_by(_config({"customization": {"general": {}}})) is True, mode

    def test_org_can_turn_it_off_on_a_paid_plan(self):
        cfg = _config({"plan": "pro", "customization": {"general": {"watermark": False}}})
        with patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"):
            assert resolve_org_powered_by(cfg) is False

    def test_v1_watermark_flag_is_honored(self):
        cfg = _config({"cloud": {"plan": "standard"}, "general": {"watermark": False}})
        with patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"):
            assert resolve_org_powered_by(cfg) is False

    def test_saas_free_plan_always_shows_it(self):
        # Same rule as the site watermark: the write path refuses `false` for
        # free orgs, but a downgrade can leave a stale `false` behind.
        for cfg in (
            _config({"plan": "free", "customization": {"general": {"watermark": False}}}),
            _config({"cloud": {"plan": "free"}, "general": {"watermark": False}}),
            _config({"customization": {"general": {"watermark": False}}}),  # no plan = free
        ):
            with patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"):
                assert resolve_org_powered_by(cfg) is True

    def test_open_source_edition_always_shows_it(self):
        # Attribution is part of the OSS deal: no stored flag or plan turns it off.
        for cfg in (
            _config({"plan": "pro", "customization": {"general": {"watermark": False}}}),
            _config({"cloud": {"plan": "enterprise"}, "general": {"watermark": False}}),
            _config({"customization": {"general": {"watermark": False}}}),
        ):
            with patch("src.core.deployment_mode.get_deployment_mode", return_value="oss"):
                assert resolve_org_powered_by(cfg) is True

    def test_enterprise_licence_can_turn_it_off(self):
        cfg = _config({"plan": "free", "customization": {"general": {"watermark": False}}})
        with patch("src.core.deployment_mode.get_deployment_mode", return_value="ee"):
            assert resolve_org_powered_by(cfg) is False


class TestResolveOrgEmailBranding:
    def _org(self, **overrides):
        data = dict(name="Acme & Co", org_uuid="org_uuid", logo_image="logo.png")
        data.update(overrides)
        return SimpleNamespace(**data)

    def test_collects_every_branding_field_from_org_and_config(self):
        cfg = _config({
            "plan": "pro",
            "customization": {
                "general": {
                    "default_language": "fr",
                    "email_sender_name": "Acme Academy",
                    "color": "#FF5500",
                    "watermark": False,
                }
            },
        })
        with patch(
            "src.services.email.utils.get_media_base_url", return_value="https://api.test"
        ), patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"):
            branding = resolve_org_email_branding(self._org(), cfg, request=None)

        assert branding == OrgEmailBranding(
            org_name="Acme & Co",
            lang="fr",
            sender_name="Acme Academy",
            logo_url="https://api.test/content/orgs/org_uuid/logos/logo.png",
            brand_color="#ff5500",
            powered_by=False,
        )

    def test_square_logo_wins_over_the_wide_logo(self):
        cfg = _config({"customization": {"general": {"square_logo_image": "sq.png"}}})
        with patch("src.services.email.utils.get_media_base_url", return_value="https://api.test"):
            branding = resolve_org_email_branding(self._org(logo_image="wide.png"), cfg)
        assert branding.logo_url == "https://api.test/content/orgs/org_uuid/square_logos/sq.png"

    def test_wide_logo_is_used_when_no_square_variant_exists(self):
        for cfg in (
            None,
            _config({}),
            _config({"customization": {"general": {"square_logo_image": ""}}}),
            _config({"general": {"square_logo_image": None}}),
        ):
            with patch("src.services.email.utils.get_media_base_url", return_value="https://api.test"):
                branding = resolve_org_email_branding(self._org(logo_image="wide.png"), cfg)
            assert branding.logo_url == "https://api.test/content/orgs/org_uuid/logos/wide.png", cfg

    def test_v1_square_logo_key_is_read(self):
        cfg = _config({"general": {"square_logo_image": "old.png"}})
        with patch("src.services.email.utils.get_media_base_url", return_value="https://api.test"):
            branding = resolve_org_email_branding(self._org(), cfg)
        assert branding.logo_url.endswith("/square_logos/old.png")

    def test_defaults_without_a_config_row(self):
        with patch("src.services.email.utils.get_media_base_url", return_value=""):
            branding = resolve_org_email_branding(self._org(logo_image=None), None)
        assert branding == OrgEmailBranding(org_name="Acme & Co")

    def test_as_kwargs_matches_the_send_function_parameters(self):
        import inspect

        from src.services.auth.magic_login import send_magic_login_email
        from src.services.users import emails

        kwargs = OrgEmailBranding(org_name="Acme").as_kwargs()
        assert set(kwargs) == {"lang", "sender_name", "logo_url", "brand_color", "powered_by"}
        # An empty configured sender name becomes None so the platform default applies.
        assert kwargs["sender_name"] is None

        for fn in (
            emails.send_password_reset_email,
            emails.send_invitation_email,
            emails.send_email_verification_email,
            emails.send_role_changed_email,
            emails.send_org_join_email,
            emails.send_account_creation_email,
            emails.send_nudge_email,
            send_magic_login_email,
        ):
            params = inspect.signature(fn).parameters
            missing = set(kwargs) - set(params)
            assert not missing, f"{fn.__name__} does not accept {missing}"
