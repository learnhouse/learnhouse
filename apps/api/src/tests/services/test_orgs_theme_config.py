"""
Tests for the organization theme (src/services/orgs/theme.py and the theme
models in src/db/organization_config.py).

Covers the value sanitizers (every theme value lands in CSS or a fonts URL),
the tolerant reader, accent resolution, the one-write update for v1 and v2
configs, the legacy color/font endpoints' validation, the router endpoint and
the email CTA picking up the theme accent.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.organization_config import (
    CustomizationConfig,
    OrganizationConfig,
    OrgThemeUpdate,
    ThemeCustomization,
    normalize_theme_color,
    validate_font_name,
)
from src.routers.orgs.orgs import router as orgs_router
from src.security.auth import get_current_user
from src.services.email.branding import resolve_org_brand_color
from src.services.orgs.orgs import update_org_color_config, update_org_font_config
from src.services.orgs.theme import (
    _safe_color,
    read_org_theme,
    resolve_org_theme_summary,
    resolve_theme_accent,
    update_org_theme_config,
    validated_color_param,
    validated_font_param,
)

_THEME = {
    "preset": "ocean",
    "accent_mode": "custom",
    "accent_color": "#0EA5E9",
    "header_style": "dark",
    "radius": "round",
    "heading_font": "Space  Grotesk",
    "button_style": "soft",
    "card_style": "border",
    "density": "compact",
    "background": "pattern",
}


async def _load_config(db, org_id):
    return (
        await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))
    ).scalars().first()


async def _make_config(db, org, config):
    row = OrganizationConfig(
        org_id=org.id,
        config=config,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@pytest.fixture(autouse=True)
def _bypass_rbac():
    with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock, return_value=True):
        yield


class TestSanitizers:
    @pytest.mark.parametrize(
        "raw,expected",
        [("", ""), ("  ", ""), (None, ""), ("#ABC", "#aabbcc"), ("1d4ed8", "#1d4ed8"), (" #0F766E ", "#0f766e")],
    )
    def test_color_normalized(self, raw, expected):
        assert normalize_theme_color(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        ["red", "#12345", "#1234567", "#12345g", "#fff; background:url(x)", "rgb(0,0,0)", "var(--x)"],
    )
    def test_color_rejected(self, raw):
        with pytest.raises(ValueError, match="accent_color must be a hex color"):
            normalize_theme_color(raw, "accent_color")

    @pytest.mark.parametrize(
        "raw,expected",
        [("", ""), (None, ""), ("Inter", "Inter"), ("  Source   Sans 3 ", "Source Sans 3"), ("Exo 2", "Exo 2")],
    )
    def test_font_normalized(self, raw, expected):
        assert validate_font_name(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        ["Inter'; color:red", "Inter&family=Evil", "Font-Name", "x" * 65, "Inter;", "<b>"],
    )
    def test_font_rejected(self, raw):
        with pytest.raises(ValueError, match="font must be a font family name"):
            validate_font_name(raw)

    def test_theme_defaults_are_the_pre_theme_look(self):
        theme = ThemeCustomization()
        assert theme.model_dump() == {
            "preset": "",
            "accent_mode": "neutral",
            "accent_color": "",
            "header_style": "brand",
            "radius": "soft",
            "heading_font": "",
            "button_style": "solid",
            "card_style": "shadow",
            "density": "comfortable",
            "background": "tint",
            "secondary_color": "",
            "neutral": "neutral",
            "type_scale": "default",
            "heading_weight": "",
            "button_shape": "auto",
            "elevation": "default",
            "link_style": "accent",
            "header_layout": "standard",
            "footer_style": "simple",
            "image_style": "default",
            "public_scheme": "visitor",
            "dark_accent": "",
        }
        assert CustomizationConfig().theme == theme

    def test_theme_normalizes_values(self):
        theme = ThemeCustomization(**_THEME)
        assert theme.accent_color == "#0ea5e9"
        assert theme.heading_font == "Space Grotesk"

    @pytest.mark.parametrize(
        "patch_",
        [
            {"accent_color": "blue"},
            {"heading_font": "a;b"},
            {"radius": "pill"},
            {"header_style": "url(javascript:x)"},
            {"preset": "unknown"},
        ],
    )
    def test_theme_rejects_bad_values(self, patch_):
        with pytest.raises(ValidationError):
            ThemeCustomization(**{**_THEME, **patch_})

    def test_update_model_validates_color_and_font(self):
        update = OrgThemeUpdate(color="#FFF", font=" Inter ")
        assert (update.color, update.font) == ("#ffffff", "Inter")
        with pytest.raises(ValidationError):
            OrgThemeUpdate(color="javascript:alert(1)")
        with pytest.raises(ValidationError):
            OrgThemeUpdate(font="Inter'}")

    def test_legacy_param_helpers(self):
        assert validated_color_param("#ABCDEF") == "#abcdef"
        assert validated_font_param("Manrope") == "Manrope"
        with pytest.raises(HTTPException) as exc:
            validated_color_param("red;")
        assert exc.value.status_code == 400
        with pytest.raises(HTTPException) as exc:
            validated_font_param("Bad'Font")
        assert exc.value.status_code == 400


class TestReaders:
    def test_reads_v2_theme(self):
        config = {"customization": {"theme": _THEME}}
        assert read_org_theme(config).radius == "round"

    def test_reads_v1_theme(self):
        config = {"general": {"theme": {"radius": "sharp"}}}
        assert read_org_theme(config).radius == "sharp"

    @pytest.mark.parametrize(
        "config",
        [None, {}, {"customization": None}, {"customization": {"theme": {"radius": "pill"}}}],
    )
    def test_missing_or_invalid_reads_default(self, config):
        assert read_org_theme(config) == ThemeCustomization()

    def test_safe_color(self):
        assert _safe_color("#ABC") == "#aabbcc"
        assert _safe_color("nope") == ""
        assert _safe_color(None) == ""

    def test_accent_custom(self):
        config = {"customization": {"theme": {"accent_mode": "custom", "accent_color": "#0ea5e9"}}}
        assert resolve_theme_accent(config) == "#0ea5e9"

    def test_accent_custom_without_color_is_neutral(self):
        config = {"customization": {"theme": {"accent_mode": "custom"}}}
        assert resolve_theme_accent(config) is None

    def test_accent_brand_follows_general_color(self):
        config = {"customization": {"general": {"color": "#BE123C"}, "theme": {"accent_mode": "brand"}}}
        assert resolve_theme_accent(config) == "#be123c"

    def test_accent_brand_with_bad_color_is_neutral(self):
        config = {"customization": {"general": {"color": "red"}, "theme": {"accent_mode": "brand"}}}
        assert resolve_theme_accent(config) is None

    def test_accent_neutral(self):
        assert resolve_theme_accent({"customization": {"general": {"color": "#111111"}}}) is None

    def test_summary(self):
        config = {"customization": {"general": {"color": "#1d4ed8"}, "theme": {"accent_mode": "brand"}}}
        summary = resolve_org_theme_summary(config)
        assert summary["brand_color"] == "#1d4ed8"
        assert summary["accent_color"] == "#1d4ed8"
        assert summary["theme"]["accent_mode"] == "brand"
        assert resolve_org_theme_summary({})["brand_color"] is None


class TestUpdateOrgThemeConfig:
    @pytest.mark.asyncio
    async def test_v2_writes_color_font_and_theme(self, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "2.0", "customization": {"general": {"footer_text": "keep"}}})
        result = await update_org_theme_config(
            mock_request, {"color": "#1D4ED8", "font": "Inter", "theme": _THEME}, org.id, admin_user, db
        )
        assert result["detail"] == "Theme configuration updated"
        assert result["color"] == "#1d4ed8"

        row = await _load_config(db, org.id)
        general = row.config["customization"]["general"]
        assert (general["color"], general["font"], general["footer_text"]) == ("#1d4ed8", "Inter", "keep")
        stored = row.config["customization"]["theme"]
        assert stored["accent_color"] == "#0ea5e9"
        assert stored["heading_font"] == "Space Grotesk"
        assert stored["background"] == "pattern"

    @pytest.mark.asyncio
    async def test_v1_writes_under_general(self, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "1.4"})
        await update_org_theme_config(mock_request, {"color": "#0f766e", "theme": {"radius": "sharp"}}, org.id, admin_user, db)

        row = await _load_config(db, org.id)
        assert row.config["general"]["color"] == "#0f766e"
        assert row.config["general"]["font"] == ""
        assert row.config["general"]["theme"]["radius"] == "sharp"

    @pytest.mark.asyncio
    async def test_empty_payload_resets_to_defaults(self, db, org, admin_user, mock_request):
        await _make_config(
            db,
            org,
            {"config_version": "2.0", "customization": {"general": {"color": "#111111", "font": "Inter"}, "theme": _THEME}},
        )
        await update_org_theme_config(mock_request, None, org.id, admin_user, db)

        row = await _load_config(db, org.id)
        assert row.config["customization"]["general"]["color"] == ""
        assert row.config["customization"]["general"]["font"] == ""
        assert row.config["customization"]["theme"] == ThemeCustomization().model_dump()

    @pytest.mark.asyncio
    async def test_invalid_payload_400_and_nothing_stored(self, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "2.0", "customization": {}})
        with pytest.raises(HTTPException) as exc:
            await update_org_theme_config(
                mock_request, {"theme": {"accent_color": "red;}"}}, org.id, admin_user, db
            )
        assert exc.value.status_code == 400

        row = await _load_config(db, org.id)
        assert "theme" not in row.config["customization"]

    @pytest.mark.asyncio
    async def test_missing_org_404(self, db, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await update_org_theme_config(mock_request, {}, 999999, admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_missing_config_404(self, db, org, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await update_org_theme_config(mock_request, {}, org.id, admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_rbac_is_checked(self, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "2.0", "customization": {}})
        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=403, detail="nope"),
        ):
            with pytest.raises(HTTPException) as exc:
                await update_org_theme_config(mock_request, {}, org.id, admin_user, db)
        assert exc.value.status_code == 403


class TestLegacyEndpointsValidate:
    @pytest.mark.asyncio
    async def test_color_rejects_non_hex(self, db, org, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await update_org_color_config(mock_request, "red; x", org.id, admin_user, db)
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_font_rejects_bad_name(self, db, org, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await update_org_font_config(mock_request, "Inter'}", org.id, admin_user, db)
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_color_normalized_on_save(self, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "2.0", "customization": {}})
        await update_org_color_config(mock_request, "#ABC", org.id, admin_user, db)
        row = await _load_config(db, org.id)
        assert row.config["customization"]["general"]["color"] == "#aabbcc"


class TestEmailPicksUpTheme:
    def test_custom_accent_wins(self):
        cfg = SimpleNamespace(
            config={
                "customization": {
                    "general": {"color": "#111111"},
                    "theme": {"accent_mode": "custom", "accent_color": "#0ea5e9"},
                }
            }
        )
        assert resolve_org_brand_color(cfg) == "#0ea5e9"

    def test_neutral_keeps_brand_color(self):
        cfg = SimpleNamespace(config={"customization": {"general": {"color": "#BE123C"}}})
        assert resolve_org_brand_color(cfg) == "#be123c"


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(orgs_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


class TestThemeEndpoint:
    @pytest.mark.asyncio
    async def test_put_updates_theme(self, client, db, org):
        await _make_config(db, org, {"config_version": "2.0", "customization": {}})
        response = await client.put(
            f"/api/v1/orgs/{org.id}/config/theme",
            json={"color": "#1d4ed8", "font": "", "theme": _THEME},
        )
        assert response.status_code == 200
        assert response.json()["theme"]["radius"] == "round"

    @pytest.mark.asyncio
    async def test_put_rejects_bad_value(self, client, db, org):
        await _make_config(db, org, {"config_version": "2.0", "customization": {}})
        response = await client.put(
            f"/api/v1/orgs/{org.id}/config/theme",
            json={"theme": {"card_style": "<script>"}},
        )
        assert response.status_code == 400
