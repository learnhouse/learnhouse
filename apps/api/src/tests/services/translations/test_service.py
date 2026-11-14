"""Course language versions, editor side: languages, status, default,
glossary, course fields, outline, chapter and activity translations,
segments, outdated detection and permissions."""

import json
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.translations import ActivityTranslation, ChapterTranslation, CourseTranslation
from src.services.courses.translations import jobs
from src.services.courses.translations import service as svc
from src.services.courses.translations.content import iter_segments


async def _add(req, db, user, locale="fr"):
    return await svc.add_language(req, db, user, "course_test", svc.AddLanguage(locale=locale))


async def _fresh(db, model, id_):
    db.expire_all()
    return await db.get(model, id_)


# ── languages ────────────────────────────────────────────────────────────────


class TestLanguages:
    async def test_add_list_remove(self, mock_request, db, admin_user, page, video, fake_redis):
        lang = await _add(mock_request, db, admin_user, "FR")
        assert lang.locale == "fr" and lang.status == "draft" and lang.language_name == "French"
        course = await svc.load_course(db, "course_test")
        assert course.default_locale == "en"  # set on the first language
        await _add(mock_request, db, admin_user, "ar")
        jobs.save_job("course_test", {"job_id": "j1", "locale": "fr", "state": "running", "done": 1, "total": 4})
        overview = await svc.get_languages_overview(mock_request, db, admin_user, "course_test")
        assert [lang.locale for lang in overview.languages] == ["fr", "ar"]
        assert overview.languages[1].rtl is True
        assert overview.languages[0].progress.activities_total == 2
        assert overview.jobs[0]["job_id"] == "j1"
        assert "ar" in overview.rtl_locales

        await svc.write_activity_translation(db, page, course, "fr", name="Quiz FR")
        out = await svc.remove_language(mock_request, db, admin_user, "course_test", "fr")
        assert out["deleted"]["activities"] == 1
        assert (await db.execute(select(ActivityTranslation))).scalars().all() == []
        with pytest.raises(HTTPException) as e:
            await svc.remove_language(mock_request, db, admin_user, "course_test", "fr")
        assert e.value.status_code == 404

    async def test_add_refusals(self, mock_request, db, admin_user, course):
        await _add(mock_request, db, admin_user)
        for locale, code in (("fr", 409), ("en", 409), ("not a code", 422)):
            with pytest.raises(HTTPException) as e:
                await _add(mock_request, db, admin_user, locale)
            assert e.value.status_code == code
        with patch.object(svc, "MAX_LANGUAGES", 1):
            with pytest.raises(HTTPException) as e:
                await _add(mock_request, db, admin_user, "de")
            assert e.value.status_code == 409

    async def test_status_publishes_items(self, mock_request, db, admin_user, page, chapter):
        await _add(mock_request, db, admin_user)
        course = await svc.load_course(db, "course_test")
        with pytest.raises(HTTPException) as e:  # course name not translated
            await svc.set_language_status(mock_request, db, admin_user, "course_test", "fr", svc.LanguageStatusWrite(status="published"))
        assert e.value.status_code == 409
        t = await svc.require_language(db, course, "fr")
        await svc.write_course_translation(db, course, t, svc.CourseTranslationWrite(name="Cours"), user_id=1)
        await svc.write_activity_translation(db, page, course, "fr", name="Page")
        await svc.write_chapter_translation(db, course, chapter, "fr", svc.ChapterTranslationWrite(name="Chapitre"))
        lang = await svc.set_language_status(mock_request, db, admin_user, "course_test", "fr", svc.LanguageStatusWrite(status="published"))
        assert lang.status == "published" and lang.progress.activities_published == 1
        statuses = {r.status for r in (await db.execute(select(ChapterTranslation))).scalars()}
        assert statuses == {"published"}
        lang = await svc.set_language_status(
            mock_request, db, admin_user, "course_test", "fr", svc.LanguageStatusWrite(status="draft", include_items=False))
        assert lang.status == "draft"
        assert (await db.execute(select(ActivityTranslation))).scalars().first().status == "published"

    async def test_default_locale(self, mock_request, db, admin_user, course):
        assert (await svc.set_default_locale(mock_request, db, admin_user, "course_test", svc.DefaultLocaleWrite(locale="de")))["default_locale"] == "de"
        await _add(mock_request, db, admin_user, "fr")
        with pytest.raises(HTTPException) as e:
            await svc.set_default_locale(mock_request, db, admin_user, "course_test", svc.DefaultLocaleWrite(locale="fr"))
        assert e.value.status_code == 409

    async def test_glossary(self, mock_request, db, admin_user, course):
        assert (await svc.get_glossary(mock_request, db, admin_user, "course_test")).do_not_translate == []
        g = svc.Glossary(do_not_translate=["Kitebase", " Kitebase ", ""], notes="Formal",
                         terms=[svc.GlossaryTerm(source="checkout", translations={"FR": "paiement", "xx yy": "?", "de": " "})])
        saved = await svc.update_glossary(mock_request, db, admin_user, "course_test", g)
        assert saved.do_not_translate == ["Kitebase"]
        got = await svc.get_glossary(mock_request, db, admin_user, "course_test")
        assert got.terms[0].translations == {"fr": "paiement"}
        course.extra_metadata = {svc.GLOSSARY_KEY: {"terms": "broken"}}
        assert svc.glossary_of(course).terms == []


# ── permissions ──────────────────────────────────────────────────────────────


class TestPermissions:
    async def test_learners_and_other_orgs_cannot_edit(self, mock_request, db, admin_user, regular_user, other_admin, page):
        await _add(mock_request, db, admin_user)
        calls = [
            lambda u: svc.get_languages_overview(mock_request, db, u, "course_test"),
            lambda u: _add(mock_request, db, u, "de"),
            lambda u: svc.get_course_translation(mock_request, db, u, "course_test", "fr"),
            lambda u: svc.get_activity_translation(mock_request, db, u, "activity_test", "fr"),
            lambda u: svc.update_activity_translation(mock_request, db, u, "activity_test", "fr", svc.ActivityTranslationWrite(name="x")),
            lambda u: svc.get_outline(mock_request, db, u, "course_test", "fr"),
        ]
        for user in (regular_user, other_admin):
            for call in calls:
                with pytest.raises(HTTPException) as e:
                    await call(user)
                assert e.value.status_code in (401, 403, 404)

    async def test_not_found(self, mock_request, db, admin_user, course):
        with pytest.raises(HTTPException) as e:
            await svc.get_languages_overview(mock_request, db, admin_user, "course_missing")
        assert e.value.status_code == 404
        with pytest.raises(HTTPException) as e:
            await svc.get_activity_translation(mock_request, db, admin_user, "activity_missing", "fr")
        assert e.value.status_code == 404


# ── course fields, outline, chapters ─────────────────────────────────────────


class TestCourseFields:
    async def test_write_read_outdated_and_seo_merge(self, mock_request, db, admin_user, course):
        await _add(mock_request, db, admin_user)
        course.seo = {"title": "Learn", "robots_noindex": False}
        db.add(course)
        await db.commit()
        read = await svc.update_course_translation(mock_request, db, admin_user, "course_test", "fr", svc.CourseTranslationWrite(
            name="  Cours  ", description="Un cours", learnings='[{"text": "Lire"}]', tags="a, b",
            seo={"title": "Apprendre", "description": "Desc", "robots_noindex": True}, slug="Mon Cours"))
        assert read.name == "Cours" and read.slug == "mon-cours" and not read.outdated
        assert read.seo == {"title": "Apprendre", "description": "Desc"}  # only text keys kept
        assert read.source.seo["title"] == "Learn"
        read = await svc.update_course_translation(mock_request, db, admin_user, "course_test", "fr",
                                                   svc.CourseTranslationWrite(seo={"description": None}, slug=""))
        assert read.seo == {"title": "Apprendre"} and read.slug is None
        course.description = "Changed source"
        db.add(course)
        await db.commit()
        read = await svc.get_course_translation(mock_request, db, admin_user, "course_test", "fr")
        assert read.outdated is True
        # An SEO-only write can keep the translation flagged.
        t = await svc.require_language(db, course, "fr")
        await svc.write_course_translation(db, course, t, svc.CourseTranslationWrite(seo={"title": "T"}), user_id=1, mark_current=False)
        assert (await svc.get_course_translation(mock_request, db, admin_user, "course_test", "fr")).outdated is True

    async def test_slug_and_seo_validation(self, mock_request, db, admin_user, course, org):
        from src.db.courses.courses import Course

        db.add(Course(id=9, name="Other", public=True, open_to_contributors=False, org_id=org.id, course_uuid="course_o"))
        await db.commit()
        db.add(CourseTranslation(course_id=9, org_id=org.id, locale="fr", slug="pris"))
        await db.commit()
        await _add(mock_request, db, admin_user)
        for body, code in ((svc.CourseTranslationWrite(slug="pris"), 409), (svc.CourseTranslationWrite(slug="!!!"), 422),
                           (svc.CourseTranslationWrite(seo={"title": "x" * 500}), 400)):
            with pytest.raises(HTTPException) as e:
                await svc.update_course_translation(mock_request, db, admin_user, "course_test", "fr", body)
            assert e.value.status_code == code

    async def test_outline_and_chapters(self, mock_request, db, admin_user, page, video, chapter):
        await _add(mock_request, db, admin_user)
        course = await svc.load_course(db, "course_test")
        outline = await svc.get_outline(mock_request, db, admin_user, "course_test", "fr")
        [ch] = outline["chapters"]
        assert ch["translation"] is None and [a["translatable"] for a in ch["activities"]] == [True, False]
        out = await svc.update_chapter_translation(mock_request, db, admin_user, "course_test", "fr", "chapter_test",
                                                   svc.ChapterTranslationWrite(name=" Chapitre ", description="D", status="published"))
        assert out["name"] == "Chapitre" and out["status"] == "published"
        await svc.write_activity_translation(db, page, course, "fr", name="Quiz")
        outline = await svc.get_outline(mock_request, db, admin_user, "course_test", "fr")
        [ch] = outline["chapters"]
        assert ch["translation"]["name"] == "Chapitre" and not ch["translation"]["outdated"]
        assert ch["activities"][0]["translation"]["current_source_version"] == 3
        with pytest.raises(HTTPException) as e:
            await svc.update_chapter_translation(mock_request, db, admin_user, "course_test", "fr", "chapter_nope",
                                                 svc.ChapterTranslationWrite(name="x"))
        assert e.value.status_code == 404

    async def test_structure_skips_duplicate_links(self, db, org, course, chapter, page):
        from src.db.courses.course_chapters import CourseChapter

        db.add(CourseChapter(chapter_id=chapter.id, course_id=course.id, org_id=org.id, order=2, creation_date="", update_date=""))
        await db.commit()
        structure = await svc.course_structure(db, course.id)
        assert len(structure) == 1 and structure[0][1][0].id == page.id


# ── activity translations ────────────────────────────────────────────────────


class TestActivityTranslations:
    async def test_lifecycle(self, mock_request, db, admin_user, page):
        await _add(mock_request, db, admin_user)
        read = await svc.get_activity_translation(mock_request, db, admin_user, "activity_test", "fr", include_source=True)
        assert read.exists is False and read.source["name"] == "Quiz and flipcards"
        read = await svc.seed_activity_translation(mock_request, db, admin_user, "activity_test", "fr", svc.SeedWrite(**{"from": "source"}))
        assert read.exists and read.version == 1 and read.name == "Quiz and flipcards"
        assert "comment" not in json.dumps(read.content)
        again = await svc.seed_activity_translation(mock_request, db, admin_user, "activity_test", "fr", svc.SeedWrite())
        assert again.version == 1
        with patch.object(svc, "notify_translation_changed") as notify:
            read = await svc.update_activity_translation(mock_request, db, admin_user, "activity_test", "fr", svc.ActivityTranslationWrite(
                content={"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Salut"}]}]},
                base_version=1, name="Quiz FR", status="published"))
        notify.assert_called_once()
        assert read.version == 2 and read.status == "published" and read.updated_by == "Admin User"
        with pytest.raises(HTTPException) as e:
            await svc.update_activity_translation(mock_request, db, admin_user, "activity_test", "fr",
                                                  svc.ActivityTranslationWrite(name="x", base_version=1))
        assert e.value.status_code == 409 and e.value.detail["current_version"] == 2
        for bad in ({"type": "paragraph"}, "nope"):
            with pytest.raises(HTTPException):
                await svc.update_activity_translation(mock_request, db, admin_user, "activity_test", "fr", svc.ActivityTranslationWrite.model_construct(content=bad, name=None, extra=None, base_version=None, status=None))
        listed = await svc.list_activity_translations(mock_request, db, admin_user, "activity_test")
        assert listed[0]["locale"] == "fr" and listed[0]["status"] == "published"
        read = await svc.set_activity_translation_status(mock_request, db, admin_user, "activity_test", "fr", svc.StatusWrite(status="draft"))
        assert read.status == "draft"
        assert (await svc.delete_activity_translation(mock_request, db, admin_user, "activity_test", "fr"))["deleted"]
        for call in (
            svc.set_activity_translation_status(mock_request, db, admin_user, "activity_test", "fr", svc.StatusWrite(status="draft")),
            svc.delete_activity_translation(mock_request, db, admin_user, "activity_test", "fr"),
        ):
            with pytest.raises(HTTPException) as e:
                await call
            assert e.value.status_code == 404

    async def test_seed_empty_and_non_page(self, mock_request, db, admin_user, page, video):
        await _add(mock_request, db, admin_user)
        read = await svc.seed_activity_translation(mock_request, db, admin_user, "activity_test", "fr", svc.SeedWrite(**{"from": "empty"}))
        assert read.name == "" and read.content == {"type": "doc", "content": [{"type": "paragraph"}]}
        read = await svc.seed_activity_translation(mock_request, db, admin_user, "activity_video", "fr", svc.SeedWrite())
        assert read.content is None and read.name == "Intro video"
        with pytest.raises(HTTPException) as e:
            await svc.update_activity_translation(mock_request, db, admin_user, "activity_video", "fr",
                                                  svc.ActivityTranslationWrite(content={"type": "doc", "content": []}))
        assert e.value.status_code == 422
        for call in (svc.get_segments(mock_request, db, admin_user, "activity_video", "fr"),
                     svc.put_segments(mock_request, db, admin_user, "activity_video", "fr", svc.SegmentsWrite(segments={"s0": "x"}))):
            with pytest.raises(HTTPException) as e:
                await call
            assert e.value.status_code == 422
        # a name change marks a non-page translation outdated
        video.name = "New title"
        db.add(video)
        await db.commit()
        assert (await svc.get_activity_translation(mock_request, db, admin_user, "activity_video", "fr")).outdated

    async def test_language_must_exist(self, mock_request, db, admin_user, page):
        with pytest.raises(HTTPException) as e:
            await svc.get_activity_translation(mock_request, db, admin_user, "activity_test", "fr")
        assert e.value.status_code == 404

    async def test_segments_and_outdated(self, mock_request, db, admin_user, page):
        await _add(mock_request, db, admin_user)
        seg = await svc.get_segments(mock_request, db, admin_user, "activity_test", "fr")
        assert seg["segments"] and seg["translated_name"] is None
        texts = {s["id"]: f"FR {s['text']}" for s in seg["segments"] if s["kind"] == "attr"}
        read = await svc.put_segments(mock_request, db, admin_user, "activity_test", "fr",
                                      svc.SegmentsWrite(source_hash=seg["source_hash"], name="Quiz FR", segments=texts))
        assert read.exists and not read.outdated and read.source_version == 3
        seg2 = await svc.get_segments(mock_request, db, admin_user, "activity_test", "fr")
        assert sum(1 for s in seg2["segments"] if s.get("translated")) == len(texts)
        # A second partial write keeps the earlier segments.
        first_text = next(s for s in seg["segments"] if s["kind"] == "text")
        read = await svc.put_segments(mock_request, db, admin_user, "activity_test", "fr",
                                      svc.SegmentsWrite(segments={first_text["id"]: "Bonjour"}))
        seg3 = await svc.get_segments(mock_request, db, admin_user, "activity_test", "fr")
        assert sum(1 for s in seg3["segments"] if s.get("translated")) == len(texts) + 1
        # The source changes: outdated, and stale segment writes are refused.
        content = json.loads(json.dumps(page.content))
        first = iter_segments(content)[0]
        node = content
        for i in first.node_path:
            node = node["content"][i]
        node.setdefault("attrs", {})
        if first.kind == "attr":
            target = node["attrs"]
            for k in first.attr_path[:-1]:
                target = target[k]
            target[first.attr_path[-1]] = "Changed source text"
        else:
            node["content"] = [{"type": "text", "text": "Changed source text"}]
        page.content = content
        page.current_version = 4
        db.add(page)
        await db.commit()
        read = await svc.get_activity_translation(mock_request, db, admin_user, "activity_test", "fr")
        assert read.outdated and read.source_version == 3 and read.current_source_version == 4
        with pytest.raises(HTTPException) as e:
            await svc.put_segments(mock_request, db, admin_user, "activity_test", "fr",
                                   svc.SegmentsWrite(source_hash=seg["source_hash"], segments={"s0": "x"}))
        assert e.value.status_code == 409
        overview = await svc.get_languages_overview(mock_request, db, admin_user, "course_test")
        assert overview.languages[0].progress.activities_outdated == 1
        # Marking it current again (any write)
        await svc.update_activity_translation(mock_request, db, admin_user, "activity_test", "fr", svc.ActivityTranslationWrite(name="Quiz FR"))
        assert not (await svc.get_activity_translation(mock_request, db, admin_user, "activity_test", "fr")).outdated

    async def test_extra_texts_and_progress_of_other_locales(self, mock_request, db, admin_user, page, course, fake_redis):
        await _add(mock_request, db, admin_user)
        await _add(mock_request, db, admin_user, "de")
        t = await svc.write_activity_translation(db, page, course, "fr", extra={"assignment": {"title": "Devoir"}})
        assert t.extra == {"assignment": {"title": "Devoir"}}
        # a translation row of an activity no longer in the course structure is ignored
        db.add(ActivityTranslation(activity_id=page.id + 100, course_id=course.id, org_id=course.org_id, locale="de"))
        await db.commit()
        overview = await svc.get_languages_overview(mock_request, db, admin_user, "course_test")
        progress = {lang.locale: lang.progress.activities_translated for lang in overview.languages}
        assert progress == {"fr": 1, "de": 0}

    async def test_no_hash_means_never_outdated(self, db, page, course):
        t = ActivityTranslation(activity_id=page.id, course_id=course.id, org_id=course.org_id, locale="fr", source_hash=None)
        assert svc.activity_outdated(page, t) is False

    async def test_user_name_helper(self, db, admin_user):
        assert await svc._user_name(db, None) is None
        assert await svc._user_name(db, 999) is None


class TestCollabNotify:
    async def test_locale_reset_is_posted(self, monkeypatch, db, page, course):
        monkeypatch.setenv("COLLAB_INTERNAL_KEY", "k" * 40)
        t = ActivityTranslation(activity_id=page.id, course_id=course.id, org_id=course.org_id, locale="fr",
                                content={"type": "doc", "content": []}, version=4)
        posted = {}

        class Client:
            def __init__(self, **kw):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, params=None, json=None, headers=None):
                posted.update(url=url, params=params, json=json)

        with patch("httpx.AsyncClient", Client):
            svc.notify_translation_changed(page, t, 1)
            from src.services.courses.activities import collab_notify

            import asyncio
            await asyncio.gather(*list(collab_notify._pending))
        assert posted["url"].endswith(f"/internal/activity/{page.activity_uuid}/reset")
        assert posted["params"] == {"locale": "fr"} and posted["json"]["current_version"] == 4

    async def test_no_key_or_not_a_page_does_nothing(self, monkeypatch, db, page, video, course):
        monkeypatch.delenv("COLLAB_INTERNAL_KEY", raising=False)
        t = ActivityTranslation(activity_id=page.id, course_id=course.id, org_id=course.org_id, locale="fr")
        with patch("src.services.courses.activities.collab_notify._schedule") as schedule:
            svc.notify_translation_changed(page, t, None)
            monkeypatch.setenv("COLLAB_INTERNAL_KEY", "k")
            svc.notify_translation_changed(video, t, None)
        schedule.assert_not_called()

    async def test_unreachable_collab_is_ignored(self, monkeypatch):
        import httpx

        class Client:
            def __init__(self, **kw):
                pass

            async def __aenter__(self):
                raise httpx.ConnectError("down")

            async def __aexit__(self, *a):
                return False

        with patch("httpx.AsyncClient", Client):
            await svc._post_locale_reset("activity_x", "fr", {}, "k")


class TestJobsAndPublic:
    async def test_jobs_store(self, fake_redis, monkeypatch):
        import time

        assert jobs.new_job_id().startswith("trjob_")
        jobs.save_job("course_x", {"job_id": "a", "state": "running", "started_at": 1})
        jobs.save_job("course_x", {"job_id": "b", "state": "done", "started_at": 2})
        fake_redis.h[jobs._key("course_x")]["c"] = "not json"
        fake_redis.h[jobs._key("course_x")]["d"] = json.dumps({"job_id": "d", "state": "running", "started_at": 0.5, "updated_at": time.time() - 700})
        fake_redis.h[jobs._key("course_x")]["e"] = json.dumps({"job_id": "e", "state": "done", "updated_at": time.time() - 7200})
        listed = jobs.list_jobs("course_x")
        assert [j["job_id"] for j in listed] == ["b", "a", "d"]
        assert listed[2]["state"] == "failed"
        assert jobs.get_job("course_x", "e")["job_id"] == "e"
        assert jobs.get_job("course_x", "zz") is None

    async def test_jobs_without_redis(self, monkeypatch):
        monkeypatch.setattr(jobs, "get_redis_client", lambda: None)
        jobs.save_job("c", {"job_id": "a"})
        assert jobs.list_jobs("c") == []

    async def test_public_languages(self, mock_request, db, admin_user, anonymous_user, course):
        await _add(mock_request, db, admin_user)
        await _add(mock_request, db, admin_user, "de")
        t = await svc.require_language(db, course, "fr")
        await svc.write_course_translation(db, course, t, svc.CourseTranslationWrite(name="Cours"), user_id=1)
        await svc.set_language_status(mock_request, db, admin_user, "course_test", "fr", svc.LanguageStatusWrite(status="published"))
        out = await svc.get_public_languages(mock_request, db, anonymous_user, "course_test")
        assert out["default_locale"] == "en" and [lang["locale"] for lang in out["locales"]] == ["fr"]
        assert out["locales"][0]["name"] == "Cours"
        assert await svc.published_locales(db, course.id) == ["fr"]
        assert await svc.published_locales_by_course(db, []) == {}

    async def test_translation_collab_state(self, mock_request, db, admin_user, page):
        await _add(mock_request, db, admin_user)
        with pytest.raises(HTTPException) as e:
            await svc.translation_collab_state(db, page, "FR")
        assert e.value.status_code == 422
        with pytest.raises(HTTPException) as e:
            await svc.translation_collab_state(db, page, "fr")
        assert e.value.status_code == 404
