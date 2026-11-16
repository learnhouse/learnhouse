"""Per-locale collab rooms (API side), MCP/shared tools, comments per
locale, the HTTP routes, and export/import of language versions."""

import base64
import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.translations import ActivityTranslation, CourseTranslation
from src.routers.courses import translations as tr_router
from src.routers.courses.activities import collab as collab_router
from src.services.ai.tools import build_registry, run_tool
from src.services.ai.tools.base import ToolContext, make_synthetic_request
from src.services.courses.activities import collab
from src.services.courses.activities.collab import AutosaveWrite, CollabStateWrite
from src.services.courses.translations import service as svc

KEY = "k" * 40
YDOC = base64.b64encode(b"\x01\x02").decode()
DOC = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Salut"}]}]}


async def _lang(req, db, user, locale="fr"):
    return await svc.add_language(req, db, user, "course_test", svc.AddLanguage(locale=locale))


class TestLocaleRooms:
    async def test_access_needs_the_language(self, monkeypatch, mock_request, db, admin_user, page):
        monkeypatch.setenv("COLLAB_INTERNAL_KEY", KEY)
        with pytest.raises(HTTPException) as e:
            await collab.get_collab_access(mock_request, "activity_test", admin_user, db, locale="fr")
        assert e.value.status_code == 404
        await _lang(mock_request, db, admin_user)
        out = await collab_router.api_get_collab_access(mock_request, "activity_test", locale="fr", db_session=db, current_user=admin_user)
        assert out.role == "editor"

    async def test_state_roundtrip_and_conflicts(self, mock_request, db, admin_user, page, video):
        await _lang(mock_request, db, admin_user)
        with pytest.raises(HTTPException) as e:
            await collab.get_translation_collab_state("activity_test", "fr", db)
        assert e.value.status_code == 404
        await svc.seed_activity_translation(mock_request, db, admin_user, "activity_test", "fr", svc.SeedWrite())
        state = await collab_router.api_get_collab_state("activity_test", locale="fr", db_session=db)
        assert state.current_version == 1 and state.ydoc_b64 is None and state.last_modified_by.name == "Admin User"
        res = await collab_router.api_put_collab_state(
            "activity_test", CollabStateWrite(base_version=1, ydoc_b64=YDOC), locale="fr", db_session=db)
        assert res.current_version == 1  # ydoc only: no new version
        res = await collab.put_translation_collab_state(
            "activity_test", "fr", CollabStateWrite(base_version=1, ydoc_b64=YDOC, content=DOC, contributor_user_ids=[1]), db)
        assert res.current_version == 2 and res.version_number is None
        state = await collab.get_translation_collab_state("activity_test", "fr", db)
        assert state.content == DOC and state.ydoc_version == 2
        # The default room's activity is untouched
        assert "Salut" not in json.dumps(page.content)
        for body, code in (
            (CollabStateWrite(base_version=1, ydoc_b64=YDOC), 409),
            (CollabStateWrite(base_version=2, ydoc_b64=YDOC, content={"type": "x"}), 422),
        ):
            with pytest.raises(HTTPException) as e:
                await collab.put_translation_collab_state("activity_test", "fr", body, db)
            assert e.value.status_code == code
        for call in (collab.get_translation_collab_state("activity_video", "fr", db),
                     collab.put_translation_collab_state("activity_video", "fr", CollabStateWrite(base_version=1, ydoc_b64=YDOC), db),
                     collab.put_translation_collab_state("activity_test", "de", CollabStateWrite(base_version=1, ydoc_b64=YDOC), db)):
            with pytest.raises(HTTPException) as e:
                await call
            assert e.value.status_code == 404
        # default room calls still go to the default handlers
        with patch.object(collab_router, "get_collab_state", new=AsyncMock(return_value="default")):
            assert await collab_router.api_get_collab_state("activity_test", locale=None, db_session=db) == "default"
        with patch.object(collab_router, "put_collab_state", new=AsyncMock(return_value="default")):
            assert await collab_router.api_put_collab_state("activity_test", CollabStateWrite(base_version=1, ydoc_b64=YDOC), locale=None, db_session=db) == "default"

    async def test_autosave_in_a_language(self, mock_request, db, admin_user, page, video):
        await _lang(mock_request, db, admin_user)
        await svc.seed_activity_translation(mock_request, db, admin_user, "activity_test", "fr", svc.SeedWrite())
        res = await collab_router.api_autosave_content(
            mock_request, "activity_test", AutosaveWrite(content=DOC, base_version=1), locale="fr", db_session=db, current_user=admin_user)
        assert res.current_version == 2
        with pytest.raises(HTTPException) as e:
            await collab.autosave_translation(mock_request, "activity_test", "fr", AutosaveWrite(content=DOC, base_version=1), admin_user, db)
        assert e.value.status_code == 409
        with pytest.raises(HTTPException) as e:
            await collab.autosave_translation(mock_request, "activity_video", "fr", AutosaveWrite(content=DOC, base_version=1), admin_user, db)
        assert e.value.status_code == 404
        with patch.object(collab_router, "autosave_content", new=AsyncMock(return_value="default")):
            assert await collab_router.api_autosave_content(
                mock_request, "activity_test", AutosaveWrite(content=DOC, base_version=1), locale=None, db_session=db, current_user=admin_user) == "default"


class TestComments:
    async def test_threads_are_per_locale(self, mock_request, db, admin_user, page):
        from src.db.courses.activity_comments import ActivityCommentThread
        from src.routers.courses.activities import comments as comments_router
        from src.services.courses.activities.comments import ThreadCreate

        await comments_router.api_create_thread(mock_request, "activity_test", ThreadCreate(body="Default note", quote=""), None,
                                                locale=None, current_user=admin_user, db_session=db)
        await comments_router.api_create_thread(mock_request, "activity_test", ThreadCreate(body="Note FR", quote=""), None,
                                                locale="FR", current_user=admin_user, db_session=db)
        default = await comments_router.api_list_threads(mock_request, "activity_test", locale=None, current_user=admin_user, db_session=db)
        fr = await comments_router.api_list_threads(mock_request, "activity_test", locale="fr", current_user=admin_user, db_session=db)
        assert [t.comments[0].body for t in default.threads] == ["Default note"]
        assert [t.comments[0].body for t in fr.threads] == ["Note FR"]
        assert {t.locale for t in (await db.execute(select(ActivityCommentThread))).scalars()} == {None, "fr"}
        with pytest.raises(HTTPException) as e:
            await comments_router.api_list_threads(mock_request, "activity_test", locale="bad code!", current_user=admin_user, db_session=db)
        assert e.value.status_code == 422


def _ctx(db, org, user, approved=True):
    return ToolContext(request=make_synthetic_request(), db_session=db, user=user, org=org, org_slug=org.slug,
                       mode="execute", surface="mcp", approved=approved)


class TestTools:
    async def test_mcp_translation_flow(self, db, org, admin_user, page, video, chapter):
        reg = build_registry()
        ctx = _ctx(db, org, admin_user)
        out = await run_tool(reg, "list_course_languages", {"course_uuid": "course_test"}, ctx)
        assert out.status == "executed" and out.result["languages"] == [] and "next_step" in out.result
        out = await run_tool(reg, "add_course_language", {"course_uuid": "course_test", "locale": "fr"}, ctx)
        assert out.status == "executed", out.result
        out = await run_tool(reg, "get_activity_translation", {"activity_uuid": "activity_test", "locale": "fr"}, ctx)
        segs = out.result["segments"]
        assert segs and out.result["exists"] is False
        args = {"activity_uuid": "activity_test", "locale": "fr", "name": "Quiz FR", "source_hash": out.result["source_hash"],
                "segments": {s["id"]: "FR " + s["text"] for s in segs if s["kind"] == "attr"}}
        out = await run_tool(reg, "write_activity_translation", args, ctx)
        assert out.status == "executed", out.result
        out = await run_tool(reg, "get_activity_translation", {"activity_uuid": "activity_video", "locale": "fr"}, ctx)
        assert "name" in out.result["how_to"]
        out = await run_tool(reg, "write_activity_translation", {"activity_uuid": "activity_video", "locale": "fr", "name": "Vidéo"}, ctx)
        assert out.status == "executed"
        out = await run_tool(reg, "write_activity_translation", {"activity_uuid": "activity_video", "locale": "fr"}, ctx)
        assert out.status != "executed"
        out = await run_tool(reg, "update_course_translation", {
            "course_uuid": "course_test", "locale": "fr", "name": "Cours", "seo_title": "Apprendre",
            "chapters": [{"chapter_uuid": "chapter_test", "name": "Chapitre"}]}, ctx)
        assert out.status == "executed", out.result
        out = await run_tool(reg, "update_course_translation", {"course_uuid": "course_test", "locale": "fr"}, ctx)
        assert out.status != "executed"
        out = await run_tool(reg, "update_course_translation", {"course_uuid": "course_test", "locale": "fr", "seo_keywords": "a"}, ctx)
        assert out.status == "executed"
        out = await run_tool(reg, "set_language_status", {"course_uuid": "course_test", "locale": "fr", "status": "published"}, ctx)
        assert out.status == "executed", out.result
        assert out.result["undo"]["args"]["status"] == "draft"
        out = await run_tool(reg, "list_course_languages", {"course_uuid": "course_test", "locale": "fr"}, ctx)
        lang = out.result["languages"][0]
        assert lang["status"] == "published" and lang["progress"]["activities_translated"] == 2
        assert out.result["outline"]["chapters"][0]["translation"]["name"] == "Chapitre"
        assert "ui_block" not in out.result  # MCP gets no Atlas view
        agent = ToolContext(request=make_synthetic_request(), db_session=db, user=admin_user, org=org, org_slug=org.slug,
                            mode="execute", surface="agent")
        out = await run_tool(reg, "list_course_languages", {"course_uuid": "course_test"}, agent)
        from src.services.ai.tools.translations import languages_view

        v = languages_view(await svc.get_languages_overview(make_synthetic_request(), db, admin_user, "course_test"))
        assert v["type"] == "view" and v["components"][1]["rows"][0]["status"] == "Published"
        out = await run_tool(reg, "remove_course_language", {"course_uuid": "course_test", "locale": "fr", "confirm": True}, ctx)
        assert out.status in ("executed", "denied", "pending")

    async def test_tool_limits_and_approval_needs(self, db, org, admin_user, page):
        from src.services.ai.tools import translations as t

        reg = build_registry()
        assert reg.get("set_language_status").approval_for(t.SetLanguageStatusParams(course_uuid="c", locale="fr", status="published"))
        assert not reg.get("set_language_status").approval_for(t.SetLanguageStatusParams(course_uuid="c", locale="fr", status="draft"))
        assert reg.get("write_activity_translation").approval_for(t.WriteActivityTranslationParams(activity_uuid="a", locale="fr", publish=True))
        ctx = _ctx(db, org, admin_user)
        await run_tool(reg, "add_course_language", {"course_uuid": "course_test", "locale": "fr"}, ctx)
        with patch.object(t, "MAX_SEGMENTS", 1):
            out = await run_tool(reg, "write_activity_translation", {
                "activity_uuid": "activity_test", "locale": "fr", "segments": {"s0": "a", "s1": "b"}}, ctx)
        assert out.status != "executed"
        out = await run_tool(reg, "remove_course_language", {"course_uuid": "course_test", "locale": "fr"},
                             ToolContext(request=make_synthetic_request(), db_session=db, user=admin_user, org=org,
                                         org_slug=org.slug, mode="execute", surface="agent", approved=True))
        assert out.status == "executed"


class TestRoutes:
    async def test_every_route_calls_the_service(self, mock_request, db, admin_user, page, chapter, fake_redis):
        u, d, r = admin_user, db, mock_request
        assert (await tr_router.api_add_language(r, "course_test", svc.AddLanguage(locale="fr"), db_session=d, current_user=u)).locale == "fr"
        assert (await tr_router.api_get_languages(r, "course_test", db_session=d, current_user=u)).languages
        await tr_router.api_put_course_translation(r, "course_test", "fr", svc.CourseTranslationWrite(name="Cours"), db_session=d, current_user=u)
        assert (await tr_router.api_get_course_translation(r, "course_test", "fr", db_session=d, current_user=u)).name == "Cours"
        assert (await tr_router.api_get_outline(r, "course_test", "fr", db_session=d, current_user=u))["locale"] == "fr"
        await tr_router.api_put_chapter_translation(r, "course_test", "fr", "chapter_test", svc.ChapterTranslationWrite(name="C"), db_session=d, current_user=u)
        await tr_router.api_put_glossary(r, "course_test", svc.Glossary(notes="n"), db_session=d, current_user=u)
        assert (await tr_router.api_get_glossary(r, "course_test", db_session=d, current_user=u)).notes == "n"
        await tr_router.api_seed_activity_translation(r, "activity_test", "fr", svc.SeedWrite(), db_session=d, current_user=u)
        assert (await tr_router.api_get_activity_translation(r, "activity_test", "fr", include_source=True, db_session=d, current_user=u)).exists
        await tr_router.api_put_activity_translation(r, "activity_test", "fr", svc.ActivityTranslationWrite(name="P"), db_session=d, current_user=u)
        seg = await tr_router.api_get_segments(r, "activity_test", "fr", db_session=d, current_user=u)
        await tr_router.api_put_segments(r, "activity_test", "fr", svc.SegmentsWrite(segments={"s0": "x"}), db_session=d, current_user=u)
        assert seg["segments"]
        assert (await tr_router.api_list_activity_translations(r, "activity_test", db_session=d, current_user=u))[0]["locale"] == "fr"
        await tr_router.api_set_activity_translation_status(r, "activity_test", "fr", svc.StatusWrite(status="published"), db_session=d, current_user=u)
        await tr_router.api_set_language_status(r, "course_test", "fr", svc.LanguageStatusWrite(status="published"), db_session=d, current_user=u)
        assert (await tr_router.api_public_languages(r, "course_test", db_session=d, current_user=u))["locales"][0]["locale"] == "fr"
        await tr_router.api_delete_activity_translation(r, "activity_test", "fr", db_session=d, current_user=u)
        await tr_router.api_remove_language(r, "course_test", "fr", db_session=d, current_user=u)
        assert (await tr_router.api_set_default_locale(r, "course_test", svc.DefaultLocaleWrite(locale="fr"), db_session=d, current_user=u))["default_locale"] == "fr"


class TestTransfer:
    async def test_export_import_roundtrip(self, mock_request, db, org, admin_user, page, video, chapter):
        from src.db.courses.activities import Activity
        from src.db.courses.chapters import Chapter
        from src.db.courses.courses import Course
        from src.services.courses.translations.transfer import export_translations, import_translations

        course = await svc.load_course(db, "course_test")
        assert await export_translations(db, course) is None
        await _lang(mock_request, db, admin_user, "fr")
        await _lang(mock_request, db, admin_user, "ar")
        t = await svc.require_language(db, course, "fr")
        await svc.write_course_translation(db, course, t, svc.CourseTranslationWrite(name="Cours", seo={"title": "T"}, slug="cours"), user_id=1)
        await svc.write_chapter_translation(db, course, chapter, "fr", svc.ChapterTranslationWrite(name="Chapitre"))
        seg = await svc.get_segments(mock_request, db, admin_user, "activity_test", "fr")
        await svc.write_segments(db, page, course, "fr", {s["id"]: "FR " + s["text"] for s in seg["segments"] if s["kind"] == "attr"},
                                 name="Quiz FR", status="published")
        await svc.write_activity_translation(db, video, course, "fr", name="Vidéo")
        # an outdated-structure translation (exported whole)
        await svc.write_activity_translation(db, page, course, "ar", content=DOC, name="AR")
        data = await export_translations(db, course)
        assert {lang["locale"] for lang in data["languages"]} == {"fr", "ar"}
        assert "segments" in data["activities"]["activity_test"]["fr"]
        assert "content" in data["activities"]["activity_test"]["ar"]
        assert data["chapters"]["chapter_test"]["fr"]["name"] == "Chapitre"
        json.dumps(data)

        # Import into a copy of the course structure
        new_course = Course(id=5, name="Copy", public=True, open_to_contributors=False, org_id=org.id,
                            course_uuid="course_copy", default_locale="en")
        db.add(new_course)
        await db.commit()
        new_chapter = Chapter(id=5, name="Ch", org_id=org.id, course_id=5, chapter_uuid="chapter_copy")
        new_page = Activity(id=5, name=page.name, activity_type=page.activity_type, activity_sub_type=page.activity_sub_type,
                            content=page.content, org_id=org.id, course_id=5, activity_uuid="activity_copy")
        new_video = Activity(id=6, name="Intro video", activity_type=video.activity_type, activity_sub_type=video.activity_sub_type,
                             content={}, org_id=org.id, course_id=5, activity_uuid="activity_copy_v")
        db.add_all([new_chapter, new_page, new_video])
        await db.commit()
        data["languages"].append({"locale": "fr"})  # duplicate skipped
        data["languages"].append({"locale": "en"})  # default skipped
        data["languages"].append("junk")
        data["chapters"]["chapter_gone"] = {"fr": {"name": "x"}}
        data["chapters"]["chapter_test"]["de"] = {"name": "not a language of the course"}
        data["activities"]["activity_test"]["de"] = {"name": "x"}
        data["activities"]["activity_gone"] = {"fr": {}}
        mapping = {"chapter_test": new_chapter, "activity_test": new_page, "activity_video": new_video}
        created = await import_translations(db, new_course, data, mapping)
        await db.commit()
        assert created == 2 + 1 + 3
        rows = (await db.execute(select(ActivityTranslation).where(ActivityTranslation.course_id == 5))).scalars().all()
        by = {(r.activity_id, r.locale): r for r in rows}
        assert by[(5, "fr")].name == "Quiz FR" and by[(5, "fr")].status == "published"
        assert by[(5, "ar")].content == DOC and by[(6, "fr")].content is None
        imported = (await db.execute(select(CourseTranslation).where(CourseTranslation.course_id == 5))).scalars().all()
        assert {r.locale for r in imported} == {"fr", "ar"} and all(r.slug is None for r in imported)
        assert await import_translations(db, new_course, "junk", {}) == 0

    async def test_export_service_includes_translations(self, mock_request, db, admin_user, page):
        from src.services.courses.transfer.export_service import _load_course_export_data

        await _lang(mock_request, db, admin_user)
        course = await svc.load_course(db, "course_test")
        data, _ = await _load_course_export_data(course, db)
        assert data["default_locale"] == "en" and data["translations"]["languages"][0]["locale"] == "fr"

    async def test_imported_locale_helper(self):
        from src.services.courses.transfer.import_service import _imported_locale

        assert _imported_locale("FR") == "fr" and _imported_locale(None) is None


class TestImportPackage:
    async def test_import_single_course_restores_language_versions(self, db, org, admin_user, tmp_path, monkeypatch):
        from src.services.courses.transfer.import_service import _import_single_course
        from src.services.courses.transfer.models import ImportOptions

        monkeypatch.chdir(tmp_path)
        page = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hello"}]}]}
        root = tmp_path / "pkg"
        act_dir = root / "chapters" / "chapter_old" / "activities" / "activity_old"
        act_dir.mkdir(parents=True)
        (root / "course.json").write_text(json.dumps({
            "name": "Course", "default_locale": "EN",
            "translations": {"languages": [{"locale": "fr", "status": "published", "name": "Cours"}],
                             "chapters": {"chapter_old": {"fr": {"name": "Chapitre"}}},
                             "activities": {"activity_old": {"fr": {"name": "Page", "segments": {"s0": "Bonjour"}, "status": "published"}}}},
        }))
        (root / "chapters" / "chapter_old" / "chapter.json").write_text(json.dumps({"chapter_uuid": "chapter_old", "name": "Chapter", "order": 1}))
        (act_dir / "activity.json").write_text(json.dumps({
            "activity_uuid": "activity_old", "name": "Page", "activity_type": "TYPE_DYNAMIC",
            "activity_sub_type": "SUBTYPE_DYNAMIC_PAGE", "content": page, "order": 1}))
        course = await _import_single_course(
            course_path=str(root), organization=org, current_user=admin_user,
            options=ImportOptions(course_uuids=["pkg"]), db_session=db, new_course_uuid="course_imported")
        await db.commit()
        assert course.default_locale == "en"
        t = (await db.execute(select(ActivityTranslation).where(ActivityTranslation.course_id == course.id))).scalars().one()
        assert t.content["content"][0]["content"][0]["text"] == "Bonjour" and t.status == "published"
