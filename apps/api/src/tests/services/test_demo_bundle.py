"""The demo bundle is a sales asset, so it is tested like one.

These checks are about content quality and safety as much as correctness: the
bundle is what a prospect reads before deciding, and a blank activity or a
stray customer name is a worse failure here than a stack trace.
"""

import json
import os
import pathlib
import re

import pytest

from src.services.demo.bundle_loader import (
    BUNDLE_ROOT,
    MAX_BUNDLE_BYTES,
    BundleError,
    bundle_size_bytes,
    load_bundle,
)
from src.services.demo.content import ContentError, compile_document


@pytest.fixture(scope="module")
def bundle():
    return load_bundle()


# ---------------------------------------------------------------------------
# structure
# ---------------------------------------------------------------------------

def test_bundle_loads_and_validates(bundle):
    """Loading runs the full validation pass; this failing means it is unusable."""
    assert bundle.manifest.bundle_version
    assert len(bundle.courses) == 6


def test_every_course_sits_in_a_declared_section(bundle):
    sections = {section.slug for section in bundle.manifest.sections}
    for course in bundle.courses:
        assert course.section in sections


def test_sections_are_evenly_filled(bundle):
    """Three sections of two. A lopsided catalogue looks unfinished."""
    counts: dict[str, int] = {}
    for course in bundle.courses:
        counts[course.section] = counts.get(course.section, 0) + 1
    assert sorted(counts.values()) == [2, 2, 2]


def test_every_course_has_an_assignment(bundle):
    """A course with no assessment leaves the grading inbox empty for it."""
    for course in bundle.courses:
        kinds = [
            activity.kind
            for chapter in course.chapters
            for activity in chapter.activities
        ]
        assert "assignment" in kinds, f"{course.slug} has no assignment activity"


def test_persona_weights_cover_the_student_body(bundle):
    personas = bundle.manifest.personas
    assert sum(p.weight for p in personas) == 100
    # A demo where everyone is doing well teaches a prospect nothing about the
    # reporting, so the distribution must include people who are struggling,
    # people who never started, and people who stopped.
    ids = {p.id for p in personas}
    assert {"completer", "struggling", "lurker", "dropped"} <= ids


def test_cohort_shares_account_for_everyone(bundle):
    total = sum(cohort.share for cohort in bundle.manifest.cohorts)
    assert abs(total - 1.0) < 1e-9


# ---------------------------------------------------------------------------
# content quality
# ---------------------------------------------------------------------------

def test_every_document_activity_says_something(bundle):
    """No blank or near-blank pages. A prospect will click the shortest one."""
    thin = []
    for course in bundle.courses:
        for chapter in course.chapters:
            for activity in chapter.activities:
                if activity.kind != "document":
                    continue
                if activity.word_count() < 60:
                    thin.append(f"{activity.slug} ({activity.word_count()} words)")
    assert not thin, f"activities too thin to be worth reading: {thin}"


def test_no_placeholder_text_anywhere():
    """No lorem ipsum, no TODOs, no 'sample text' left in by accident."""
    banned = re.compile(
        r"lorem ipsum|\bTODO\b|\bFIXME\b|\bTBD\b|placeholder|sample text|xxx+",
        re.IGNORECASE,
    )
    offenders = []
    for dirpath, _dirs, files in os.walk(BUNDLE_ROOT):
        for name in files:
            if not name.endswith(".json"):
                continue
            path = os.path.join(dirpath, name)
            with open(path, "r", encoding="utf-8") as handle:
                for lineno, line in enumerate(handle, 1):
                    if banned.search(line):
                        offenders.append(f"{name}:{lineno}")
    assert not offenders, f"placeholder text left in the bundle: {offenders}"


# Names that must never appear in demo content. Extend this rather than
# relying on review: the bundle is public-facing, and a real customer's name in
# a demo organisation is a conversation nobody wants to have.
DENYLIST = [
    "learnhouse",
    "acme",
    "contoso",
    "northwind",
]


def test_no_real_or_reserved_names_in_content():
    offenders = []
    pattern = re.compile("|".join(re.escape(n) for n in DENYLIST), re.IGNORECASE)
    for dirpath, _dirs, files in os.walk(BUNDLE_ROOT):
        for name in files:
            if not name.endswith((".json", ".md")):
                continue
            # The provenance file necessarily names the project itself.
            if name == "LICENSES.md":
                continue
            path = os.path.join(dirpath, name)
            with open(path, "r", encoding="utf-8") as handle:
                for lineno, line in enumerate(handle, 1):
                    match = pattern.search(line)
                    if match:
                        offenders.append(f"{name}:{lineno} ({match.group(0)})")
    assert not offenders, f"denylisted names in bundle content: {offenders}"


def test_quizzes_have_exactly_one_defensible_answer(bundle):
    """Every inline quiz needs a correct option, or it cannot be passed."""
    for course in bundle.courses:
        for chapter in course.chapters:
            for activity in chapter.activities:
                for block in activity.body:
                    if isinstance(block, dict) and "quiz" in block:
                        answers = block["quiz"]["a"]
                        correct = [text for text, ok in answers if ok]
                        assert len(correct) == 1, (
                            f"{activity.slug}: quiz has {len(correct)} correct answers"
                        )
                        assert len(answers) >= 2, f"{activity.slug}: quiz needs distractors"


# ---------------------------------------------------------------------------
# media
# ---------------------------------------------------------------------------

def test_every_referenced_image_exists(bundle):
    for course in bundle.courses:
        assert os.path.exists(bundle.media_path("courses", course.thumbnail))
    assert os.path.exists(bundle.media_path(bundle.manifest.org.logo))
    assert os.path.exists(bundle.media_path(bundle.manifest.org.thumbnail))


def test_enough_avatars_for_the_students_who_have_one(bundle):
    students = bundle.manifest.students
    avatars = os.listdir(bundle.media_path("avatars"))
    assert len(avatars) >= students.avatar_count
    assert students.with_avatar <= students.count
    # Some students deliberately have no avatar — a directory where everyone
    # uploaded a photo does not look like a real organisation.
    assert students.with_avatar < students.count


def test_bundle_stays_within_its_repo_budget():
    size = bundle_size_bytes()
    assert size <= MAX_BUNDLE_BYTES, f"bundle is {size / 1_048_576:.1f} MB"


# ---------------------------------------------------------------------------
# assignments
# ---------------------------------------------------------------------------

def test_assignment_tasks_carry_all_three_submission_templates(bundle):
    """Each persona picks one; a missing one renders as a blank grading card."""
    for course_key, sidecar in bundle.assignments.items():
        for task in sidecar["tasks"]:
            assert set(task["submissions"]) == {"correct", "partial", "incorrect"}, (
                f"{course_key}/{task['slug']} has the wrong template set"
            )


def test_task_grades_sum_to_one_hundred(bundle):
    """Percentage grading reads oddly when the parts do not total 100."""
    for course_key, sidecar in bundle.assignments.items():
        total = sum(task["max_grade_value"] for task in sidecar["tasks"])
        assert total == 100, f"{course_key} tasks total {total}, not 100"


def _score_template(task: dict, template: str):
    """Grade one authored submission template with the real graders.

    Dispatches on task type instead of only handling QUIZ. The earlier version
    of this helper skipped every non-quiz task, and that gap hid a real defect:
    all three SHORT_ANSWER keys used whole-string equality while their accepted
    answers were phrase fragments, so every "correct" template scored zero and
    the high-achieving personas were being graded as failures.

    Returns None for task types that are not auto-scored.
    """
    from src.services.courses.activities.assignments import (
        _check_number_answer,
        _check_short_answer,
        _grade_form_task,
        _grade_quiz_task,
    )

    contents = task["contents"]
    submission = task["submissions"][template]
    maximum = task["max_grade_value"]
    kind = task["type"]

    if kind == "QUIZ":
        return _grade_quiz_task(contents, submission, maximum)
    if kind == "FORM":
        return _grade_form_task(contents, submission, maximum)
    if kind == "SHORT_ANSWER":
        passed = _check_short_answer(
            submission.get("answer"),
            contents.get("correct_answers", []),
            contents.get("match_mode"),
        )
        return maximum if passed else 0
    if kind == "NUMBER_ANSWER":
        passed = _check_number_answer(
            submission.get("answer"),
            contents.get("correct_value"),
            contents.get("tolerance"),
        )
        return maximum if passed else 0
    # CODE needs Judge0 and FILE_SUBMISSION is graded by a human; neither is
    # auto-scored, so neither is asserted on.
    return None


def test_correct_templates_actually_score_full_marks(bundle):
    """The 'correct' template must be correct against the answer key.

    Without this, a persona meant to be a high achiever can be graded as
    failing — the demo's grade distribution would be wrong in a way that is
    invisible until someone opens a submission and checks it by hand.
    """
    checked = 0
    for course_key, sidecar in bundle.assignments.items():
        for task in sidecar["tasks"]:
            scored = _score_template(task, "correct")
            if scored is None:
                continue
            checked += 1
            max_grade = task["max_grade_value"]
            assert scored == max_grade, (
                f"{course_key}/{task['slug']} ({task['type']}): 'correct' "
                f"template scored {scored}/{max_grade}"
            )

    # Guard against the dispatch silently skipping everything — which is how an
    # earlier version of this test passed while three of the bundle's answer
    # keys were unmatchable.
    assert checked >= len(bundle.assignments), (
        f"only {checked} task(s) were actually graded; the type dispatch is "
        f"skipping tasks it should cover"
    )


def test_incorrect_templates_do_not_score_full_marks(bundle):
    for course_key, sidecar in bundle.assignments.items():
        for task in sidecar["tasks"]:
            scored = _score_template(task, "incorrect")
            if scored is None:
                continue
            max_grade = task["max_grade_value"]
            assert scored < max_grade, (
                f"{course_key}/{task['slug']} ({task['type']}): 'incorrect' "
                f"template scored full marks"
            )


def test_number_answer_templates_match_their_key(bundle):
    for course_key, sidecar in bundle.assignments.items():
        for task in sidecar["tasks"]:
            if task["type"] != "NUMBER_ANSWER":
                continue
            expected = task["contents"]["correct_value"]
            tolerance = task["contents"].get("tolerance", 0)
            given = task["submissions"]["correct"]["answer"]
            assert abs(given - expected) <= tolerance, (
                f"{course_key}/{task['slug']}: correct template answers {given}, "
                f"key is {expected}"
            )


# ---------------------------------------------------------------------------
# the content DSL
# ---------------------------------------------------------------------------

def test_compiled_content_is_a_valid_prosemirror_document(bundle):
    from src.routers.ai.courseplanning import validate_prosemirror_content

    for course in bundle.courses:
        for chapter in course.chapters:
            for activity in chapter.activities:
                if activity.kind == "video":
                    continue
                ok, reason = validate_prosemirror_content(activity.compiled_content())
                assert ok, f"{activity.slug}: {reason}"


def test_ids_are_stable_across_compilations():
    """The property the whole refresh design rests on.

    If compiling the same content twice produced different ids, every refresh
    would rewrite every activity in the database.
    """
    body = [
        "h2:A heading",
        "p:Some text.",
        {"quiz": {"q": "Is this stable?", "a": [["Yes", True], ["No", False]]}},
    ]
    assert compile_document(body) == compile_document(body)


def test_unknown_block_kinds_are_rejected():
    with pytest.raises(ContentError):
        compile_document([{"nonsense": "value"}])
    with pytest.raises(ContentError):
        compile_document(["h9:not a real heading level"])
    with pytest.raises(ContentError):
        compile_document(["no prefix at all"])


def test_quiz_without_a_correct_answer_is_rejected():
    with pytest.raises(ContentError):
        compile_document([{"quiz": {"q": "Unanswerable?", "a": [["No", False]]}}])


def test_loader_rejects_a_broken_bundle(tmp_path):
    """A malformed bundle must fail at load, before any row is written."""
    (tmp_path / "manifest.json").write_text(json.dumps({"bundle_version": "1.0.0"}))
    with pytest.raises(BundleError):
        load_bundle(str(tmp_path))


# ---------------------------------------------------------------------------
# what the validator refuses
#
# Each case mutates a copy of the real bundle in memory and re-runs the
# validator, so the test says what shape of authoring mistake is caught rather
# than asserting on a hand-built fixture that resembles nothing.
# ---------------------------------------------------------------------------

def _validated(bundle):
    from src.services.demo.bundle_loader import _validate

    _validate(bundle)


def test_a_course_in_an_unknown_section_is_rejected(bundle):
    broken = bundle.model_copy(
        update={
            "courses": [
                bundle.courses[0].model_copy(update={"section": "no-such-section"}),
                *bundle.courses[1:],
            ]
        }
    )
    with pytest.raises(BundleError, match="unknown section"):
        _validated(broken)


def test_a_duplicate_course_key_is_rejected(bundle):
    broken = bundle.model_copy(update={"courses": [bundle.courses[0], bundle.courses[0]]})
    with pytest.raises(BundleError, match="duplicate course keys"):
        _validated(broken)


def test_a_manifest_that_disagrees_with_the_course_files_is_rejected(bundle):
    """The manifest list is the catalogue order; a mismatch drops a course."""
    broken = bundle.model_copy(update={"courses": bundle.courses[:-1]})
    with pytest.raises(BundleError, match="does not match course files"):
        _validated(broken)


def test_a_course_with_no_chapters_is_rejected(bundle):
    broken = bundle.model_copy(
        update={
            "courses": [
                bundle.courses[0].model_copy(update={"chapters": []}),
                *bundle.courses[1:],
            ]
        }
    )
    with pytest.raises(BundleError, match="no chapters"):
        _validated(broken)


def test_a_chapter_with_no_activities_is_rejected(bundle):
    course = bundle.courses[0]
    broken_chapter = course.chapters[0].model_copy(update={"activities": []})
    broken = bundle.model_copy(
        update={
            "courses": [
                course.model_copy(
                    update={"chapters": [broken_chapter, *course.chapters[1:]]}
                ),
                *bundle.courses[1:],
            ]
        }
    )
    with pytest.raises(BundleError, match="no activities"):
        _validated(broken)


def test_a_duplicate_chapter_key_is_rejected(bundle):
    """Keys are the identity a refresh matches on, so they must be unique."""
    course = bundle.courses[0]
    duplicated = course.model_copy(
        update={"chapters": [course.chapters[0], course.chapters[0]]}
    )
    broken = bundle.model_copy(update={"courses": [duplicated, *bundle.courses[1:]]})
    with pytest.raises(BundleError, match="duplicate chapter key"):
        _validated(broken)


def test_a_missing_course_thumbnail_is_rejected(bundle):
    broken = bundle.model_copy(
        update={
            "courses": [
                bundle.courses[0].model_copy(update={"thumbnail": "not-a-file.webp"}),
                *bundle.courses[1:],
            ]
        }
    )
    with pytest.raises(BundleError, match="missing thumbnail"):
        _validated(broken)


def test_a_cohort_restricting_an_unknown_course_is_rejected(bundle):
    manifest = bundle.manifest
    cohort = manifest.cohorts[0].model_copy(
        update={"restricted_courses": ["no-such-course"]}
    )
    broken = bundle.model_copy(
        update={
            "manifest": manifest.model_copy(
                update={"cohorts": [cohort, *manifest.cohorts[1:]]}
            )
        }
    )
    with pytest.raises(BundleError, match="restricts unknown course"):
        _validated(broken)


def test_persona_weights_summing_to_zero_are_rejected(bundle):
    """A zero total makes the weighted draw undefined, not merely empty."""
    manifest = bundle.manifest
    flattened = [p.model_copy(update={"weight": 0}) for p in manifest.personas]
    broken = bundle.model_copy(
        update={"manifest": manifest.model_copy(update={"personas": flattened})}
    )
    with pytest.raises(BundleError, match="weights must sum"):
        _validated(broken)


def test_more_avatars_than_students_is_rejected(bundle):
    manifest = bundle.manifest
    students = manifest.students.model_copy(
        update={"with_avatar": manifest.students.count + 1}
    )
    broken = bundle.model_copy(
        update={"manifest": manifest.model_copy(update={"students": students})}
    )
    with pytest.raises(BundleError, match="with_avatar exceeds"):
        _validated(broken)


def test_an_assignment_sidecar_for_an_unknown_course_is_rejected(bundle):
    broken = bundle.model_copy(
        update={"assignments": {"no-such-course": {"activity_key": "x", "tasks": []}}}
    )
    with pytest.raises(BundleError, match="unknown course"):
        _validated(broken)


def test_an_assignment_sidecar_pointing_at_a_document_is_rejected(bundle):
    """It would produce an assignment nothing links to — invisible until opened."""
    course_key = next(iter(bundle.assignments))
    sidecar = dict(bundle.assignments[course_key])
    sidecar["activity_key"] = "definitely-not-an-assignment"
    broken = bundle.model_copy(update={"assignments": {course_key: sidecar}})
    with pytest.raises(BundleError, match="not an assignment activity"):
        _validated(broken)


def test_an_assignment_with_no_tasks_is_rejected(bundle):
    course_key = next(iter(bundle.assignments))
    sidecar = dict(bundle.assignments[course_key])
    sidecar["tasks"] = []
    broken = bundle.model_copy(update={"assignments": {course_key: sidecar}})
    with pytest.raises(BundleError, match="has no tasks"):
        _validated(broken)


def test_a_task_missing_a_submission_template_is_rejected(bundle):
    """Each persona picks one of correct/partial/incorrect.

    A missing one would silently give that persona an empty submission, which
    reads as a bug in the grading screen rather than in the bundle.
    """
    course_key = next(iter(bundle.assignments))
    sidecar = json.loads(json.dumps(bundle.assignments[course_key]))
    sidecar["tasks"][0]["submissions"].pop("partial", None)
    broken = bundle.model_copy(update={"assignments": {course_key: sidecar}})
    with pytest.raises(BundleError, match="partial"):
        _validated(broken)


# ---------------------------------------------------------------------------
# loader helpers
# ---------------------------------------------------------------------------

def test_bundle_keys_must_be_url_safe():
    """Keys are the identity a refresh matches on, and reach storage paths."""
    from src.services.demo.bundle_loader import _validate_key

    assert _validate_key("core-skills-01") == "core-skills-01"
    for bad in ("Core Skills", "core_skills", "core/skills", "", "Ćore"):
        with pytest.raises(ValueError, match="valid bundle key"):
            _validate_key(bad)


def test_activity_kinds_are_a_closed_set(bundle):
    """A typo would otherwise produce an activity the sync silently skips."""
    from src.services.demo.bundle_loader import ActivitySpec

    with pytest.raises(Exception, match="unknown activity kind"):
        ActivitySpec(slug="odd-kind", name="Odd", kind="vidéo", body=["p:hello"])


def test_course_by_key_names_the_key_it_could_not_find(bundle):
    with pytest.raises(BundleError, match="no course with key"):
        bundle.course_by_key("not-a-course")

    assert bundle.course_by_key(bundle.courses[0].slug) is bundle.courses[0]


def test_media_path_stays_inside_the_bundle(bundle):
    path = bundle.media_path("courses", "anything.webp")
    assert path.startswith(BUNDLE_ROOT)
    assert "media" in path


def test_a_missing_bundle_file_is_named(tmp_path):
    from src.services.demo.bundle_loader import _read_json

    with pytest.raises(BundleError, match="missing bundle file"):
        _read_json(str(tmp_path / "nope.json"))


def test_malformed_json_is_reported_with_its_path(tmp_path):
    from src.services.demo.bundle_loader import _read_json

    broken = tmp_path / "broken.json"
    broken.write_text("{not json at all")
    with pytest.raises(BundleError, match="not valid JSON"):
        _read_json(str(broken))


def test_the_bundle_is_cached_after_the_first_read():
    """It is immutable data on disk, read on every refresh tick."""
    from src.services.demo.bundle_loader import get_bundle

    assert get_bundle() is get_bundle()


# ---------------------------------------------------------------------------
# the content compiler
# ---------------------------------------------------------------------------

def test_a_video_activity_compiles_to_an_empty_document(bundle):
    """The player is driven by the activity's own fields, not by its body.

    So the document is deliberately empty — and must still be a valid one,
    since the editor loads it either way.
    """
    from src.services.demo.bundle_loader import ActivitySpec

    spec = ActivitySpec(
        slug="video-one", name="A video", kind="video", youtube_id="abc123", body=[]
    )
    compiled = spec.compiled_content()
    assert compiled == {"type": "doc", "content": []}


def test_word_count_ignores_markup(bundle):
    from src.services.demo.bundle_loader import ActivitySpec

    spec = ActivitySpec(
        slug="words-one", name="Some words", kind="document",
        body=["h2:A heading", "p:one two three four five"],
    )
    assert spec.word_count() >= 5


def test_every_block_kind_the_bundle_uses_compiles():
    """One case per kind, so a compiler change cannot silently drop one."""
    doc = compile_document(
        [
            "h2:Heading",
            "h3:Subheading",
            "p:A paragraph.",
            "info:Something worth noticing.",
            {"warn": "Something worth avoiding."},
            {"ul": ["first", "second"]},
            {"ol": ["step one", "step two"]},
            {"code": {"lang": "python", "text": "print('hi')"}},
            {"rule": True},
        ]
    )
    assert doc["type"] == "doc"
    assert doc["content"], "the compiler produced an empty document"


def test_the_same_block_compiles_identically_every_time():
    """Byte-identical output is what lets a refresh compare instead of rewrite."""
    block = [{"quiz": {"q": "Pick one", "a": [["right", True], ["wrong", False]]}}]
    assert compile_document(block) == compile_document(block)


# ---------------------------------------------------------------------------
# engagement, podcasts and the storefront
# ---------------------------------------------------------------------------

def _with_engagement(bundle, **updates):
    return bundle.model_copy(
        update={"engagement": bundle.engagement.model_copy(update=updates)}
    )


def _with_store(bundle, **updates):
    return bundle.model_copy(
        update={"store": bundle.store.model_copy(update=updates)}
    )


def test_content_authored_by_an_unknown_student_is_rejected(bundle):
    """A typo would surface as a post that silently never appears."""
    community = bundle.engagement.community
    discussion = community.discussions[0].model_copy(update={"author": "student-99"})
    broken = _with_engagement(
        bundle,
        community=community.model_copy(
            update={"discussions": [discussion, *community.discussions[1:]]}
        ),
    )
    with pytest.raises(BundleError, match="unknown student"):
        _validated(broken)


def test_a_duplicate_discussion_slug_is_rejected(bundle):
    community = bundle.engagement.community
    broken = _with_engagement(
        bundle,
        community=community.model_copy(
            update={"discussions": [community.discussions[0], community.discussions[0]]}
        ),
    )
    with pytest.raises(BundleError, match="duplicate discussion slug"):
        _validated(broken)


def test_a_playground_linking_an_unknown_course_is_rejected(bundle):
    playground = bundle.engagement.playgrounds[0].model_copy(
        update={"course": "no-such-course"}
    )
    broken = _with_engagement(
        bundle, playgrounds=[playground, *bundle.engagement.playgrounds[1:]]
    )
    with pytest.raises(BundleError, match="links unknown course"):
        _validated(broken)


def test_a_podcast_with_a_missing_cover_is_rejected(bundle):
    """A missing cover is a blank tile in the catalogue."""
    podcast = bundle.engagement.podcasts[0].model_copy(update={"cover": "gone.webp"})
    broken = _with_engagement(
        bundle, podcasts=[podcast, *bundle.engagement.podcasts[1:]]
    )
    with pytest.raises(BundleError, match="missing cover"):
        _validated(broken)


def test_a_podcast_with_no_episodes_is_rejected(bundle):
    podcast = bundle.engagement.podcasts[0].model_copy(update={"episodes": []})
    broken = _with_engagement(
        bundle, podcasts=[podcast, *bundle.engagement.podcasts[1:]]
    )
    with pytest.raises(BundleError, match="no episodes"):
        _validated(broken)


def test_an_episode_with_missing_audio_is_rejected(bundle):
    """A missing audio file is a player that spins forever."""
    podcast = bundle.engagement.podcasts[0]
    episode = podcast.episodes[0].model_copy(update={"audio": "silence.mp3"})
    broken = _with_engagement(
        bundle,
        podcasts=[
            podcast.model_copy(update={"episodes": [episode, *podcast.episodes[1:]]}),
            *bundle.engagement.podcasts[1:],
        ],
    )
    with pytest.raises(BundleError, match="missing audio"):
        _validated(broken)


def test_a_store_group_listing_an_unknown_course_is_rejected(bundle):
    if not bundle.store.groups:
        pytest.skip("the bundle ships no store groups")
    group = bundle.store.groups[0].model_copy(update={"courses": ["no-such-course"]})
    broken = _with_store(bundle, groups=[group, *bundle.store.groups[1:]])
    with pytest.raises(BundleError, match="unknown course"):
        _validated(broken)


def test_an_offer_must_sell_exactly_one_thing(bundle):
    """Both or neither leaves the storefront selling nothing."""
    offer = bundle.store.offers[0]
    both = offer.model_copy(
        update={"course": bundle.courses[0].slug, "group": bundle.store.groups[0].slug}
    )
    with pytest.raises(BundleError, match="exactly one"):
        _validated(_with_store(bundle, offers=[both, *bundle.store.offers[1:]]))

    neither = offer.model_copy(update={"course": None, "group": None})
    with pytest.raises(BundleError, match="exactly one"):
        _validated(_with_store(bundle, offers=[neither, *bundle.store.offers[1:]]))


def test_an_enrolment_in_an_unknown_offer_is_rejected(bundle):
    if not bundle.store.enrollments:
        pytest.skip("the bundle ships no enrolments")
    enrolment = bundle.store.enrollments[0].model_copy(update={"offer": "no-such-offer"})
    broken = _with_store(
        bundle, enrollments=[enrolment, *bundle.store.enrollments[1:]]
    )
    with pytest.raises(BundleError, match="unknown offer"):
        _validated(broken)


def test_an_assignment_activity_with_no_sidecar_is_rejected(bundle):
    """The activity would render as an assignment with no questions."""
    broken = bundle.model_copy(update={"assignments": {}})
    with pytest.raises(BundleError, match="no sidecar"):
        _validated(broken)


# ---------------------------------------------------------------------------
# the loader's own error wrapping
# ---------------------------------------------------------------------------

def test_a_broken_course_file_names_the_course(tmp_path):
    """The message has to say which file, or the bundle is a haystack."""
    import shutil

    from src.services.demo.bundle_loader import load_bundle

    shutil.copytree(BUNDLE_ROOT, tmp_path / "bundle")
    root = tmp_path / "bundle"
    course_key = json.loads((root / "manifest.json").read_text())["courses"][0]
    (root / "courses" / f"{course_key}.json").write_text(json.dumps({"slug": course_key}))

    with pytest.raises(BundleError, match=f"courses/{course_key}.json is invalid"):
        load_bundle(str(root))


def test_broken_engagement_and_store_files_are_named(tmp_path):
    import shutil

    from src.services.demo.bundle_loader import load_bundle

    shutil.copytree(BUNDLE_ROOT, tmp_path / "bundle")
    root = tmp_path / "bundle"
    (root / "engagement.json").write_text(json.dumps({"podcasts": "not a list"}))

    with pytest.raises(BundleError, match="engagement.json is invalid"):
        load_bundle(str(root))

    (root / "engagement.json").write_text(
        (pathlib.Path(BUNDLE_ROOT) / "engagement.json").read_text()
    )
    (root / "store.json").write_text(json.dumps({"offers": "not a list"}))

    with pytest.raises(BundleError, match="store.json is invalid"):
        load_bundle(str(root))


def test_a_quiz_without_a_question_is_rejected():
    with pytest.raises(ContentError, match="needs a 'q'"):
        compile_document([{"quiz": {"a": [["yes", True]]}}])


def test_a_block_must_be_a_string_or_a_single_key_object():
    """Two keys is ambiguous: there is no ordering between them."""
    for bad in ([1, 2], {"p": "one", "h2": "two"}, {}):
        with pytest.raises(ContentError, match="single-key object"):
            compile_document([bad])


def test_headings_and_code_can_be_written_in_object_form():
    """Both spellings exist so long text can avoid colon-escaping."""
    doc = compile_document(
        [{"h2": "A heading"}, {"code": {"lang": "python", "text": "x = 1"}}]
    )
    heading = doc["content"][0]
    assert heading["type"] == "heading"
    assert heading["attrs"] == {"level": 2}


def test_word_count_includes_code_blocks(bundle):
    """Code counts as content — an activity that is only code is not blank."""
    from src.services.demo.bundle_loader import ActivitySpec

    spec = ActivitySpec(
        slug="code-only", name="Code only", kind="document",
        body=[{"code": {"lang": "python", "text": "one two three four five six"}}],
    )
    assert spec.word_count() >= 6


def test_duplicate_section_keys_are_rejected(bundle):
    """Sections are matched by key, so two of one would fight each refresh."""
    manifest = bundle.manifest
    broken = bundle.model_copy(
        update={
            "manifest": manifest.model_copy(
                update={"sections": [manifest.sections[0], manifest.sections[0]]}
            )
        }
    )
    with pytest.raises(BundleError, match="duplicate section keys"):
        _validated(broken)


def test_a_duplicate_activity_key_anywhere_is_rejected(bundle):
    """Activity keys are global, not per chapter — the registry matches on them."""
    course = bundle.courses[0]
    chapter = course.chapters[0]
    activity = chapter.activities[0]
    broken_chapter = chapter.model_copy(update={"activities": [activity, activity]})
    broken = bundle.model_copy(
        update={
            "courses": [
                course.model_copy(
                    update={"chapters": [broken_chapter, *course.chapters[1:]]}
                ),
                *bundle.courses[1:],
            ]
        }
    )
    with pytest.raises(BundleError, match="duplicate activity key"):
        _validated(broken)


def test_an_activity_whose_content_will_not_compile_is_rejected(bundle):
    """Caught at load rather than as a blank page mid-demonstration."""
    from src.services.demo.bundle_loader import ActivitySpec

    course = bundle.courses[0]
    chapter = course.chapters[0]
    bad = ActivitySpec(
        slug="broken-content", name="Broken", kind="document",
        body=[{"nonsense": "there is no such block"}],
    )
    broken = bundle.model_copy(
        update={
            "courses": [
                course.model_copy(
                    update={
                        "chapters": [
                            chapter.model_copy(update={"activities": [bad]}),
                            *course.chapters[1:],
                        ]
                    }
                ),
                *bundle.courses[1:],
            ]
        }
    )
    with pytest.raises(BundleError, match="invalid content"):
        _validated(broken)


def test_a_video_activity_without_a_youtube_id_is_rejected(bundle):
    from src.services.demo.bundle_loader import ActivitySpec

    course = bundle.courses[0]
    chapter = course.chapters[0]
    bad = ActivitySpec(slug="silent-video", name="Silent", kind="video", body=[])
    broken = bundle.model_copy(
        update={
            "courses": [
                course.model_copy(
                    update={
                        "chapters": [
                            chapter.model_copy(update={"activities": [bad]}),
                            *course.chapters[1:],
                        ]
                    }
                ),
                *bundle.courses[1:],
            ]
        }
    )
    with pytest.raises(BundleError, match="no youtube_id"):
        _validated(broken)


def test_a_nearly_empty_document_is_rejected(bundle):
    """A prospect clicking into a blank page during a sales call."""
    from src.services.demo.bundle_loader import ActivitySpec

    course = bundle.courses[0]
    chapter = course.chapters[0]
    bad = ActivitySpec(
        slug="almost-empty", name="Almost empty", kind="document",
        body=["p:Three words only"],
    )
    broken = bundle.model_copy(
        update={
            "courses": [
                course.model_copy(
                    update={
                        "chapters": [
                            chapter.model_copy(update={"activities": [bad]}),
                            *course.chapters[1:],
                        ]
                    }
                ),
                *bundle.courses[1:],
            ]
        }
    )
    with pytest.raises(BundleError, match="almost no content"):
        _validated(broken)


def test_a_task_with_a_missing_or_duplicated_key_is_rejected(bundle):
    course_key = next(iter(bundle.assignments))
    sidecar = json.loads(json.dumps(bundle.assignments[course_key]))

    duplicated = dict(sidecar)
    duplicated["tasks"] = [sidecar["tasks"][0], sidecar["tasks"][0]]
    with pytest.raises(BundleError, match="duplicate or missing task key"):
        _validated(bundle.model_copy(update={"assignments": {course_key: duplicated}}))

    keyless = json.loads(json.dumps(sidecar))
    keyless["tasks"][0].pop("slug", None)
    with pytest.raises(BundleError, match="duplicate or missing task key"):
        _validated(bundle.model_copy(update={"assignments": {course_key: keyless}}))


def test_a_duplicate_episode_slug_is_rejected(bundle):
    podcast = bundle.engagement.podcasts[0]
    broken = _with_engagement(
        bundle,
        podcasts=[
            podcast.model_copy(
                update={"episodes": [podcast.episodes[0], podcast.episodes[0]]}
            ),
            *bundle.engagement.podcasts[1:],
        ],
    )
    with pytest.raises(BundleError, match="duplicate episode slug"):
        _validated(broken)


def test_an_offer_selling_an_unknown_course_or_group_is_rejected(bundle):
    offer = bundle.store.offers[0]

    bad_course = offer.model_copy(update={"course": "no-such-course", "group": None})
    with pytest.raises(BundleError, match="sells unknown course"):
        _validated(_with_store(bundle, offers=[bad_course, *bundle.store.offers[1:]]))

    bad_group = offer.model_copy(update={"course": None, "group": "no-such-group"})
    with pytest.raises(BundleError, match="sells unknown group"):
        _validated(_with_store(bundle, offers=[bad_group, *bundle.store.offers[1:]]))


def test_an_enrolment_by_an_unknown_student_is_rejected(bundle):
    if not bundle.store.enrollments:
        pytest.skip("the bundle ships no enrolments")
    enrolment = bundle.store.enrollments[0].model_copy(update={"student": "student-99"})
    broken = _with_store(
        bundle, enrollments=[enrolment, *bundle.store.enrollments[1:]]
    )
    with pytest.raises(BundleError, match="unknown student"):
        _validated(broken)


def test_an_oversized_bundle_is_rejected(bundle, monkeypatch):
    """The budget exists because every byte ships in the image."""
    from src.services.demo import bundle_loader

    monkeypatch.setattr(bundle_loader, "MAX_BUNDLE_BYTES", 1)
    with pytest.raises(BundleError, match="over the"):
        _validated(bundle)


def test_non_json_files_beside_the_assignments_are_ignored(tmp_path):
    """Authors leave notes and editor droppings in there."""
    import shutil

    from src.services.demo.bundle_loader import load_bundle

    shutil.copytree(BUNDLE_ROOT, tmp_path / "bundle")
    root = tmp_path / "bundle"
    (root / "assignments" / "NOTES.md").write_text("a note to self")
    (root / "assignments" / ".DS_Store").write_bytes(b"\x00")

    load_bundle(str(root))  # must not raise
