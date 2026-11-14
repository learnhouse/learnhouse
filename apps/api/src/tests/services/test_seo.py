"""Slugs, slug history, per-resource SEO settings, sitemap data and the SEO
report (src/services/seo, src/db/seo.py, src/routers/seo.py)."""

from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, UploadFile
from pydantic import ValidationError
from sqlmodel import select

from src.db.communities.communities import Community
from src.db.communities.discussions import Discussion
from src.db.courses.activities import Activity, ActivityLockType, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.courses import Course
from src.db.folders.folders import Folder
from src.db.organization_config import OrganizationConfig
from src.db.paths import Path
from src.db.podcasts.podcasts import Podcast
from src.db.seo import ResourceSEO, ResourceSlugRedirect, SeoSettingsUpdate, clean_seo
from src.db.users import AnonymousUser, APITokenUser
from src.routers import seo as seo_router
from src.services.seo import seo as seo_service
from src.services.seo import slugs
from src.services.seo.ai import SeoSuggestion, build_prompt, suggest_snippet
from src.services.seo.slugify import (
    SLUG_MAX_LENGTH,
    base_slug,
    first_free,
    numbered,
    slug_error,
    slugify,
    transliterate,
)

NOW = str(datetime.now())


def _course(org_id=1, name="Intro to Python", uuid="course_c1", **kw):
    data = dict(
        name=name, public=True, published=True, open_to_contributors=False,
        org_id=org_id, course_uuid=uuid, creation_date=NOW, update_date=NOW,
    )
    data.update(kw)
    return Course(**data)


async def _add(db, *rows):
    for row in rows:
        db.add(row)
    await db.commit()
    for row in rows:
        await db.refresh(row)
    return rows[0] if len(rows) == 1 else rows


# ─── slugify ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Intro to Python", "intro-to-python"),
        ("Café crème brûlée", "cafe-creme-brulee"),
        ("Straße & Æsir Øl", "strasse-aesir-ol"),
        ("Основы программирования", "osnovy-programmirovaniya"),
        ("Привіт Їжак", "privit-yizhak"),
        ("Μάθημα Ελληνικών", "mathima-ellinikon"),
        ("مقدمة في البرمجة", "mqdmh-fy-albrmjh"),
        ("שלום עולם", "shlvm-vlm"),
        ("Python 入门", "python"),
        ("入门课程", ""),
        ("Don't panic", "dont-panic"),
        ("ﬁle Ｆull", "file-full"),
        ("  --Hello--  ", "hello"),
        ("", ""),
        (None, ""),
    ],
)
def test_slugify(text, expected):
    assert slugify(text) == expected


def test_slugify_truncates_on_a_word_boundary():
    slug = slugify("word " * 40)
    assert len(slug) <= SLUG_MAX_LENGTH and not slug.endswith("-")
    assert slugify("a" * 120) == "a" * SLUG_MAX_LENGTH


def test_transliterate_keeps_ascii_and_drops_combining_marks():
    assert transliterate("Ñandú") == "nandu"
    assert transliterate("x y") == "x y"


@pytest.mark.parametrize(
    "slug,reason",
    [
        ("", "empty"),
        ("a" * (SLUG_MAX_LENGTH + 1), "too_long"),
        ("Bad Slug", "invalid_characters"),
        ("double--dash", "invalid_characters"),
        ("65cddc73-8de4-437a-aa2a-08ae68b1492b", "looks_like_id"),
        ("new", "reserved"),
        ("fine-slug-2", None),
    ],
)
def test_slug_error(slug, reason):
    assert slug_error(slug) == reason


def test_base_slug_fallbacks():
    assert base_slug("Hello", "course_abc") == "hello"
    assert base_slug("入门", "course_1234abcd-ef") == "1234abcd"
    assert base_slug("New", "course_ab12cd34ef") == "new-ab12cd34"
    assert base_slug("", "") == "item"


def test_numbered_and_first_free():
    assert numbered("x", 1) == "x"
    assert numbered("x", 3) == "x-3"
    long = "a" * SLUG_MAX_LENGTH
    assert numbered(long, 12).endswith("-12") and len(numbered(long, 12)) == SLUG_MAX_LENGTH
    assert first_free("x", set()) == "x"
    assert first_free("x", {"x", "x-2"}) == "x-3"


# ─── schema ─────────────────────────────────────────────────────────────────


def test_resource_seo_validation():
    seo = ResourceSEO.model_validate({
        "title": "  Hi  ", "description": " ", "canonical_url": " https://a.example/x ",
        "og_image": "og_1.png", "faq": [{"question": " Q? ", "answer": " A "}], "unknown": 1,
    })
    assert seo.title == "Hi" and seo.description is None
    assert seo.canonical_url == "https://a.example/x"
    assert seo.og_image == "og_1.png"
    assert seo.faq[0].question == "Q?" and seo.faq[0].answer == "A"
    assert ResourceSEO(og_image="https://cdn.example/i.png").og_image == "https://cdn.example/i.png"
    assert ResourceSEO(og_image="  ").og_image is None
    assert ResourceSEO(canonical_url="").canonical_url is None
    with pytest.raises(ValidationError):
        ResourceSEO(canonical_url="javascript:alert(1)")
    with pytest.raises(ValidationError):
        ResourceSEO(og_image="../etc/passwd")
    with pytest.raises(ValidationError):
        ResourceSEO(in_language="not a language")


def test_clean_seo_drops_defaults_and_unknown_keys():
    assert clean_seo(None) == {}
    assert clean_seo({"robots_noindex": False, "title": "T", "x": 1}) == {"title": "T"}


def test_course_update_validates_seo():
    from src.services.courses.courses import _validate_course_seo

    assert _validate_course_seo({"title": "T", "robots_noindex": True}) == {"title": "T", "robots_noindex": True}
    with pytest.raises(HTTPException) as exc:
        _validate_course_seo({"canonical_url": "nope"})
    assert exc.value.status_code == 400


# ─── slug storage ───────────────────────────────────────────────────────────


async def test_new_rows_get_unique_slugs(db, org, other_org):
    first = await _add(db, _course())
    second = await _add(db, _course(uuid="course_c2"))
    elsewhere = await _add(db, _course(org_id=other_org.id, uuid="course_c3"))
    keep = await _add(db, _course(uuid="course_c4", slug="custom"))
    assert (first.slug, second.slug, elsewhere.slug, keep.slug) == (
        "intro-to-python", "intro-to-python-2", "intro-to-python", "custom",
    )
    no_org = Course(name="x", public=True, open_to_contributors=False, org_id=0, course_uuid="course_x")
    slugs._assign_slug_listener("course")(None, None, no_org)
    assert no_org.slug is None


async def test_old_slugs_stay_reserved(db, org):
    course = await _add(db, _course())
    await slugs.set_slug(db, "course", course, "python-basics")
    await db.commit()
    other = await _add(db, _course(uuid="course_c2"))
    assert other.slug == "intro-to-python-2"
    assert await slugs.taken_slugs(db, "course", org.id, "intro-to-python") == {"intro-to-python", "intro-to-python-2"}


async def test_set_slug_records_history_and_validates(db, org):
    course = await _add(db, _course())
    await _add(db, _course(uuid="course_c2", slug="taken"))
    with pytest.raises(HTTPException) as exc:
        await slugs.set_slug(db, "course", course, "taken")
    assert exc.value.status_code == 409 and exc.value.detail["suggestion"] == "taken-2"
    with pytest.raises(HTTPException) as exc:
        await slugs.set_slug(db, "course", course, "new")
    assert exc.value.status_code == 400 and exc.value.detail["reason"] == "reserved"

    assert await slugs.set_slug(db, "course", course, "Intro to Python") == "intro-to-python"
    assert await slugs.set_slug(db, "course", course, "Python Basics") == "python-basics"
    await db.commit()
    history = (await db.execute(select(ResourceSlugRedirect))).scalars().all()
    assert [h.slug for h in history] == ["intro-to-python"]

    # Taking an old slug back removes it from the history.
    await slugs.set_slug(db, "course", course, "intro-to-python")
    await db.commit()
    history = (await db.execute(select(ResourceSlugRedirect.slug))).scalars().all()
    assert history == ["python-basics"]


async def test_set_slug_without_previous_slug(db, org):
    course = await _add(db, _course(slug=None))
    course.slug = None
    assert await slugs.set_slug(db, "course", course, "fresh") == "fresh"
    await db.commit()
    assert (await db.execute(select(ResourceSlugRedirect))).scalars().all() == []


async def test_check_and_suggest(db, org):
    await _add(db, _course())
    assert await slugs.check_slug(db, "course", org.id, "Intro to Python") == {
        "slug": "intro-to-python", "available": False, "reason": "taken", "suggestion": "intro-to-python-2",
    }
    assert (await slugs.check_slug(db, "course", org.id, "intro-to-python", "course_c1"))["available"] is True
    assert (await slugs.check_slug(db, "course", org.id, "!!!"))["reason"] == "empty"
    assert await slugs.suggest_slug(db, "course", org.id, "Intro to Python") == "intro-to-python-2"


async def test_find_resource(db, org, other_org):
    course = await _add(db, _course(uuid="course_65cddc73-8de4-437a-aa2a-08ae68b1492b"))
    assert await slugs.find_resource(db, "course", org.id, "65cddc73-8de4-437a-aa2a-08ae68b1492b") == (course, "uuid")
    assert await slugs.find_resource(db, "course", org.id, "course_65cddc73-8de4-437a-aa2a-08ae68b1492b") == (course, "uuid")
    assert await slugs.find_resource(db, "course", other_org.id, "65cddc73-8de4-437a-aa2a-08ae68b1492b") == (None, None)
    assert await slugs.find_resource(db, "course", org.id, "Intro-To-Python") == (course, "slug")
    assert await slugs.find_resource(db, "course", org.id, "") == (None, None)
    assert await slugs.find_resource(db, "course", org.id, "missing") == (None, None)

    await slugs.set_slug(db, "course", course, "renamed")
    await db.commit()
    assert await slugs.find_resource(db, "course", org.id, "intro-to-python") == (course, "redirect")

    # A redirect row whose resource is gone resolves to nothing.
    db.add(ResourceSlugRedirect(org_id=org.id, resource_type="course", resource_uuid="course_gone", slug="ghost"))
    await db.commit()
    assert await slugs.find_resource(db, "course", org.id, "ghost") == (None, None)


async def test_deleting_a_resource_purges_its_history(db, org):
    course = await _add(db, _course())
    await slugs.set_slug(db, "course", course, "renamed")
    await db.commit()
    await db.delete(course)
    await db.commit()
    assert (await db.execute(select(ResourceSlugRedirect))).scalars().all() == []
    # A row without a uuid has nothing to purge.
    slugs._purge_history_listener("course")(None, None, SimpleNamespace(course_uuid=None))


def test_registry_helpers():
    assert slugs.full_uuid("course", "abc") == "course_abc"
    assert slugs.full_uuid("course", "course_abc") == "course_abc"
    with pytest.raises(HTTPException) as exc:
        slugs.resource_spec("nope")
    assert exc.value.status_code == 404
    slugs.register_slug_listeners()  # idempotent


# ─── resolve + editing ──────────────────────────────────────────────────────


async def test_resolve_public_and_private(db, org, mock_request, anonymous_user):
    await _add(db, _course(uuid="course_65cddc73-8de4-437a-aa2a-08ae68b1492b"))
    res = await seo_service.resolve_public_key(
        mock_request, db, anonymous_user, org.slug, "course", "65cddc73-8de4-437a-aa2a-08ae68b1492b"
    )
    assert res["redirect"] is True and res["canonical_key"] == "intro-to-python" and res["match"] == "uuid"
    res = await seo_service.resolve_public_key(mock_request, db, anonymous_user, org.slug, "course", "intro-to-python")
    assert res["redirect"] is False

    await _add(db, _course(name="Private", uuid="course_p", public=False))
    await _add(db, _course(name="Draft", uuid="course_d", published=False))
    with patch.object(seo_service, "_can_read", new=AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc:
            await seo_service.resolve_public_key(mock_request, db, anonymous_user, org.slug, "course", "draft")
        assert exc.value.status_code == 404
        res = await seo_service.resolve_public_key(mock_request, db, anonymous_user, org.slug, "course", "private")
        assert res["restricted"] is True and res["uuid"] == "course_p"
    with patch.object(seo_service, "_can_read", new=AsyncMock(return_value=True)):
        res = await seo_service.resolve_public_key(mock_request, db, anonymous_user, org.slug, "course", "draft")
    assert res["uuid"] == "course_d" and res["restricted"] is False
    with pytest.raises(HTTPException) as exc:
        await seo_service.resolve_public_key(mock_request, db, anonymous_user, org.slug, "course", "nothing")
    assert exc.value.status_code == 404

    with pytest.raises(HTTPException) as exc:
        await seo_service.resolve_public_key(mock_request, db, anonymous_user, "no-org", "course", "x")
    assert exc.value.status_code == 404


async def test_can_read_branches(db, org, mock_request, anonymous_user):
    path = await _add(db, Path(name="P", org_id=org.id, path_uuid="path_1", public=False, published=True))
    with patch("src.services.paths.paths._require_view", new=AsyncMock(side_effect=HTTPException(404))):
        assert await seo_service._can_read(mock_request, db, anonymous_user, "path", path) is False
    with patch("src.services.paths.paths._require_view", new=AsyncMock(return_value=False)):
        assert await seo_service._can_read(mock_request, db, anonymous_user, "path", path) is True
    course = await _add(db, _course())
    with patch.object(seo_service, "check_resource_access", new=AsyncMock(return_value=SimpleNamespace(allowed=True))) as check:
        assert await seo_service._can_read(mock_request, db, anonymous_user, "course", course) is True
    assert check.await_args.kwargs["raise_on_deny"] is False


def test_openly_public():
    assert seo_service._is_openly_public("course", SimpleNamespace(public=True, published=False)) is False
    assert seo_service._is_openly_public("community", SimpleNamespace(public=True)) is True


async def test_settings_roundtrip(db, org, mock_request, admin_user):
    course = await _add(db, _course())
    with patch.object(seo_service, "check_resource_access", new=AsyncMock()), \
         patch("src.services.courses.cache.invalidate_course_meta_cache") as invalidate:
        got = await seo_service.get_seo_settings(mock_request, db, admin_user, "course", "c1")
        assert got["slug"] == "intro-to-python" and got["seo"] == {}
        body = SeoSettingsUpdate(slug="python-101", seo=ResourceSEO(title="Learn Python", robots_noindex=True))
        saved = await seo_service.update_seo_settings(mock_request, db, admin_user, "course", "course_c1", body)
        assert saved["slug"] == "python-101"
        assert saved["seo"] == {"title": "Learn Python", "robots_noindex": True}
        # Neither field: nothing but the date changes.
        await seo_service.update_seo_settings(mock_request, db, admin_user, "course", "c1", SeoSettingsUpdate())
    invalidate.assert_called_with(course.course_uuid)
    with pytest.raises(HTTPException) as exc:
        await seo_service.get_seo_settings(mock_request, db, admin_user, "course", "missing")
    assert exc.value.status_code == 404


async def test_settings_for_a_path_use_path_rights(db, org, mock_request, admin_user):
    await _add(db, Path(name="Data path", org_id=org.id, path_uuid="path_1"))
    with patch("src.services.paths.paths._require_manage", new=AsyncMock()) as manage:
        saved = await seo_service.update_seo_settings(
            mock_request, db, admin_user, "path", "1", SeoSettingsUpdate(seo=ResourceSEO(description="D"))
        )
    manage.assert_awaited_once()
    assert saved["slug"] == "data-path" and saved["seo"] == {"description": "D"}


async def test_upload_seo_image(db, org, mock_request, admin_user):
    await _add(db, _course())
    upload = UploadFile(file=BytesIO(b"x"), filename="a.png")
    with patch.object(seo_service, "check_resource_access", new=AsyncMock()), \
         patch("src.services.orgs.uploads.upload_org_og_image", new=AsyncMock(return_value="og_a.png")) as up:
        assert await seo_service.upload_seo_image(mock_request, db, admin_user, "course", "c1", upload) == {"filename": "og_a.png"}
    assert up.await_args.args[1] == org.org_uuid


def _token(org_id, rights=None):
    return APITokenUser(
        id=1, user_uuid="t", username="t", org_id=org_id, rights=rights or {}, token_name="t", created_by_user_id=1,
    )


async def test_require_author(db, org, mock_request, admin_user, anonymous_user):
    await _add(db, _course())
    with patch.object(seo_service, "check_resource_access", new=AsyncMock()) as check:
        await seo_service.require_author(mock_request, db, admin_user, org.id, "course", "c1")
    check.assert_awaited_once()
    with pytest.raises(HTTPException) as exc:
        await seo_service.require_author(mock_request, db, admin_user, 999, "course", "c1")
    assert exc.value.status_code == 404

    # Naming a new resource: create rights in the org.
    await seo_service.require_author(mock_request, db, _token(org.id, {"courses": {"action_create": True}}), org.id, "course")
    await seo_service.require_author(mock_request, db, _token(org.id, {"podcasts": {"action_create": True}}), org.id, "podcast")
    # A token without the podcasts bucket falls back to its courses right.
    await seo_service.require_author(mock_request, db, _token(org.id, {"courses": {"action_create": True}}), org.id, "podcast")
    for user, org_id, code in (
        (_token(org.id, {"courses": {"action_read": True}}), org.id, 403),
        (_token(org.id, {"podcasts": {"action_read": True}, "courses": {"action_create": True}}), org.id, 403),
        (_token(999, {"courses": {"action_create": True}}), org.id, 403),
        (anonymous_user, org.id, 401),
    ):
        with pytest.raises(HTTPException) as exc:
            await seo_service.require_author(mock_request, db, user, org_id, "podcast")
        assert exc.value.status_code == code
    with patch.object(seo_service, "require_org_role_permission", new=AsyncMock()) as role:
        await seo_service.require_author(mock_request, db, admin_user, org.id, "folder")
    role.assert_awaited_once_with(admin_user.id, org.id, db, "folders", "action_create")


# ─── sitemap + health ───────────────────────────────────────────────────────


async def _org_seo(db, org, **seo):
    await _add(db, OrganizationConfig(org_id=org.id, config={"customization": {"seo": seo}}, creation_date=NOW, update_date=NOW))


async def test_sitemap_lists_only_indexable_public_content(db, org):
    await _org_seo(db, org)
    listed = await _add(db, _course(thumbnail_image="t.png"))
    await _add(db, _course(name="Hidden", uuid="course_h", seo={"robots_noindex": True}))
    await _add(db, _course(name="Elsewhere", uuid="course_e", seo={"canonical_url": "https://x.example"}))
    await _add(db, _course(name="Draft", uuid="course_d", published=False))
    await _add(
        db,
        Activity(name="A", activity_type=ActivityTypeEnum.TYPE_DYNAMIC, activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                 published=True, org_id=org.id, course_id=listed.id, activity_uuid="activity_a1", update_date=NOW),
        Activity(name="B", activity_type=ActivityTypeEnum.TYPE_DYNAMIC, activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                 published=True, lock_type=ActivityLockType.AUTHENTICATED, org_id=org.id, course_id=listed.id, activity_uuid="activity_b1"),
    )
    await _add(db, Path(name="Path", org_id=org.id, path_uuid="path_1", public=True, published=True))
    await _add(db, Podcast(name="Pod", org_id=org.id, podcast_uuid="podcast_1", public=True, published=True))
    community = await _add(db, Community(name="Club", org_id=org.id, community_uuid="community_1", public=True))
    await _add(db, Discussion(title="Hello", community_id=community.id, org_id=org.id, author_id=1, discussion_uuid="discussion_d1"))
    await _add(db, Folder(name="Shelf", org_id=org.id, folder_uuid="folder_1", public=True))

    data = await seo_service.sitemap_data(db, org.slug)
    assert [c["key"] for c in data["courses"]] == ["intro-to-python"]
    assert data["courses"][0]["image"] == "t.png"
    assert data["activities"] == [{"course_key": "intro-to-python", "key": "a1", "lastmod": NOW,
                                  "default_locale": None, "available_locales": []}]
    assert [p["key"] for p in data["paths"]] == ["path"]
    assert [p["key"] for p in data["podcasts"]] == ["pod"]
    assert [c["key"] for c in data["communities"]] == ["club"]
    assert data["discussions"][0]["community_key"] == "club" and data["discussions"][0]["key"] == "d1"
    assert [f["key"] for f in data["folders"]] == ["shelf"]


async def test_sitemap_respects_org_switches(db, org):
    await _org_seo(db, org, noindex_communities=True)
    await _add(db, Community(name="Club", org_id=org.id, community_uuid="community_1", public=True))
    data = await seo_service.sitemap_data(db, org.slug)
    assert data["communities"] == [] and data["activities"] == []

    config = (await db.execute(select(OrganizationConfig))).scalars().first()
    config.config = {"seo": {"indexing_disabled": True}}
    await _add(db, config)
    await _add(db, _course())
    data = await seo_service.sitemap_data(db, org.slug)
    assert data["org"]["indexing_disabled"] is True and data["courses"] == []


async def test_org_seo_config_shapes(db, org):
    assert await seo_service.org_seo_config(db, org.id) == {}
    await _add(db, OrganizationConfig(org_id=org.id, config={"seo": "bad"}, creation_date=NOW, update_date=NOW))
    assert await seo_service.org_seo_config(db, org.id) == {}


async def test_seo_health_requires_org_update_for_every_caller(db, org, mock_request, admin_user, regular_user):
    await _add(db, _course(), Path(name="P", org_id=org.id, path_uuid="path_1"))
    report = await seo_service.seo_health(mock_request, db, admin_user, org.id)
    assert {i["resource_type"] for i in report["items"]} == {"course", "path"}
    assert report["items"][0]["key"] == "intro-to-python"

    # Non-admin member, scoped token without org rights: 403. Never fail open.
    for user in (regular_user, _token(org.id, {"courses": {"action_read": True}})):
        with pytest.raises(HTTPException) as exc:
            await seo_service.seo_health(mock_request, db, user, org.id)
        assert exc.value.status_code == 403
    # A token holding the organizations update right may read it.
    token = _token(org.id, {"organizations": {"action_update": True}})
    assert len((await seo_service.seo_health(mock_request, db, token, org.id))["items"]) == 2

    with pytest.raises(HTTPException) as exc:
        await seo_service.seo_health(mock_request, db, admin_user, 999)
    assert exc.value.status_code == 404


# ─── router ─────────────────────────────────────────────────────────────────


async def test_router_endpoints(db, org, mock_request, admin_user, anonymous_user):
    await _add(db, _course())
    assert (await seo_router.api_resolve(mock_request, org.slug, "course", "intro-to-python", db, anonymous_user))["match"] == "slug"
    assert (await seo_router.api_sitemap_data(org.slug, db))["courses"][0]["key"] == "intro-to-python"
    with patch.object(seo_service, "require_author", new=AsyncMock()):
        assert (await seo_router.api_check_slug(mock_request, org.id, "intro-to-python", "course", None, db, admin_user))["available"] is False
        assert await seo_router.api_suggest_slug(mock_request, org.id, "Intro to Python", "course", None, db, admin_user) == {"slug": "intro-to-python-2"}
    with patch.object(seo_service, "seo_health", new=AsyncMock(return_value={"items": []})):
        assert await seo_router.api_seo_health(mock_request, org.id, db, admin_user) == {"items": []}
    with patch.object(seo_service, "check_resource_access", new=AsyncMock()):
        assert (await seo_router.api_get_seo_settings(mock_request, "course", "c1", db, admin_user))["slug"] == "intro-to-python"
        saved = await seo_router.api_update_seo_settings(mock_request, "course", "c1", SeoSettingsUpdate(slug="py"), db, admin_user)
        assert saved["slug"] == "py"
    with patch.object(seo_service, "upload_seo_image", new=AsyncMock(return_value={"filename": "f"})):
        assert await seo_router.api_upload_seo_image(mock_request, "course", "c1", None, db, admin_user) == {"filename": "f"}


async def test_ai_suggest(db, org, mock_request, admin_user):
    from src.services.ai.llm import AINotConfiguredError

    await _add(db, _course(description="Learn it"))
    body = seo_router.SeoSuggestRequest(org_id=org.id, resource_type="course", resource_uuid="c1")
    suggestion = SeoSuggestion(title="Python for beginners", description="D")
    with patch.object(seo_service, "check_resource_access", new=AsyncMock()), \
         patch.object(seo_router, "enforce_ai_rate_limit"), \
         patch("src.security.features_utils.usage.reserve_ai_credit", new=AsyncMock()), \
         patch("src.security.features_utils.usage.refund_ai_credit") as refund, \
         patch("src.services.ai.llm.resolve_model_for_org", new=AsyncMock(return_value="m")):
        with patch("src.services.seo.ai.suggest_snippet", new=AsyncMock(return_value=suggestion)) as suggest:
            assert await seo_router.api_ai_suggest(body, mock_request, db, admin_user) == suggestion.model_dump()
        assert suggest.await_args.kwargs["org_name"] == org.name
        with patch("src.services.seo.ai.suggest_snippet", new=AsyncMock(side_effect=AINotConfiguredError("off"))):
            with pytest.raises(HTTPException) as exc:
                await seo_router.api_ai_suggest(body, mock_request, db, admin_user)
        assert exc.value.status_code == 403
        with patch("src.services.seo.ai.suggest_snippet", new=AsyncMock(side_effect=RuntimeError)):
            with pytest.raises(HTTPException) as exc:
                await seo_router.api_ai_suggest(body, mock_request, db, admin_user)
        assert exc.value.status_code == 502
        assert refund.call_count == 2
        with pytest.raises(HTTPException) as exc:
            await seo_router.api_ai_suggest(
                seo_router.SeoSuggestRequest(org_id=999, resource_type="course", resource_uuid="c1"), mock_request, db, admin_user
            )
        assert exc.value.status_code == 404
    # AI spends credits: API tokens are refused outright.
    with pytest.raises(HTTPException) as exc:
        await seo_router.api_ai_suggest(body, mock_request, db, _token(org.id, {"courses": {"action_update": True}}))
    assert exc.value.status_code == 403


async def test_ai_snippet_helpers():
    prompt = build_prompt("course", " Py ", "Desc", "more", "Org")
    assert "Name: Py" in prompt and "Description: Desc" in prompt and "More context: more" in prompt
    assert "Description" not in build_prompt("course", "Py", "", "", "Org")
    with patch("src.services.seo.ai.generate", new=AsyncMock(return_value=SeoSuggestion(title=" T ", description=" D "))):
        result = await suggest_snippet(resource_type="course", name="n", description="", extra="", org_name="o", model_name=None)
    assert result == SeoSuggestion(title="T", description="D")


def test_anonymous_user_fixture_type(anonymous_user):
    assert isinstance(anonymous_user, AnonymousUser)


async def test_update_course_validates_seo(db, org, course, mock_request, admin_user):
    from src.db.courses.courses import CourseUpdate
    from src.services.courses.courses import update_course

    with patch("src.services.courses.courses.check_resource_access", new_callable=AsyncMock):
        updated = await update_course(
            mock_request, CourseUpdate(seo={"title": " T ", "bogus": 1}), course.course_uuid, admin_user, db
        )
        assert updated.seo == {"title": "T"}
        with pytest.raises(HTTPException) as exc:
            await update_course(mock_request, CourseUpdate(seo={"canonical_url": "x"}), course.course_uuid, admin_user, db)
    assert exc.value.status_code == 400


async def test_seo_save_uses_real_resource_rights(db, org, mock_request, regular_user):
    await _add(db, _course())
    body = SeoSettingsUpdate(seo=ResourceSEO(title="T"))
    for user in (_token(org.id, {"courses": {"action_read": True}}), regular_user):
        with pytest.raises(HTTPException) as exc:
            await seo_service.update_seo_settings(mock_request, db, user, "course", "c1", body)
        assert exc.value.status_code == 403
    token = _token(org.id, {"courses": {"action_read": True, "action_update": True}})
    saved = await seo_service.update_seo_settings(mock_request, db, token, "course", "c1", body)
    assert saved["seo"] == {"title": "T"}


def test_org_seo_config_validation():
    from src.db.organization_config import SeoOrgConfig

    cfg = SeoOrgConfig(
        google_site_verification=' <meta name="google-site-verification" content="abc-123_x" /> ',
        bing_site_verification="ABCDEF0123",
        default_title_template=" %s · Academy ",
        organization_type="CollegeOrUniversity",
    )
    assert cfg.google_site_verification == "abc-123_x"
    assert cfg.default_title_template == "%s · Academy"
    assert SeoOrgConfig().indexing_disabled is False
    for bad in (
        {"yandex_verification": "<script>"},
        {"pinterest_verification": "x" * 201},
        {"default_title_template": "no slot"},
        {"organization_type": "Nope"},
    ):
        with pytest.raises(ValidationError):
            SeoOrgConfig(**bad)


@pytest.fixture(autouse=True)
def _ai_credit_store(ai_credit_spy):
    """Fake credit store + usage ledger for metered AI charges (conftest)."""
    yield ai_credit_spy
