"""Learner reads of multilingual courses: resolution, publish rules (drafts
never shown), catalog, search, certificates, assignments, sitemap, RAG."""

import json
from unittest.mock import patch


from src.db.courses.translations import ActivityTranslation, ChapterTranslation, CourseTranslation
from src.routers.courses import courses as courses_router
from src.routers.courses.activities import activities as activities_router
from src.services.courses.translations import learner

FR_DOC = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Bonjour"}]}]}


async def _french(db, course, chapter, page, *, lang_status="published", item_status="published"):
    """A French version of the test course."""
    course.default_locale = "en"
    course.seo = {"title": "Learn", "robots_noindex": False}
    db.add(course)
    db.add(CourseTranslation(course_id=course.id, org_id=course.org_id, locale="fr", status=lang_status,
                             name="Cours test", description="Un cours", seo={"title": "Apprendre"}))
    db.add(ChapterTranslation(chapter_id=chapter.id, course_id=course.id, org_id=course.org_id, locale="fr",
                              status=item_status, name="Chapitre", description="Desc FR"))
    db.add(ActivityTranslation(activity_id=page.id, course_id=course.id, org_id=course.org_id, locale="fr",
                               status=item_status, name="Page FR", content=FR_DOC, version=1))
    await db.commit()


class TestCourseReads:
    async def test_meta_in_french(self, mock_request, db, course, chapter, page, video, anonymous_user):
        await _french(db, course, chapter, page)
        meta = await courses_router.api_get_course_meta(
            mock_request, "course_test", with_unpublished_activities=False, slim=True, lang="fr-CA,en",
            db_session=db, current_user=anonymous_user)
        assert meta.name == "Cours test" and meta.locale == "fr" and meta.requested_locale == "fr-CA"
        assert meta.available_locales == ["fr"] and meta.default_locale == "en" and not meta.translation_fallback
        assert meta.seo["title"] == "Apprendre" and meta.seo["robots_noindex"] is False
        [ch] = meta.chapters
        assert ch.name == "Chapitre" and ch.description == "Desc FR"
        names = {a.activity_uuid: (a.name, a.locale, a.translation_fallback) for a in ch.activities}
        assert names["activity_test"] == ("Page FR", "fr", False)
        assert names["activity_video"] == ("Intro video", "en", True)  # untranslated: default + notice

    async def test_english_and_no_lang(self, mock_request, db, course, chapter, page, anonymous_user):
        await _french(db, course, chapter, page)
        meta = await courses_router.api_get_course_meta(
            mock_request, "course_test", with_unpublished_activities=False, slim=True, lang="en-US",
            db_session=db, current_user=anonymous_user)
        assert meta.name == "Test Course" and meta.locale == "en"
        assert meta.chapters[0].activities[0].locale == "en"
        plain = await courses_router.api_get_course(mock_request, "course_test", lang=None, db_session=db, current_user=anonymous_user)
        assert plain.name == "Test Course" and plain.locale is None and plain.available_locales == ["fr"]
        fr = await courses_router.api_get_course(mock_request, "course_test", lang="fr", db_session=db, current_user=anonymous_user)
        assert fr.name == "Cours test"
        unknown = await courses_router.api_get_course(mock_request, "course_test", lang="de", db_session=db, current_user=anonymous_user)
        assert unknown.name == "Test Course" and unknown.translation_fallback is True

    async def test_drafts_are_never_served(self, mock_request, db, course, chapter, page, anonymous_user, admin_user):
        await _french(db, course, chapter, page, lang_status="draft")
        for user in (anonymous_user, admin_user):
            meta = await courses_router.api_get_course_meta(
                mock_request, "course_test", with_unpublished_activities=False, slim=True, lang="fr",
                db_session=db, current_user=user)
            assert meta.name == "Test Course" and meta.available_locales == [] and meta.translation_fallback
            act = await activities_router.api_get_activity(mock_request, "activity_test", lang="fr", current_user=user, db_session=db)
            assert act.name == "Test Activity" or act.name == "Quiz and flipcards"
            assert act.locale == "en" and act.translation_fallback

    async def test_draft_item_in_a_published_language(self, mock_request, db, course, chapter, page, anonymous_user):
        await _french(db, course, chapter, page, item_status="draft")
        act = await activities_router.api_get_activity(mock_request, "activity_test", lang="fr", current_user=anonymous_user, db_session=db)
        assert act.locale == "en" and act.translation_fallback and act.available_locales == ["fr"]
        meta = await courses_router.api_get_course_meta(
            mock_request, "course_test", with_unpublished_activities=False, slim=True, lang="fr",
            db_session=db, current_user=anonymous_user)
        assert meta.name == "Cours test" and meta.chapters[0].name == "Test Chapter"

    async def test_activity_content_in_french_goes_through_redaction(self, mock_request, db, course, chapter, page, anonymous_user):
        await _french(db, course, chapter, page)
        act = await activities_router.api_get_activity(mock_request, "activity_test", lang="fr,en", current_user=anonymous_user, db_session=db)
        assert act.name == "Page FR" and act.locale == "fr" and act.content == FR_DOC
        en = await activities_router.api_get_activity(mock_request, "activity_test", lang="en", current_user=anonymous_user, db_session=db)
        assert en.locale == "en" and "Bonjour" not in json.dumps(en.content)
        none = await activities_router.api_get_activity(mock_request, "activity_test", lang=None, current_user=anonymous_user, db_session=db)
        assert none.locale is None and none.available_locales == ["fr"]

    async def test_localize_helpers_on_dicts(self, db, course):
        d = {"id": course.id, "name": "x", "seo": None, "default_locale": None, "chapters": []}
        await learner.localize_course(db, d, course_id=course.id, default_locale=None, lang="fr")
        assert d["locale"] == "en" and d["translation_fallback"] is True
        assert learner.merged_seo({"a": 1}, None) == {"a": 1}
        assert await learner.localize_course_list(db, [], "fr") == []
        assert await learner.localized_course_name(db, course.id, None, "Name", None) == "Name"
        assert await learner.courses_in_language(db, course.org_id, "not a code") == set()


class TestCatalogSearchCertificates:
    async def test_catalog_localized_and_filtered(self, mock_request, db, org, course, chapter, page, anonymous_user, admin_user):
        from src.db.courses.courses import Course

        await _french(db, course, chapter, page)
        db.add(Course(id=7, name="Kurs", public=True, published=True, open_to_contributors=False, org_id=org.id,
                      course_uuid="course_de", default_locale="de", creation_date="1", update_date="1"))
        await db.commit()
        rows = await courses_router.api_get_course_by_orgslug(
            mock_request, 1, 10, org.slug, include_unpublished=False, lang="fr", language=None,
            db_session=db, current_user=anonymous_user)
        by = {r.course_uuid: r for r in rows}
        assert by["course_test"].name == "Cours test" and by["course_test"].available_locales == ["fr"]
        assert by["course_de"].name == "Kurs" and by["course_de"].locale == "de"
        for language, expected in (("fr", {"course_test"}), ("fr-BE", {"course_test"}), ("de", {"course_de"}), ("en", {"course_test"})):
            rows = await courses_router.api_get_course_by_orgslug(
                mock_request, 1, 10, org.slug, include_unpublished=False, lang=None, language=language,
                db_session=db, current_user=anonymous_user)
            assert {r.course_uuid for r in rows} == expected, language
        assert await learner.courses_in_language(db, org.id, "fr") == {course.id}

    async def test_search_finds_translated_titles(self, mock_request, db, org, course, chapter, page, admin_user):
        from src.routers import search as search_router

        await _french(db, course, chapter, page)
        with patch("src.routers.search.check_search_rate_limit", return_value=(True, 0)):
            result = await search_router.api_search_across_org(
                mock_request, org.slug, query="Cours test", page=1, limit=10, lang="fr", db_session=db, current_user=admin_user)
        assert [c.name for c in result.courses] == ["Cours test"]

    async def test_certificate_course_name(self, db, course, chapter, page):
        from src.services.courses.certifications import _course_card

        await _french(db, course, chapter, page)
        assert (await _course_card(db, course, "fr"))["name"] == "Cours test"
        assert (await _course_card(db, course, "de"))["name"] == "Test Course"
        assert (await _course_card(db, course, None))["name"] == "Test Course"
        assert await learner.localized_course_name(db, course.id, "en", "Test Course", "fr") == "Cours test"


class TestAssignments:
    async def test_assignment_texts_and_tasks(self, db, org, course, chapter, page):
        from src.db.courses.assignments import Assignment, AssignmentTask
        from src.services.courses.translations import assignments as at

        a = Assignment(id=1, title="Essay", description="Write it", due_date="", published=True, grading_type="NUMERIC",
                       org_id=org.id, course_id=course.id, chapter_id=chapter.id, activity_id=page.id,
                       assignment_uuid="assignment_x", creation_date="", update_date="")
        db.add(a)
        task = AssignmentTask(id=1, title="Q1", description="Answer", hint="Think", assignment_type="QUIZ",
                              contents={"questions": [{"questionUUID": "q", "questionText": "Why?", "options": [
                                  {"optionUUID": "o", "text": "Because", "correct": True}]}], "code": "x"},
                              max_grade_value=10, org_id=org.id, course_id=course.id, chapter_id=chapter.id,
                              activity_id=page.id, assignment_id=1, assignment_task_uuid="task_1",
                              creation_date="", update_date="")
        db.add(task)
        await db.commit()
        found = await at.assignment_for_activity(db, page.id)
        src_texts = at.assignment_source_texts(*found)
        assert src_texts["tasks"]["task_1"]["contents"] == {"questions.0.questionText": "Why?", "questions.0.options.0.text": "Because"}
        assert await at.assignment_for_activity(db, 999) is None
        await _french(db, course, chapter, page)
        t = (await db.execute(__import__("sqlmodel").select(ActivityTranslation))).scalars().first()
        t.extra = {"assignment": {"title": "Dissertation", "description": " "}, "tasks": {"task_1": {
            "title": "Q1 FR", "hint": "Réfléchis", "contents": {"questions.0.questionText": "Pourquoi ?",
                                                                 "questions.0.options.0.text": "Parce que", "nope.0": "x",
                                                                 "questions.9.text": "y", "questions.0.questionUUID": "z"}}}}
        db.add(t)
        await db.commit()
        extra = await at.published_assignment_extra(db, activity_id=page.id, course=course, lang="fr")
        read = type("R", (), {"title": "Essay", "description": "Write it"})()
        at.apply_to_assignment(read, extra)
        assert read.title == "Dissertation" and read.description == "Write it"
        tread = type("T", (), {"assignment_task_uuid": "task_1", "title": "Q1", "description": "Answer", "hint": "Think",
                               "contents": task.contents})()
        at.apply_to_task(tread, extra)
        assert tread.title == "Q1 FR" and tread.hint == "Réfléchis" and tread.description == "Answer"
        q = tread.contents["questions"][0]
        assert q["questionText"] == "Pourquoi ?" and q["options"][0]["correct"] is True and q["questionUUID"] == "q"
        assert await at.published_assignment_extra(db, activity_id=page.id, course=course, lang=None) is None
        assert at.apply_content_strings("x", {"a": "b"}) == "x"
        assert at.apply_content_strings({"a": "b"}, "bad") == {"a": "b"}
        deep: dict = {}
        node = deep
        for _ in range(at.MAX_DEPTH + 3):
            node["n"] = {}
            node = node["n"]
        node["text"] = "deep"
        assert at.content_strings(deep) == {}

    async def test_assignment_reads_with_lang(self, mock_request, db, org, course, chapter, page, admin_user):
        from src.db.courses.assignments import Assignment, AssignmentTask
        from src.services.courses.activities import assignments as asvc

        db.add(Assignment(id=1, title="Essay", description="Write it", due_date="", published=True, grading_type="NUMERIC",
                          org_id=org.id, course_id=course.id, chapter_id=chapter.id, activity_id=page.id,
                          assignment_uuid="assignment_x", creation_date="", update_date=""))
        db.add(AssignmentTask(id=1, title="Q1", description="Answer", hint="Think", assignment_type="FILE_SUBMISSION",
                              contents={}, max_grade_value=10, org_id=org.id, course_id=course.id, chapter_id=chapter.id,
                              activity_id=page.id, assignment_id=1, assignment_task_uuid="task_1", creation_date="", update_date=""))
        await db.commit()
        await _french(db, course, chapter, page)
        t = (await db.execute(__import__("sqlmodel").select(ActivityTranslation))).scalars().first()
        t.extra = {"assignment": {"title": "Dissertation"}, "tasks": {"task_1": {"title": "Q1 FR"}}}
        db.add(t)
        await db.commit()
        with patch("src.services.courses.activities.assignments.authorize_assignment_access", return_value=None):
            a = await asvc.read_assignment(mock_request, "assignment_x", admin_user, db, lang="fr")
            a2 = await asvc.read_assignment_from_activity_uuid(mock_request, "activity_test", admin_user, db, lang="fr")
            tasks = await asvc.read_assignment_tasks(mock_request, "assignment_x", admin_user, db, lang="fr")
            plain = await asvc.read_assignment(mock_request, "assignment_x", admin_user, db)
        assert a.title == a2.title == "Dissertation" and plain.title == "Essay"
        assert tasks[0].title == "Q1 FR"


class TestSitemapAndSearchIndex:
    async def test_sitemap_carries_locales(self, mock_request, db, org, course, chapter, page):
        from src.services.seo.seo import sitemap_data

        await _french(db, course, chapter, page)
        data = await sitemap_data(db, org.slug)
        [entry] = data["courses"]
        assert entry["default_locale"] == "en" and entry["available_locales"] == ["fr"]
        assert data["activities"][0]["available_locales"] == ["fr"]

    async def test_rag_indexes_published_translations(self, db, course, chapter, page):
        from src.services.ai.rag.sources import translated_segments

        await _french(db, course, chapter, page)
        [seg] = await translated_segments(page, db)
        assert seg.locator == {"locale": "fr"} and "Bonjour" in seg.text and "Page FR" in seg.text
        course_t = (await db.execute(__import__("sqlmodel").select(CourseTranslation))).scalars().first()
        course_t.status = "draft"
        db.add(course_t)
        await db.commit()
        assert await translated_segments(page, db) == []
