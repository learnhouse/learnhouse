"""Update paths and guard branches of src/services/courses/activities/video.py.

Covers update_video_activity / update_external_video_activity, the 404s for
broken chapter/course links on create, the best-effort HLS and caption
enqueues, and upload_video's storage call. RBAC, storage and queues are mocked.
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, UploadFile
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.services.courses.activities import video as video_mod
from src.services.courses.activities.uploads.videos import upload_video
from src.services.courses.activities.video import (
    CaptionLanguageIn,
    CaptionsConfigIn,
    ExternalVideo,
    configure_captions,
    create_external_video_activity,
    create_video_activity,
    update_external_video_activity,
    update_video_activity,
)

MOD = "src.services.courses.activities.video"


def _video_file(content_type: str = "video/mp4", filename: str = "clip.mp4") -> MagicMock:
    uf = MagicMock(spec=UploadFile)
    uf.content_type = content_type
    uf.filename = filename
    return uf


async def _add_video(db, org, course, uuid, *, sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
                     content=None, course_id=None):
    a = Activity(
        name="Original",
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=sub_type,
        content=content if content is not None else {"filename": "old.mp4", "activity_uuid": uuid},
        details={"keep": True},
        published=True,
        org_id=org.id,
        course_id=course_id if course_id is not None else course.id,
        activity_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date="2000-01-01",
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


async def _reload(db, uuid) -> Activity:
    db.expire_all()
    return (await db.execute(select(Activity).where(Activity.activity_uuid == uuid))).scalars().first()


async def _unlinked_chapter(db, org, course, *, cid=77) -> Chapter:
    ch = Chapter(
        id=cid,
        name="Loose",
        description="",
        org_id=org.id,
        course_id=course.id,
        chapter_uuid=f"chapter_loose_{cid}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ch)
    await db.commit()
    return ch


async def _chapter_linked_to_missing_course(db, org, course, *, cid=78) -> Chapter:
    ch = await _unlinked_chapter(db, org, course, cid=cid)
    db.add(CourseChapter(
        chapter_id=ch.id, course_id=999, org_id=org.id, order=1,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db.commit()
    return ch


# ---------------------------------------------------------------------------
# upload_video
# ---------------------------------------------------------------------------


async def test_upload_video_stores_under_activity_video_dir():
    """Activity videos land in the course/activity video folder, video-only."""
    f = _video_file()
    with patch(
        "src.services.courses.activities.uploads.videos.upload_file",
        new=AsyncMock(return_value="video_abc.mp4"),
    ) as up:
        name = await upload_video(f, "activity_1", "org_1", "course_1")
    assert name == "video_abc.mp4"
    up.assert_awaited_once_with(
        file=f,
        directory="courses/course_1/activities/activity_1/video",
        type_of_dir="orgs",
        uuid="org_1",
        allowed_types=["video"],
        filename_prefix="video",
    )


# ---------------------------------------------------------------------------
# create_video_activity / create_external_video_activity guards
# ---------------------------------------------------------------------------


async def test_create_video_chapter_without_course_link_is_404(mock_request, db, org, course, admin_user):
    ch = await _unlinked_chapter(db, org, course)
    with pytest.raises(HTTPException) as exc:
        await create_video_activity(mock_request, "V", ch.id, admin_user, db, video_file=_video_file())
    assert exc.value.status_code == 404
    assert exc.value.detail == "CourseChapter not found"


async def test_create_video_course_missing_is_404(mock_request, db, org, course, admin_user):
    ch = await _chapter_linked_to_missing_course(db, org, course)
    with pytest.raises(HTTPException) as exc:
        await create_video_activity(mock_request, "V", ch.id, admin_user, db, video_file=_video_file())
    assert exc.value.status_code == 404
    assert exc.value.detail == "Course not found"


async def test_create_video_without_filename_is_409(mock_request, db, org, course, chapter, admin_user):
    """A correctly typed part with an empty filename is not a usable upload."""
    with patch(f"{MOD}.check_resource_access", new=AsyncMock()), patch(
        f"{MOD}.upload_video", new=AsyncMock()
    ) as up:
        with pytest.raises(HTTPException) as exc:
            await create_video_activity(
                mock_request, "V", chapter.id, admin_user, db, video_file=_video_file(filename=""),
            )
    assert exc.value.status_code == 409
    up.assert_not_awaited()


async def test_create_video_survives_hls_enqueue_failure(
    mock_request, db, org, course, chapter, admin_user, rag_dispatch
):
    """HLS is an optimisation: a queue failure must not fail the upload."""
    with patch(f"{MOD}.check_resource_access", new=AsyncMock()), patch(
        f"{MOD}.upload_video", new=AsyncMock(return_value="video_x.mp4")
    ), patch(
        "src.services.utils.hls_jobs.enqueue", side_effect=RuntimeError("redis down")
    ) as hls:
        result = await create_video_activity(
            mock_request, "V", chapter.id, admin_user, db, video_file=_video_file(),
        )
    hls.assert_called_once_with(result.activity_uuid)
    assert result.content["filename"] == "video_x.mp4"
    assert (await _reload(db, result.activity_uuid)) is not None


async def test_create_external_chapter_without_course_link_is_404(mock_request, db, org, course, admin_user):
    ch = await _unlinked_chapter(db, org, course)
    data = ExternalVideo(name="YT", uri="https://youtu.be/x", type="youtube", chapter_id=ch.id)
    with pytest.raises(HTTPException) as exc:
        await create_external_video_activity(mock_request, admin_user, data, db)
    assert exc.value.status_code == 404
    assert exc.value.detail == "CourseChapter not found"


async def test_create_external_course_missing_is_404(mock_request, db, org, course, admin_user):
    ch = await _chapter_linked_to_missing_course(db, org, course)
    data = ExternalVideo(name="YT", uri="https://youtu.be/x", type="youtube", chapter_id=ch.id)
    with pytest.raises(HTTPException) as exc:
        await create_external_video_activity(mock_request, admin_user, data, db)
    assert exc.value.status_code == 404
    assert exc.value.detail == "Course not found"


# ---------------------------------------------------------------------------
# update_video_activity
# ---------------------------------------------------------------------------


async def test_update_video_missing_activity_is_404(mock_request, db, org, admin_user):
    with pytest.raises(HTTPException) as exc:
        await update_video_activity(mock_request, "activity_nope", admin_user, db, name="x")
    assert exc.value.status_code == 404
    assert exc.value.detail == "Activity not found"


async def test_update_video_missing_course_is_404(mock_request, db, org, course, admin_user):
    await _add_video(db, org, course, "vid_nocourse", course_id=999)
    with pytest.raises(HTTPException) as exc:
        await update_video_activity(mock_request, "vid_nocourse", admin_user, db, name="x")
    assert exc.value.status_code == 404
    assert exc.value.detail == "Course not found"


async def test_update_video_metadata_only(mock_request, db, org, course, admin_user, rag_dispatch):
    """Renaming / new details leave the file alone and skip transcription."""
    await _add_video(db, org, course, "vid_meta")
    with patch(f"{MOD}.check_resource_access", new=AsyncMock()) as rbac, patch(
        f"{MOD}.upload_video", new=AsyncMock()
    ) as up:
        result = await update_video_activity(
            mock_request, "vid_meta", admin_user, db, name="Renamed", details='{"start": 5}',
        )
    assert rbac.await_args.args[4].value == "update"
    up.assert_not_awaited()
    assert result.name == "Renamed"
    assert result.details == {"start": 5}
    assert result.content["filename"] == "old.mp4"
    assert result.update_date != "2000-01-01"
    assert rag_dispatch.call_args.args[2] is False


async def test_update_video_replaces_file(mock_request, db, org, course, admin_user, rag_dispatch):
    """A new upload swaps the stored filename, keeps other content keys, and
    asks for re-transcription."""
    await _add_video(db, org, course, "vid_file")
    with patch(f"{MOD}.check_resource_access", new=AsyncMock()), patch(
        f"{MOD}.upload_video", new=AsyncMock(return_value="video_new.webm")
    ) as up:
        result = await update_video_activity(
            mock_request, "vid_file", admin_user, db, video_file=_video_file("video/webm", "n.webm"),
        )
    up.assert_awaited_once()
    assert up.await_args.args[1:] == ("vid_file", org.org_uuid, course.course_uuid)
    assert result.name == "Original"
    assert result.content == {"filename": "video_new.webm", "activity_uuid": "vid_file"}
    stored = await _reload(db, "vid_file")
    assert stored.content["filename"] == "video_new.webm"
    assert rag_dispatch.call_args.args[2] is True


async def test_update_video_file_on_empty_content(mock_request, db, org, course, admin_user, rag_dispatch):
    await _add_video(db, org, course, "vid_empty", content={})
    with patch(f"{MOD}.check_resource_access", new=AsyncMock()), patch(
        f"{MOD}.upload_video", new=AsyncMock(return_value="video_first.mp4")
    ):
        result = await update_video_activity(
            mock_request, "vid_empty", admin_user, db, video_file=_video_file(),
        )
    assert result.content == {"filename": "video_first.mp4"}


async def test_update_video_rejects_wrong_format(mock_request, db, org, course, admin_user, rag_dispatch):
    await _add_video(db, org, course, "vid_bad")
    with patch(f"{MOD}.check_resource_access", new=AsyncMock()), patch(
        f"{MOD}.upload_video", new=AsyncMock()
    ) as up:
        with pytest.raises(HTTPException) as exc:
            await update_video_activity(
                mock_request, "vid_bad", admin_user, db,
                video_file=_video_file("application/pdf", "doc.pdf"),
            )
    assert exc.value.status_code == 409
    up.assert_not_awaited()
    assert (await _reload(db, "vid_bad")).content["filename"] == "old.mp4"


async def test_update_video_skips_upload_when_org_missing(
    mock_request, db, org, course, admin_user, rag_dispatch
):
    """Without an org there is no storage location, so the file is ignored."""
    a = await _add_video(db, org, course, "vid_noorg")
    a.org_id = 999
    db.add(a)
    await db.commit()
    with patch(f"{MOD}.check_resource_access", new=AsyncMock()), patch(
        f"{MOD}.upload_video", new=AsyncMock()
    ) as up:
        result = await update_video_activity(
            mock_request, "vid_noorg", admin_user, db, video_file=_video_file(),
        )
    up.assert_not_awaited()
    assert result.content["filename"] == "old.mp4"


# ---------------------------------------------------------------------------
# update_external_video_activity
# ---------------------------------------------------------------------------


async def test_update_external_missing_activity_is_404(mock_request, db, org, admin_user):
    with pytest.raises(HTTPException) as exc:
        await update_external_video_activity(mock_request, "activity_nope", admin_user, db, name="x")
    assert exc.value.status_code == 404
    assert exc.value.detail == "Activity not found"


async def test_update_external_missing_course_is_404(mock_request, db, org, course, admin_user):
    await _add_video(db, org, course, "yt_nocourse", course_id=999,
                     sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE)
    with pytest.raises(HTTPException) as exc:
        await update_external_video_activity(mock_request, "yt_nocourse", admin_user, db, name="x")
    assert exc.value.status_code == 404
    assert exc.value.detail == "Course not found"


async def test_update_external_changes_uri_name_details(mock_request, db, org, course, admin_user, rag_dispatch):
    await _add_video(
        db, org, course, "yt_all", sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE,
        content={"uri": "https://youtu.be/old", "type": "youtube"},
    )
    with patch(f"{MOD}.check_resource_access", new=AsyncMock()):
        result = await update_external_video_activity(
            mock_request, "yt_all", admin_user, db,
            uri="https://youtu.be/new", name="New name", details='{"autoplay": true}',
        )
    assert result.name == "New name"
    assert result.content == {"uri": "https://youtu.be/new", "type": "youtube"}
    assert result.details == {"autoplay": True}
    stored = await _reload(db, "yt_all")
    assert stored.content["uri"] == "https://youtu.be/new"
    assert rag_dispatch.called


async def test_update_external_uri_on_empty_content(mock_request, db, org, course, admin_user, rag_dispatch):
    await _add_video(db, org, course, "yt_empty", sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE,
                     content={})
    with patch(f"{MOD}.check_resource_access", new=AsyncMock()):
        result = await update_external_video_activity(
            mock_request, "yt_empty", admin_user, db, uri="https://vimeo.com/1",
        )
    assert result.content == {"uri": "https://vimeo.com/1"}
    assert result.name == "Original"


async def test_update_external_noop_keeps_content(mock_request, db, org, course, admin_user, rag_dispatch):
    """No fields given: only the update timestamp moves."""
    await _add_video(db, org, course, "yt_noop", sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE,
                     content={"uri": "https://youtu.be/keep"})
    with patch(f"{MOD}.check_resource_access", new=AsyncMock()):
        result = await update_external_video_activity(mock_request, "yt_noop", admin_user, db)
    assert result.content == {"uri": "https://youtu.be/keep"}
    assert result.details == {"keep": True}
    assert result.update_date != "2000-01-01"


# ---------------------------------------------------------------------------
# configure_captions guards
# ---------------------------------------------------------------------------


def _mock_caption_gates(monkeypatch, enqueue):
    monkeypatch.setattr(video_mod, "check_resource_access", AsyncMock())
    import src.security.auth as auth_mod
    import src.security.features_utils.usage as usage
    import src.services.security.rate_limiting as rl
    import src.services.utils.caption_jobs as cj

    monkeypatch.setattr(usage, "check_feature_enabled", AsyncMock(return_value=True))
    monkeypatch.setattr(usage, "get_ai_credits_summary", AsyncMock(return_value={"remaining_credits": -1}))
    monkeypatch.setattr(auth_mod, "resolve_acting_user_id", lambda user: 1)
    monkeypatch.setattr(rl, "enforce_ai_rate_limit", lambda user_id, org_id: None)
    monkeypatch.setattr(cj, "enqueue", enqueue)


async def test_configure_captions_missing_activity_is_404(db, org):
    cfg = CaptionsConfigIn(enabled=False)
    with pytest.raises(HTTPException) as exc:
        await configure_captions(None, "activity_nope", None, db, cfg)
    assert exc.value.status_code == 404
    assert exc.value.detail == "Activity not found"


async def test_configure_captions_missing_course_is_404(db, org, course):
    await _add_video(db, org, course, "cap_nocourse", course_id=999)
    with pytest.raises(HTTPException) as exc:
        await configure_captions(None, "cap_nocourse", None, db, CaptionsConfigIn(enabled=False))
    assert exc.value.status_code == 404
    assert exc.value.detail == "Course not found"


async def test_configure_captions_dedupes_and_survives_enqueue_failure(monkeypatch, db, org, course):
    """Duplicate codes collapse to one entry, and a broken queue only logs:
    the settings are already saved and the reaper/next save can retry."""
    calls = []

    def _boom(uuid):
        calls.append(uuid)
        raise RuntimeError("redis down")

    _mock_caption_gates(monkeypatch, _boom)
    await _add_video(db, org, course, "cap_dupes")
    cfg = CaptionsConfigIn(
        enabled=True,
        languages=[
            CaptionLanguageIn(code="fr", label="French"),
            CaptionLanguageIn(code="fr", label="Français"),
            CaptionLanguageIn(code="de"),
        ],
    )
    out = await configure_captions(None, "cap_dupes", None, db, cfg)
    assert [lang["code"] for lang in out["languages"]] == ["fr", "de"]
    assert out["languages"][0]["label"] == "French"
    assert out["languages"][1]["label"] == "de"
    assert out["status"] == "queued"
    assert calls == ["cap_dupes"]
    stored = await _reload(db, "cap_dupes")
    assert stored.extra_metadata["captions"]["status"] == "queued"
