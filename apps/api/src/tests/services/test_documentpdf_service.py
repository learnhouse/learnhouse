"""PDF document activities: input validation, missing parents, and updates.

``create_documentpdf_activity`` walks chapter -> course_chapter -> course
before the RBAC check and then validates the uploaded file; each missing link
or bad file must be a clean 404/409 rather than a crash or a stored activity
with no file. ``update_documentpdf_activity`` renames and/or swaps the file.
Storage is always mocked.
"""

from io import BytesIO
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, UploadFile
from sqlmodel import select
from starlette.datastructures import Headers

from src.db.courses.activities import Activity
from src.db.courses.course_chapters import CourseChapter
from src.services.courses.activities.pdf import (
    create_documentpdf_activity,
    update_documentpdf_activity,
)
from src.services.courses.activities.uploads.pdfs import upload_pdf
from src.services.courses.activities.uploads.tasks_ref_files import (
    upload_reference_file,
)

PDF_MODULE = "src.services.courses.activities.pdf"


def _upload(filename: str = "doc.pdf", content_type: str = "application/pdf") -> UploadFile:
    return UploadFile(
        file=BytesIO(b"%PDF-1.4 tiny"),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


@pytest.fixture
def allow_rbac():
    with patch(f"{PDF_MODULE}.check_resource_access", new_callable=AsyncMock) as mock:
        yield mock


async def _activity_count(db) -> int:
    return len((await db.execute(select(Activity))).scalars().all())


class TestCreateDocumentPdfActivity:
    async def test_unknown_chapter_is_404(self, db, org, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await create_documentpdf_activity(
                mock_request, "Doc", 4242, admin_user, db, _upload()
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Chapter not found"

    async def test_chapter_not_linked_to_a_course_is_404(
        self, db, chapter, admin_user, mock_request
    ):
        link = (await db.execute(
            select(CourseChapter).where(CourseChapter.chapter_id == chapter.id)
        )).scalars().first()
        await db.delete(link)
        await db.commit()

        with pytest.raises(HTTPException) as exc:
            await create_documentpdf_activity(
                mock_request, "Doc", chapter.id, admin_user, db, _upload()
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "CourseChapter not found"

    async def test_link_to_a_deleted_course_is_404(
        self, db, chapter, admin_user, mock_request
    ):
        link = (await db.execute(
            select(CourseChapter).where(CourseChapter.chapter_id == chapter.id)
        )).scalars().first()
        link.course_id = 999
        db.add(link)
        await db.commit()

        with pytest.raises(HTTPException) as exc:
            await create_documentpdf_activity(
                mock_request, "Doc", chapter.id, admin_user, db, _upload()
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Course not found"

    @pytest.mark.parametrize(
        "pdf_file, detail",
        [
            (None, "Pdf : No pdf file provided"),
            (_upload(content_type="image/png"), "Pdf : Wrong pdf format"),
            (_upload(filename=""), "Pdf : No pdf file provided"),
        ],
        ids=["no-file", "wrong-type", "no-filename"],
    )
    async def test_bad_upload_is_409_and_creates_nothing(
        self, db, chapter, admin_user, mock_request, allow_rbac, pdf_file, detail
    ):
        with patch(f"{PDF_MODULE}.upload_pdf", new_callable=AsyncMock) as upload:
            with pytest.raises(HTTPException) as exc:
                await create_documentpdf_activity(
                    mock_request, "Doc", chapter.id, admin_user, db, pdf_file
                )

        assert exc.value.status_code == 409
        assert exc.value.detail == detail
        upload.assert_not_awaited()
        assert await _activity_count(db) == 0


class TestUpdateDocumentPdfActivity:
    async def test_unknown_activity_is_404(self, db, org, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await update_documentpdf_activity(
                mock_request, "activity_missing", admin_user, db, name="x"
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Activity not found"

    async def test_activity_whose_course_is_gone_is_404(
        self, db, activity, admin_user, mock_request
    ):
        activity.course_id = 999
        db.add(activity)
        await db.commit()

        with pytest.raises(HTTPException) as exc:
            await update_documentpdf_activity(
                mock_request, activity.activity_uuid, admin_user, db, name="x"
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Course not found"

    async def test_rename_only_keeps_the_file(
        self, db, activity, admin_user, mock_request, allow_rbac
    ):
        activity.content = {"filename": "old.pdf", "activity_uuid": activity.activity_uuid}
        db.add(activity)
        await db.commit()

        with patch(f"{PDF_MODULE}.upload_pdf", new_callable=AsyncMock) as upload:
            result = await update_documentpdf_activity(
                mock_request, activity.activity_uuid, admin_user, db, name="Renamed"
            )

        assert result.name == "Renamed"
        assert result.content["filename"] == "old.pdf"
        upload.assert_not_awaited()
        allow_rbac.assert_awaited_once()

    async def test_new_file_replaces_the_stored_filename(
        self, db, org, course, activity, admin_user, mock_request, allow_rbac
    ):
        activity.content = {"filename": "old.pdf", "activity_uuid": activity.activity_uuid}
        db.add(activity)
        await db.commit()
        pdf = _upload("new.pdf")

        with patch(
            f"{PDF_MODULE}.upload_pdf",
            new_callable=AsyncMock,
            return_value="documentpdf_new.pdf",
        ) as upload:
            result = await update_documentpdf_activity(
                mock_request, activity.activity_uuid, admin_user, db, pdf_file=pdf
            )

        upload.assert_awaited_once_with(
            pdf, activity.activity_uuid, org.org_uuid, course.course_uuid
        )
        assert result.name == "Test Activity"
        assert result.content == {
            "filename": "documentpdf_new.pdf",
            "activity_uuid": activity.activity_uuid,
        }
        stored = (await db.execute(
            select(Activity).where(Activity.id == activity.id)
        )).scalars().first()
        assert stored.content["filename"] == "documentpdf_new.pdf"

    async def test_new_file_on_activity_without_content_starts_fresh(
        self, db, activity, admin_user, mock_request, allow_rbac
    ):
        activity.content = {}
        db.add(activity)
        await db.commit()

        with patch(
            f"{PDF_MODULE}.upload_pdf",
            new_callable=AsyncMock,
            return_value="documentpdf_x.pdf",
        ):
            result = await update_documentpdf_activity(
                mock_request, activity.activity_uuid, admin_user, db,
                pdf_file=_upload(),
            )

        assert result.content == {"filename": "documentpdf_x.pdf"}

    async def test_wrong_file_type_is_409_and_nothing_changes(
        self, db, activity, admin_user, mock_request, allow_rbac
    ):
        with patch(f"{PDF_MODULE}.upload_pdf", new_callable=AsyncMock) as upload:
            with pytest.raises(HTTPException) as exc:
                await update_documentpdf_activity(
                    mock_request, activity.activity_uuid, admin_user, db,
                    name="Renamed", pdf_file=_upload("x.png", "image/png"),
                )

        assert exc.value.status_code == 409
        assert exc.value.detail == "Pdf : Wrong pdf format"
        upload.assert_not_awaited()


class TestUploadHelpers:
    """The thin upload wrappers pin the storage directory and allowed types."""

    async def test_upload_pdf_targets_the_activity_documentpdf_dir(self):
        f = _upload()
        with patch(
            "src.services.courses.activities.uploads.pdfs.upload_file",
            new_callable=AsyncMock,
            return_value="documentpdf_abc.pdf",
        ) as upload_file:
            name = await upload_pdf(f, "activity_1", "org_1", "course_1")

        assert name == "documentpdf_abc.pdf"
        upload_file.assert_awaited_once_with(
            file=f,
            directory="courses/course_1/activities/activity_1/documentpdf",
            type_of_dir="orgs",
            uuid="org_1",
            allowed_types=["document"],
            filename_prefix="documentpdf",
        )

    async def test_upload_reference_file_targets_the_task_dir(self):
        f = _upload()
        with patch(
            "src.services.courses.activities.uploads.tasks_ref_files.upload_file",
            new_callable=AsyncMock,
            return_value="reference_abc.pdf",
        ) as upload_file:
            name = await upload_reference_file(
                f, "activity_1", "org_1", "course_1", "assignment_1", "task_1"
            )

        assert name == "reference_abc.pdf"
        upload_file.assert_awaited_once_with(
            file=f,
            directory=(
                "courses/course_1/activities/activity_1/assignments/assignment_1"
                "/tasks/task_1"
            ),
            type_of_dir="orgs",
            uuid="org_1",
            allowed_types=["document", "image", "video", "office", "scorm"],
            filename_prefix="reference",
        )
