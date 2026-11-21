"""Public SEO/GEO data (src/services/seo/public.py), IndexNow
(src/services/seo/indexnow.py), the new org SEO settings and their endpoints.

The recurring assertion: nothing private (members-only community, private or
draft course, unpublished or members-only lesson, sold community/podcast
content) ever reaches a thread lookup, feed, llms.txt, Markdown or sitemap
payload, not even its title.
"""

import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlmodel import select

from src.db.communities.communities import Community
from src.db.communities.discussion_comments import DiscussionComment
from src.db.communities.discussions import Discussion
from src.db.courses.activities import Activity, ActivityLockType, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.course_updates import CourseUpdate
from src.db.courses.courses import Course
from src.db.folders.folders import Folder
from src.db.landing_pages import LandingPage
from src.db.organization_config import OrganizationConfig, SeoOrgConfig
from src.db.paths import Path, PathCourse
from src.db.podcasts.episodes import PodcastEpisode
from src.db.podcasts.podcasts import Podcast
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.users import AnonymousUser, User
from src.routers import seo as seo_router
from src.services.seo import indexnow
from src.services.seo import public
from src.services.seo import seo as seo_service

NOW = str(datetime.now())
OLD = str(datetime.now() - timedelta(days=400))
SECRET = "Secret-Title-Never-Public"


async def _add(db, *rows):
    for row in rows:
        db.add(row)
    await db.commit()
    for row in rows:
        await db.refresh(row)
    return rows[0] if len(rows) == 1 else rows


async def _seo(db, org, **seo):
    row = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org.id))).scalars().first()
    if row:
        row.config = {"customization": {"seo": seo}}
        await _add(db, row)
    else:
        await _add(db, OrganizationConfig(org_id=org.id, config={"customization": {"seo": seo}}, creation_date=NOW, update_date=NOW))


def _course(org, name="Intro to Python", uuid="course_c1", **kw):
    data = dict(name=name, public=True, published=True, open_to_contributors=False, org_id=org.id,
                course_uuid=uuid, creation_date=NOW, update_date=NOW, description="Learn Python")
    data.update(kw)
    return Course(**data)


def _activity(org, course, uuid, name, **kw):
    data = dict(name=name, activity_type=ActivityTypeEnum.TYPE_DYNAMIC, activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                published=True, org_id=org.id, course_id=course.id, activity_uuid=uuid, creation_date=NOW, update_date=NOW,
                content={"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": f"Body of {name}"}]}]})
    data.update(kw)
    return Activity(**data)


async def _user(db, uid=50, first="Maya", last="Okafor"):
    return await _add(db, User(id=uid, username=f"user{uid}", first_name=first, last_name=last, email=f"u{uid}@x.io", user_uuid=f"user_{uid}"))


async def _forum(db, org):
    """A public community with an answered question, a thin old thread, a
    members-only community and its secret thread."""
    author = await _user(db)
    club = await _add(db, Community(name="Club", org_id=org.id, community_uuid="community_club", public=True, slug="club",
                                    description="Talk shop", creation_date=NOW, update_date=NOW))
    private = await _add(db, Community(name="Staff", org_id=org.id, community_uuid="community_staff", public=False, slug="staff",
                                       creation_date=NOW, update_date=NOW))
    question = await _add(db, Discussion(title="How do payouts work?", content='{"type":"doc","content":[]}', label="question",
                                         community_id=club.id, org_id=org.id, author_id=author.id, discussion_uuid="discussion_q1",
                                         upvote_count=4, creation_date=NOW, update_date=NOW))
    thin = await _add(db, Discussion(title="Anyone?", community_id=club.id, org_id=org.id, author_id=author.id,
                                     discussion_uuid="discussion_thin", creation_date=OLD, update_date=OLD))
    secret = await _add(db, Discussion(title=SECRET, community_id=private.id, org_id=org.id, author_id=author.id,
                                       discussion_uuid="discussion_secret", creation_date=NOW, update_date=NOW))
    answer = await _add(db, DiscussionComment(content="About two days", discussion_id=question.id, author_id=author.id,
                                              comment_uuid="comment_a", upvote_count=2, creation_date=NOW, update_date=NOW))
    await _add(db, DiscussionComment(content="Same here", discussion_id=question.id, author_id=author.id,
                                     comment_uuid="comment_b", creation_date=NOW, update_date=NOW))
    question.answer_comment_id = answer.id
    await _add(db, question)
    return SimpleNamespace(club=club, private=private, question=question, thin=thin, secret=secret, answer=answer, author=author)


def _locked(*uuids):
    """Patch the paywall check: these resources are sold (anonymous gets 402)."""
    async def fake(request, db, user, uuid):
        return uuid in uuids
    return patch("src.services.seo.public.is_ee_resource_locked", side_effect=fake)


def _dump(payload) -> str:
    return json.dumps(payload, default=str)


# ─── helpers ────────────────────────────────────────────────────────────────


def test_feature_indexable_and_thin_rule():
    assert public.feature_indexable({}, "courses") is True
    assert public.feature_indexable({"indexable_features": {"courses": False}}, "courses") is False
    assert public.feature_indexable({"indexing_disabled": True}, "courses") is False
    assert public.feature_indexable({"noindex_communities": True}, "communities") is False
    assert public.feature_indexable({}, "discussions") is True

    assert public.is_thin_thread({}, 0, OLD) is True
    assert public.is_thin_thread({}, 1, OLD) is False
    assert public.is_thin_thread({}, 0, NOW) is False
    assert public.is_thin_thread({"thin_thread_noindex_days": 0}, 0, OLD) is False
    assert public.is_thin_thread({"thin_thread_noindex_days": "bad"}, 0, OLD) is True
    assert public.is_thin_thread({}, 0, "") is False
    assert public.is_thin_thread({}, 0, "not a date") is False
    assert public._parse_date("2026-11-05T01:00:00Z").tzinfo is not None


def test_author_name_fallbacks():
    assert public._author_name(None) == ""
    assert public._author_name(SimpleNamespace(first_name="", last_name="", username="neo")) == "neo"


async def test_anon_locked_treats_errors_as_locked(db, mock_request):
    with patch("src.services.seo.public.is_ee_resource_locked", AsyncMock(side_effect=HTTPException(status_code=403))):
        assert await public._anon_locked(mock_request, db, "x") is True


# ─── threads ────────────────────────────────────────────────────────────────


async def test_thread_lookup_public_thread(db, org, mock_request):
    f = await _forum(db, org)
    info = await public.thread_lookup(mock_request, db, AnonymousUser(), org.slug, "club", f"{f.question.id}-old-slug")
    assert info["segment"] == f"{f.question.id}-how-do-payouts-work"
    assert info["community_key"] == "club" and info["community_name"] == "Club"
    assert info["indexable"] is True and info["reply_count"] == 2 and info["answered"] is True
    # Legacy uuid references resolve to the same thread.
    by_uuid = await public.thread_lookup(mock_request, db, AnonymousUser(), org.slug, "club", "q1")
    assert by_uuid["id"] == f.question.id


async def test_thread_lookup_never_reveals_private_threads(db, org, mock_request):
    f = await _forum(db, org)
    for ref in (str(f.secret.id), "secret", f"{f.secret.id}-x"):
        with pytest.raises(HTTPException) as exc:
            await public.thread_lookup(mock_request, db, AnonymousUser(), org.slug, "staff", ref)
        assert exc.value.status_code == 404
    # A thread id from another community isn't found through this one either.
    with pytest.raises(HTTPException):
        await public.thread_lookup(mock_request, db, AnonymousUser(), org.slug, "club", str(f.secret.id))
    with pytest.raises(HTTPException):
        await public.thread_lookup(mock_request, db, AnonymousUser(), org.slug, "nope", "1")


async def test_thread_lookup_sold_community_returns_no_thread_facts(db, org, mock_request):
    f = await _forum(db, org)
    with _locked("community_club"):
        info = await public.thread_lookup(mock_request, db, AnonymousUser(), org.slug, "club", str(f.question.id))
    assert info == {"locked": True, "restricted": False, "indexable": False, "community_uuid": "community_club", "community_key": "club"}
    with patch("src.services.seo.public.is_ee_resource_locked", AsyncMock(side_effect=HTTPException(status_code=500))):
        info = await public.thread_lookup(mock_request, db, AnonymousUser(), org.slug, "club", str(f.question.id))
    assert info["locked"] is True and "title" not in info


async def test_thread_lookup_indexable_switches(db, org, mock_request):
    f = await _forum(db, org)
    thin = await public.thread_lookup(mock_request, db, AnonymousUser(), org.slug, "club", str(f.thin.id))
    assert thin["indexable"] is False
    await _seo(db, org, noindex_communities=True)
    info = await public.thread_lookup(mock_request, db, AnonymousUser(), org.slug, "club", str(f.question.id))
    assert info["indexable"] is False
    await _seo(db, org)
    f.club.seo = {"robots_noindex": True}
    await _add(db, f.club)
    info = await public.thread_lookup(mock_request, db, AnonymousUser(), org.slug, "club", str(f.question.id))
    assert info["indexable"] is False


async def test_thread_lookup_signed_in_reader_of_private_community(db, org, mock_request):
    f = await _forum(db, org)
    with patch("src.services.seo.seo._can_read", AsyncMock(return_value=True)):
        info = await public.thread_lookup(mock_request, db, AnonymousUser(), org.slug, "staff", str(f.secret.id))
    assert info["title"] == SECRET and info["indexable"] is False


async def test_thread_jsonld_data(db, org, mock_request):
    f = await _forum(db, org)
    data = await public.thread_jsonld_data(mock_request, db, org.slug, "club", str(f.question.id))
    assert data["author"] == "Maya Okafor" and data["author_username"] == "user50"
    assert {c["content"] for c in data["comments"]} == {"About two days", "Same here"}
    assert [c["accepted"] for c in data["comments"] if c["content"] == "About two days"] == [True]
    for ref in (str(f.thin.id),):
        with pytest.raises(HTTPException):
            await public.thread_jsonld_data(mock_request, db, org.slug, "club", ref)
    with pytest.raises(HTTPException):
        await public.thread_jsonld_data(mock_request, db, org.slug, "staff", str(f.secret.id))
    with _locked("community_club"), pytest.raises(HTTPException):
        await public.thread_jsonld_data(mock_request, db, org.slug, "club", str(f.question.id))


async def test_thread_jsonld_includes_accepted_answer_outside_top_replies(db, org, mock_request):
    f = await _forum(db, org)
    for i in range(public.TOP_COMMENTS + 2):
        await _add(db, DiscussionComment(content=f"popular {i}", discussion_id=f.question.id, author_id=f.author.id,
                                         comment_uuid=f"comment_p{i}", upvote_count=100 + i, creation_date=NOW, update_date=NOW))
    data = await public.thread_jsonld_data(mock_request, db, org.slug, "club", str(f.question.id))
    assert len(data["comments"]) == public.TOP_COMMENTS + 1
    assert data["comments"][-1]["accepted"] is True


# ─── feeds ──────────────────────────────────────────────────────────────────


async def _catalog(db, org):
    author = await _user(db, 60, "Ada", "Lovelace")
    course = await _add(db, _course(org, tags="python, data", thumbnail_image="t.png"))
    await _add(db, ResourceAuthor(resource_uuid=course.course_uuid, user_id=author.id, authorship=ResourceAuthorshipEnum.CREATOR,
                                  authorship_status=ResourceAuthorshipStatusEnum.ACTIVE, creation_date=NOW, update_date=NOW))
    await _add(db, _course(org, name=SECRET, uuid="course_private", public=False))
    await _add(db, _course(org, name=f"{SECRET} draft", uuid="course_draft", published=False))
    await _add(db, _course(org, name=f"{SECRET} noindex", uuid="course_noindex", seo={"robots_noindex": True}))
    path = await _add(db, Path(name="Data path", org_id=org.id, path_uuid="path_1", public=True, published=True, creation_date=OLD, description="Steps"))
    await _add(db, Path(name=f"{SECRET} path", org_id=org.id, path_uuid="path_2", public=False, published=True))
    await _add(db, PathCourse(path_id=path.id, course_id=course.id, position=0, required=True))
    pod = await _add(db, Podcast(name="Pod", org_id=org.id, podcast_uuid="podcast_1", public=True, published=True, creation_date=NOW, description="Audio"))
    await _add(db, Podcast(name=f"{SECRET} pod", org_id=org.id, podcast_uuid="podcast_2", public=False, published=True))
    await _add(
        db,
        PodcastEpisode(title="Ep 1", podcast_id=pod.id, org_id=org.id, episode_uuid="episode_1", published=True, audio_file="a.mp3",
                       episode_number=1, duration_seconds=90, creation_date=NOW),
        PodcastEpisode(title=f"{SECRET} ep", podcast_id=pod.id, org_id=org.id, episode_uuid="episode_2", published=False, audio_file="b.mp3"),
    )
    chapter = await _add(db, Chapter(name="Basics", org_id=org.id, course_id=course.id, chapter_uuid="chapter_1"))
    await _add(db, CourseChapter(order=0, course_id=course.id, chapter_id=chapter.id, org_id=org.id, creation_date=NOW, update_date=NOW))
    acts = [
        _activity(org, course, "activity_open", "Open lesson"),
        _activity(org, course, "activity_draft", f"{SECRET} draft lesson", published=False),
        _activity(org, course, "activity_members", f"{SECRET} members lesson", lock_type=ActivityLockType.AUTHENTICATED),
        _activity(org, course, "activity_video", "Video lesson", activity_type=ActivityTypeEnum.TYPE_VIDEO,
                  activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED),
    ]
    await _add(db, *acts)
    for i, a in enumerate(acts):
        await _add(db, ChapterActivity(order=i, chapter_id=chapter.id, activity_id=a.id, course_id=course.id, org_id=org.id,
                                       creation_date=NOW, update_date=NOW))
    await _add(db, CourseUpdate(title="New module", content="Out now", course_id=course.id, org_id=org.id,
                                courseupdate_uuid="courseupdate_1", creation_date=NOW, update_date=NOW))
    await _add(db, Folder(name="Shelf", org_id=org.id, folder_uuid="folder_1", public=True, description="Books"))
    await _add(db, Folder(name=f"{SECRET} shelf", org_id=org.id, folder_uuid="folder_2", public=False))
    return SimpleNamespace(course=course, path=path, pod=pod)


async def test_feed_org_lists_only_public_content(db, org, mock_request):
    await _catalog(db, org)
    data = await public.feed_data(mock_request, db, org.slug, "org")
    names = [i["name"] for i in data["items"]]
    assert set(names) == {"Intro to Python", "Data path", "Pod"}
    assert names[-1] == "Data path"  # oldest last
    course = next(i for i in data["items"] if i["type"] == "course")
    assert course["authors"] == ["Ada Lovelace"] and course["image"] == "t.png"
    assert SECRET not in _dump(data)
    courses = await public.feed_data(mock_request, db, org.slug, "courses")
    assert [i["name"] for i in courses["items"]] == ["Intro to Python"]
    await _seo(db, org, indexable_features={"paths": False, "podcasts": False})
    data = await public.feed_data(mock_request, db, org.slug, "org")
    assert [i["name"] for i in data["items"]] == ["Intro to Python"]


async def test_feed_switches(db, org, mock_request):
    await _catalog(db, org)
    with pytest.raises(HTTPException):
        await public.feed_data(mock_request, db, org.slug, "nope")
    await _seo(db, org, feeds_enabled=False)
    with pytest.raises(HTTPException):
        await public.feed_data(mock_request, db, org.slug, "org")
    # Podcast feeds are distribution: still on.
    assert (await public.feed_data(mock_request, db, org.slug, "podcast", "pod"))["resource"]["name"] == "Pod"
    await _seo(db, org, indexing_disabled=True)
    with pytest.raises(HTTPException):
        await public.feed_data(mock_request, db, org.slug, "courses")


async def test_feed_podcast_and_course_updates(db, org, mock_request, tmp_path, monkeypatch):
    await _catalog(db, org)
    data = await public.feed_data(mock_request, db, org.slug, "podcast", "pod")
    assert [e["title"] for e in data["items"]] == ["Ep 1"]
    assert data["items"][0]["audio"] == "a.mp3" and data["items"][0]["duration_seconds"] == 90
    with _locked("podcast_1"):
        data = await public.feed_data(mock_request, db, org.slug, "podcast", "pod")
    assert data["items"][0]["audio"] == "" and data["items"][0]["audio_length"] == 0
    with pytest.raises(HTTPException):
        await public.feed_data(mock_request, db, org.slug, "podcast", "podcast-2")
    updates = await public.feed_data(mock_request, db, org.slug, "course_updates", "intro-to-python")
    assert updates["items"][0]["title"] == "New module"
    with pytest.raises(HTTPException):
        await public.feed_data(mock_request, db, org.slug, "course_updates", "course_private")


async def test_feed_communities_and_community(db, org, mock_request):
    f = await _forum(db, org)
    data = await public.feed_data(mock_request, db, org.slug, "communities")
    assert [t["title"] for t in data["items"]] == ["How do payouts work?"]  # thin and private left out
    assert data["items"][0]["segment"] == f"{f.question.id}-how-do-payouts-work"
    assert SECRET not in _dump(data)
    top = await public.feed_data(mock_request, db, org.slug, "community", "club", sort="top", label="question")
    assert top["sort"] == "top" and top["resource"]["name"] == "Club" and len(top["items"]) == 1
    for key in ("staff", "missing"):
        with pytest.raises(HTTPException):
            await public.feed_data(mock_request, db, org.slug, "community", key)
    with _locked("community_club"):
        assert (await public.feed_data(mock_request, db, org.slug, "communities"))["items"] == []
        with pytest.raises(HTTPException):
            await public.feed_data(mock_request, db, org.slug, "community", "club")


async def test_threads_limit_and_include_thin(db, org):
    f = await _forum(db, org)
    rows = await public._threads(db, {}, [f.club], limit=1, include_thin=True)
    assert len(rows) == 1
    assert await public._threads(db, {}, []) == []


# ─── llms.txt data ──────────────────────────────────────────────────────────


async def test_llms_data_summary_and_full(db, org, mock_request):
    await _catalog(db, org)
    await _forum(db, org)
    short = await public.llms_data(mock_request, db, org.slug)
    assert [c["name"] for c in short["courses"]] == ["Intro to Python"] and "outline" not in short["courses"][0]
    assert [p["name"] for p in short["paths"]] == ["Data path"]
    assert [p["name"] for p in short["podcasts"]] == ["Pod"]
    assert [c["name"] for c in short["communities"]] == ["Club"]
    assert [f["name"] for f in short["folders"]] == ["Shelf"]
    full = await public.llms_data(mock_request, db, org.slug, full=True)
    outline = full["courses"][0]["outline"]
    # Only lessons anyone can open; drafts and members-only lessons aren't even named.
    assert [a["name"] for a in outline] == ["Open lesson", "Video lesson"]
    assert full["paths"][0]["courses"][0]["name"] == "Intro to Python"
    assert full["podcasts"][0]["episodes"][0]["title"] == "Ep 1"
    assert full["communities"][0]["threads"][0]["answered"] is True
    assert SECRET not in _dump(full)


async def test_llms_data_respects_policy_and_features(db, org, mock_request):
    await _catalog(db, org)
    await _seo(db, org, indexable_features={"activities": False, "paths": False, "podcasts": False, "library": False})
    full = await public.llms_data(mock_request, db, org.slug, full=True)
    assert full["courses"][0]["outline"] == [] and full["paths"] == [] and full["podcasts"] == [] and full["folders"] == []
    for seo in ({"ai_crawler_policy": "block_all"}, {"llms_txt_enabled": False}, {"indexing_disabled": True}):
        await _seo(db, org, **seo)
        with pytest.raises(HTTPException):
            await public.llms_data(mock_request, db, org.slug)


async def test_sold_course_has_no_public_lessons(db, org, mock_request):
    await _catalog(db, org)
    with _locked("course_c1"):
        full = await public.llms_data(mock_request, db, org.slug, full=True)
    assert full["courses"][0]["outline"] == []
    open_id = (await db.execute(select(Activity).where(Activity.activity_uuid == "activity_open"))).scalars().first().id
    with patch("src.services.seo.public.get_ee_paid_locked_activity_ids", AsyncMock(return_value={open_id})):
        full = await public.llms_data(mock_request, db, org.slug, full=True)
    assert [a["name"] for a in full["courses"][0]["outline"]] == ["Video lesson"]


# ─── Markdown alternates ────────────────────────────────────────────────────


async def test_markdown_course_activity_path_podcast(db, org, mock_request):
    await _catalog(db, org)
    course = await public.markdown_data(mock_request, db, org.slug, "course", "intro-to-python")
    assert course["course"]["name"] == "Intro to Python" and len(course["course"]["outline"]) == 2
    lesson = await public.markdown_data(mock_request, db, org.slug, "activity", "intro-to-python", "activity_open")
    assert lesson["activity"]["content"]["type"] == "doc"
    video = await public.markdown_data(mock_request, db, org.slug, "activity", "intro-to-python", "video")
    assert video["activity"]["content"] is None
    for sub in ("draft", "members", "nope"):
        with pytest.raises(HTTPException):
            await public.markdown_data(mock_request, db, org.slug, "activity", "intro-to-python", sub)
    path = await public.markdown_data(mock_request, db, org.slug, "path", "data-path")
    assert path["path"]["courses"][0]["name"] == "Intro to Python"
    pod = await public.markdown_data(mock_request, db, org.slug, "podcast", "pod")
    assert pod["podcast"]["episodes"][0]["title"] == "Ep 1"
    for rtype, key in (("course", "course_private"), ("path", "path_2"), ("podcast", "podcast_2"), ("nope", "x")):
        with pytest.raises(HTTPException):
            await public.markdown_data(mock_request, db, org.slug, rtype, key)
    await _seo(db, org, indexable_features={"activities": False})
    assert (await public.markdown_data(mock_request, db, org.slug, "course", "intro-to-python"))["course"]["outline"] == []
    await _seo(db, org, ai_crawler_policy="block_all")
    with pytest.raises(HTTPException):
        await public.markdown_data(mock_request, db, org.slug, "course", "intro-to-python")


async def test_markdown_community_and_thread(db, org, mock_request):
    f = await _forum(db, org)
    community = await public.markdown_data(mock_request, db, org.slug, "community", "club")
    assert [t["title"] for t in community["threads"]] == ["How do payouts work?"]
    thread = await public.markdown_data(mock_request, db, org.slug, "thread", "club", f"{f.question.id}-x")
    assert thread["thread"]["author"] == "Maya Okafor"
    assert [c["accepted"] for c in thread["thread"]["comments"]] == [True, False]
    for sub in (str(f.thin.id), "abc", "9" * 20, "999"):
        with pytest.raises(HTTPException):
            await public.markdown_data(mock_request, db, org.slug, "thread", "club", sub)
    with pytest.raises(HTTPException):
        await public.markdown_data(mock_request, db, org.slug, "thread", "staff", str(f.secret.id))
    with _locked("community_club"), pytest.raises(HTTPException):
        await public.markdown_data(mock_request, db, org.slug, "community", "club")


# ─── enclosure sizes ────────────────────────────────────────────────────────


async def test_content_size_filesystem_and_s3(monkeypatch, tmp_path):
    public._size_cache.clear()
    monkeypatch.chdir(tmp_path)
    audio = tmp_path / "content" / "orgs" / "org_x" / "pods" / "a.mp3"
    audio.parent.mkdir(parents=True)
    audio.write_bytes(b"x" * 1234)
    assert await public._content_size("org_x", "pods", "a.mp3") == 1234
    assert await public._content_size("org_x", "pods", "a.mp3") == 1234  # cached
    assert await public._content_size("org_x", "pods", "missing.mp3") == 0
    assert await public._content_size("org_x", "pods", "../etc") == 0
    assert await public._content_size("org_x", "pods", "") == 0

    cfg = SimpleNamespace(hosting_config=SimpleNamespace(content_delivery=SimpleNamespace(
        type="s3api", s3api=SimpleNamespace(endpoint_url="http://s3", bucket_name="b"))))
    client = SimpleNamespace(head_object=lambda **kw: {"ContentLength": 99})
    with patch("config.config.get_learnhouse_config", return_value=cfg), patch("boto3.client", return_value=client):
        assert await public._content_size("org_y", "pods", "b.mp3") == 99
    broken = SimpleNamespace(head_object=lambda **kw: (_ for _ in ()).throw(RuntimeError("down")))
    with patch("config.config.get_learnhouse_config", return_value=cfg), patch("boto3.client", return_value=broken):
        assert await public._content_size("org_y", "pods", "c.mp3") == 0


# ─── sitemap data ───────────────────────────────────────────────────────────


async def test_sitemap_threads_pages_switches_and_paywalls(db, org, mock_request):
    f = await _forum(db, org)
    await _catalog(db, org)
    await _add(db,
               LandingPage(page_uuid="page_1", org_id=org.id, slug="about", title="About", published={"page": {}}, published_at=NOW),
               LandingPage(page_uuid="page_2", org_id=org.id, slug="hidden", title="Hidden", published={"page": {"noindex": True}}),
               LandingPage(page_uuid="page_3", org_id=org.id, slug="draft", title="Draft"))
    data = await seo_service.sitemap_data(db, org.slug)
    assert [d["key"] for d in data["discussions"]] == [f"{f.question.id}-how-do-payouts-work"]
    assert data["discussions"][0]["replies"] == 2
    assert [p["key"] for p in data["pages"]] == ["about"]
    assert [a["key"] for a in data["activities"]] == ["open", "video"]
    assert data["org"]["features"] == {"live": True, "newsletters": True, "pages": True, "store": True}
    assert SECRET not in _dump(data)

    with _locked("community_club", "course_c1"):
        data = await seo_service.sitemap_data(db, org.slug, mock_request)
    assert data["discussions"] == [] and data["activities"] == [] and [c["key"] for c in data["communities"]] == ["club"]
    open_id = (await db.execute(select(Activity).where(Activity.activity_uuid == "activity_open"))).scalars().first().id
    with patch("src.core.ee_hooks.get_ee_paid_locked_activity_ids_many", AsyncMock(return_value=None)), \
            patch("src.core.ee_hooks.get_ee_paid_locked_activity_ids", AsyncMock(return_value={open_id})):
        data = await seo_service.sitemap_data(db, org.slug)
    assert [a["key"] for a in data["activities"]] == ["video"]
    # An EE that answers for every course at once: one call, same result
    course_id = (await db.execute(select(Activity).where(Activity.activity_uuid == "activity_open"))).scalars().first().course_id
    per_course = AsyncMock(side_effect=AssertionError("asked course by course"))
    with patch("src.core.ee_hooks.get_ee_paid_locked_activity_ids_many", AsyncMock(return_value={course_id: {open_id}})), \
            patch("src.core.ee_hooks.get_ee_paid_locked_activity_ids", per_course):
        data = await seo_service.sitemap_data(db, org.slug)
    assert [a["key"] for a in data["activities"]] == ["video"]

    await _seo(db, org, indexable_features={k: False for k in ("courses", "paths", "podcasts", "library", "pages")})
    data = await seo_service.sitemap_data(db, org.slug)
    assert data["courses"] == data["paths"] == data["podcasts"] == data["folders"] == data["pages"] == []
    await _seo(db, org, indexable_features={"activities": False})
    data = await seo_service.sitemap_data(db, org.slug)
    assert data["courses"] and data["activities"] == []


# ─── org settings ───────────────────────────────────────────────────────────


def test_seo_org_config_new_fields():
    cfg = SeoOrgConfig(indexable_features={"courses": False, "bogus": True}, ai_crawlers_blocked=[" Bytespider ", "Bytespider", ""],
                       ai_crawler_policy="block_training", indexnow_key="abcdef12")
    assert cfg.indexable_features == {"courses": False}
    assert cfg.ai_crawlers_blocked == ["Bytespider"]
    assert SeoOrgConfig().thin_thread_noindex_days == 90 and SeoOrgConfig().feeds_enabled is True
    for bad in ({"ai_crawlers_blocked": ["bad name"]}, {"ai_crawler_policy": "maybe"}, {"indexnow_key": "short"},
                {"thin_thread_noindex_days": -1}):
        with pytest.raises(ValidationError):
            SeoOrgConfig(**bad)
    assert SeoOrgConfig(indexnow_key="").indexnow_key == ""


async def test_update_org_seo_config_manages_indexnow_key(db, org, admin_user, mock_request):
    from src.services.orgs.orgs import update_org_seo_config

    await _seo(db, org)
    with patch("src.services.orgs.orgs.rbac_check", AsyncMock()):
        await update_org_seo_config(mock_request, SeoOrgConfig(indexnow_enabled=True, indexnow_key="client-chosen-key"), org.id, admin_user, db)
        key = (await seo_service.org_seo_config(db, org.id))["indexnow_key"]
        assert len(key) == 32 and key != "client-chosen-key"
        # Later saves keep it, whatever the client sends.
        await update_org_seo_config(mock_request, SeoOrgConfig(indexnow_enabled=False, indexnow_key="other-key-123"), org.id, admin_user, db)
        assert (await seo_service.org_seo_config(db, org.id))["indexnow_key"] == key


# ─── IndexNow ───────────────────────────────────────────────────────────────


def test_merge_server_managed():
    assert indexnow.merge_server_managed({}, {"indexnow_enabled": False})["indexnow_key"] == ""
    assert len(indexnow.merge_server_managed(None, {"indexnow_enabled": True})["indexnow_key"]) == 32
    assert indexnow.merge_server_managed({"indexnow_key": "kept"}, {"indexnow_key": "x"})["indexnow_key"] == "kept"


@pytest.mark.parametrize(
    "host,expected",
    [(None, False), ("localhost", False), ("acme.localhost", False), ("x.test", False), ("lvh.me", False), ("a.lvh.me", False),
     ("10.0.0.2", False), ("127.0.0.1", False), ("8.8.8.8", True), ("learn.acme.com", True), ("intranet", False)],
)
def test_is_public_host(host, expected):
    assert indexnow.is_public_host(host) is expected


def test_globally_disabled(monkeypatch):
    monkeypatch.delenv("TESTING", raising=False)
    monkeypatch.delenv("LEARNHOUSE_INDEXNOW_DISABLED", raising=False)
    assert indexnow.globally_disabled() is False
    monkeypatch.setenv("LEARNHOUSE_INDEXNOW_DISABLED", "1")
    assert indexnow.globally_disabled() is True


def test_thread_segment():
    assert indexnow.thread_segment(42, "How do payouts work?") == "42-how-do-payouts-work"
    assert indexnow.thread_segment(7, "入门") == "7"


class _Client:
    def __init__(self, status=200, exc=None):
        self.status, self.exc, self.calls = status, exc, []

    async def post(self, url, json):
        self.calls.append((url, json))
        if self.exc:
            raise self.exc
        return SimpleNamespace(status_code=self.status)

    async def aclose(self):
        pass


async def test_ping_submits_dedupes_and_never_raises():
    indexnow._recent.clear()
    client = _Client()
    urls = ["https://learn.acme.com/course/a", "https://evil.example/x"]
    assert await indexnow.ping("https://learn.acme.com", "k" * 32, urls, client=client) is True
    url, payload = client.calls[0]
    assert url == indexnow.INDEXNOW_ENDPOINT
    assert payload == {"host": "learn.acme.com", "key": "k" * 32, "keyLocation": f"https://learn.acme.com/{'k' * 32}.txt",
                       "urlList": ["https://learn.acme.com/course/a"]}
    # Same URL again inside the window: skipped.
    assert await indexnow.ping("https://learn.acme.com", "k" * 32, urls, client=client) is False
    assert await indexnow.ping("https://learn.acme.com", "k" * 32, ["https://learn.acme.com/b"], client=_Client(422)) is False
    assert await indexnow.ping("https://learn.acme.com", "k" * 32, ["https://learn.acme.com/c"], client=_Client(exc=OSError("down"))) is False
    assert await indexnow.ping("http://localhost:3000", "k", ["http://localhost:3000/x"], client=client) is False
    assert await indexnow.ping("https://learn.acme.com", "", ["https://learn.acme.com/d"], client=client) is False


async def test_ping_owns_its_client_when_none_given():
    indexnow._recent.clear()
    fake = _Client()
    with patch("src.services.seo.indexnow.httpx.AsyncClient", return_value=fake):
        assert await indexnow.ping("https://learn.acme.com", "k" * 32, ["https://learn.acme.com/own"]) is True


def test_recent_cache_prunes():
    indexnow._recent.clear()
    for i in range(5001):
        indexnow._recent[f"u{i}"] = 0.0
    indexnow._fresh(["x"], indexnow.DEDUPE_SECONDS + 1)
    assert len(indexnow._recent) == 0


async def test_paths_for_event(db, org):
    f = await _forum(db, org)
    await _catalog(db, org)
    await _add(db, Course(name="Hidden", public=False, published=True, open_to_contributors=False, org_id=org.id, course_uuid="course_hid"))
    p = indexnow._paths_for_event
    assert await p(db, org.id, "course_published", {"course_uuid": "course_c1"}) == ["/course/intro-to-python", "/courses"]
    assert await p(db, org.id, "course_published", {"course_uuid": "course_hid"}) == []
    assert await p(db, org.id, "discussion_posted", {"discussion": {"discussion_uuid": "discussion_q1"}}) == [
        f"/community/club/{f.question.id}-how-do-payouts-work", "/community/club"]
    assert await p(db, org.id, "discussion_posted", {"discussion": {"discussion_uuid": "discussion_secret"}}) == []
    assert await p(db, org.id, "podcast_episode_created", {"podcast_uuid": "podcast_1"}) == ["/podcast/pod"]
    assert await p(db, org.id, "podcast_episode_created", {"podcast_uuid": "podcast_2"}) == []
    assert await p(db, org.id, "folder_updated", {"folder_uuid": "folder_1"}) == ["/library/folder/shelf"]
    assert await p(db, org.id, "folder_created", {"folder_uuid": "folder_2"}) == []
    assert await p(db, org.id, "user_role_changed", {}) == []


async def test_handle_event(db, org):
    await _catalog(db, org)

    class _Factory:
        def __call__(self):
            return self

        async def __aenter__(self):
            return db

        async def __aexit__(self, *a):
            return False

    indexnow._recent.clear()
    client = _Client()
    # Not opted in: nothing sent.
    assert await indexnow.handle_event("course_published", org.id, {"course_uuid": "course_c1"}, _Factory(), client) is False
    await _seo(db, org, indexnow_enabled=True, indexnow_key="a" * 32)
    with patch("src.services.nudges.links.org_base_url", AsyncMock(return_value="https://learn.acme.com")):
        assert await indexnow.handle_event("course_published", org.id, {"course_uuid": "course_c1"}, _Factory(), client) is True
        assert client.calls[0][1]["urlList"] == ["https://learn.acme.com/course/intro-to-python", "https://learn.acme.com/courses"]
        assert await indexnow.handle_event("course_published", org.id, {"course_uuid": "nope"}, _Factory(), client) is False
        assert await indexnow.handle_event("course_published", 999, {"course_uuid": "course_c1"}, _Factory(), client) is False
    with patch("src.services.seo.indexnow._paths_for_event", AsyncMock(side_effect=RuntimeError("boom"))):
        assert await indexnow.handle_event("course_published", org.id, {}, _Factory(), client) is False
    # Tests never reach the network on their own.
    assert await indexnow.handle_event("course_published", org.id, {}) is False


async def test_notify_event_schedules_only_known_events(monkeypatch):
    calls = []

    async def fake(event_name, org_id, data):
        calls.append(event_name)

    monkeypatch.setattr(indexnow, "handle_event", fake)
    monkeypatch.setattr(indexnow, "globally_disabled", lambda: False)
    indexnow.notify_event("user_role_changed", 1, {})
    indexnow.notify_event("course_published", 1, {"course_uuid": "c"})
    for task in list(indexnow._background_tasks):
        await task
    assert calls == ["course_published"]
    monkeypatch.setattr(indexnow, "globally_disabled", lambda: True)
    indexnow.notify_event("course_published", 1, {})
    assert calls == ["course_published"]


def test_notify_event_without_running_loop(monkeypatch):
    monkeypatch.setattr(indexnow, "globally_disabled", lambda: False)
    indexnow.notify_event("course_published", 1, {})  # no loop: silently skipped


def test_dispatch_webhooks_feeds_indexnow():
    import asyncio

    from src.services.webhooks import dispatch

    seen = []
    with patch("src.services.seo.indexnow.notify_event", side_effect=lambda *a: seen.append(a[0])), \
         patch("src.core.ee_hooks.notify_ee_event"), patch.object(dispatch, "_active_cache_get", return_value=False):
        asyncio.run(dispatch.dispatch_webhooks("course_published", 1, {"course_uuid": "c", "name": "n", "published": True}))
    assert seen == ["course_published"]


# ─── endpoints ──────────────────────────────────────────────────────────────


async def test_router_endpoints(db, org, mock_request):
    f = await _forum(db, org)
    await _catalog(db, org)
    anon = AnonymousUser()
    assert (await seo_router.api_thread_lookup(mock_request, org.slug, "club", str(f.question.id), db, anon))["id"] == f.question.id
    assert (await seo_router.api_thread_jsonld(mock_request, org.slug, "club", str(f.question.id), db))["reply_count"] == 2
    assert (await seo_router.api_feed_data(mock_request, org.slug, "courses", None, "new", None, db))["kind"] == "courses"
    assert (await seo_router.api_llms_data(mock_request, org.slug, False, db))["org"]["name"] == org.name
    assert (await seo_router.api_markdown_data(mock_request, org.slug, "course", "intro-to-python", None, db))["type"] == "course"
    assert (await seo_router.api_sitemap_data(mock_request, org.slug, db))["org"]["slug"] == org.slug
    with pytest.raises(HTTPException):
        await seo_router.api_indexnow_key(org.slug, db)
    await _seo(db, org, indexnow_enabled=True, indexnow_key="b" * 32)
    assert await seo_router.api_indexnow_key(org.slug, db) == {"key": "b" * 32}


async def test_empty_inputs_and_noindexed_extras(db, org, mock_request):
    assert await public._users(db, set()) == {}
    assert await public._comment_counts(db, []) == {}
    assert await public._course_authors(db, []) == {}
    assert await public._listed_courses(db, org.id, {"indexable_features": {"courses": False}}, 10) == []
    await _seo(db, org, noindex_communities=True)
    assert await public._listed_communities(db, org.id, {"noindex_communities": True}) == []
    await _seo(db, org)
    await _add(db, Path(name="Hidden path", org_id=org.id, path_uuid="path_n", public=True, published=True, seo={"robots_noindex": True}),
               Podcast(name="Hidden pod", org_id=org.id, podcast_uuid="podcast_n", public=True, published=True, seo={"robots_noindex": True}))
    full = await public.llms_data(mock_request, db, org.slug, full=True)
    assert full["paths"] == [] and full["podcasts"] == []


async def test_handle_event_default_session_and_missing_org(db, org):
    class _Factory:
        def __call__(self):
            return self

        async def __aenter__(self):
            return db

        async def __aexit__(self, *a):
            return False

    indexnow._recent.clear()
    enabled = AsyncMock(return_value={"indexnow_enabled": True, "indexnow_key": "c" * 32})
    with patch("src.core.events.database._async_session_factory", _Factory()), \
         patch("src.services.seo.seo.org_seo_config", enabled), \
         patch("src.services.seo.indexnow._paths_for_event", AsyncMock(return_value=["/x"])):
        # Default session factory; the org row is gone: nothing sent.
        assert await indexnow.handle_event("course_published", 999, {}, None, _Client()) is False
