"""Tests for `src.services.courses.certifications`."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.certifications import (
    CertificateUser,
    CertificateUserRead,
    CertificationCreate,
    CertificationRead,
    CertificationUpdate,
    Certifications,
)
from src.db.courses.courses import Course
from src.db.trail_runs import StatusEnum, TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.services.courses.certifications import (
    check_course_completion_and_create_certificate,
    create_certificate_user,
    create_certification,
    delete_certification,
    get_all_user_certificates,
    get_certificate_by_user_certification_uuid,
    get_certification,
    get_certifications_by_course,
    get_user_certificates_for_course,
    update_certification,
)
from src.security.rbac import AccessAction
from src.services.analytics import events as analytics_events


def _create_certification(
    db,
    course,
    *,
    cert_id: int = 1,
    cert_uuid: str = "certification_test",
    config: dict | None = None,
):
    certification = Certifications(
        id=cert_id,
        course_id=course.id,
        config=config or {},
        certification_uuid=cert_uuid,
        creation_date="2024-01-01T00:00:00",
        update_date="2024-01-01T00:00:00",
    )
    db.add(certification)
    db.commit()
    db.refresh(certification)
    return certification


def _create_certificate_user(
    db,
    certification,
    user,
    *,
    cert_user_id: int = 1,
    user_certification_uuid: str = "AB-20240101-TEST-001",
):
    certificate_user = CertificateUser(
        id=cert_user_id,
        user_id=user.id,
        certification_id=certification.id,
        user_certification_uuid=user_certification_uuid,
        created_at="2024-01-01T00:00:00",
        updated_at="2024-01-01T00:00:00",
    )
    db.add(certificate_user)
    db.commit()
    db.refresh(certificate_user)
    return certificate_user


def _create_course_without_certifications(db, org, *, course_id: int, course_uuid: str):
    course = Course(
        id=course_id,
        name=f"Course {course_id}",
        description="No certificates yet",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid=course_uuid,
        creation_date="2024-01-01T00:00:00",
        update_date="2024-01-01T00:00:00",
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


def _create_trail_complete_graph(db, org, course, user):
    trail = Trail(
        id=1,
        org_id=org.id,
        user_id=user.id,
        trail_uuid="trail_test",
        creation_date="2024-01-01T00:00:00",
        update_date="2024-01-01T00:00:00",
    )
    db.add(trail)
    db.commit()
    db.refresh(trail)

    trail_run = TrailRun(
        id=1,
        data={},
        status=StatusEnum.STATUS_COMPLETED,
        trail_id=trail.id,
        course_id=course.id,
        org_id=org.id,
        user_id=user.id,
        creation_date="2024-01-01T00:00:00",
        update_date="2024-01-01T00:00:00",
    )
    db.add(trail_run)
    db.commit()
    db.refresh(trail_run)

    return trail, trail_run


class TestCreateCertification:
    @pytest.mark.asyncio
    async def test_create_certification_success(
        self, db, course, admin_user, mock_request
    ):
        certification_object = CertificationCreate(
            course_id=course.id,
            config={"template": "gold"},
        )

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access:
            result = await create_certification(
                mock_request,
                certification_object,
                admin_user,
                db,
            )

        assert isinstance(result, CertificationRead)
        assert result.course_id == course.id
        assert result.config == {"template": "gold"}
        assert result.certification_uuid.startswith("certification_")
        mock_access.assert_awaited_once_with(
            mock_request,
            db,
            admin_user,
            course.course_uuid,
            AccessAction.CREATE,
        )

    @pytest.mark.asyncio
    async def test_create_certification_missing_course(
        self, db, admin_user, mock_request
    ):
        certification_object = CertificationCreate(course_id=999, config={})

        with pytest.raises(HTTPException) as exc_info:
            await create_certification(
                mock_request,
                certification_object,
                admin_user,
                db,
            )

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail


class TestGetCertification:
    @pytest.mark.asyncio
    async def test_get_certification_success(
        self, db, course, admin_user, mock_request
    ):
        certification = _create_certification(db, course, cert_uuid="cert_get")

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access:
            result = await get_certification(
                mock_request,
                certification.certification_uuid,
                admin_user,
                db,
            )

        assert isinstance(result, CertificationRead)
        assert result.certification_uuid == "cert_get"
        mock_access.assert_awaited_once_with(
            mock_request,
            db,
            admin_user,
            course.course_uuid,
            AccessAction.READ,
        )

    @pytest.mark.asyncio
    async def test_get_certification_missing_certification(
        self, db, admin_user, mock_request
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_certification(
                mock_request,
                "missing-cert",
                admin_user,
                db,
            )

        assert exc_info.value.status_code == 404
        assert "Certification not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_get_certification_missing_course(
        self, db, admin_user, mock_request
    ):
        certification = _create_certification(
            db,
            Course(
                id=999,
                name="Ghost Course",
                description="Missing course relation",
                public=True,
                published=True,
                open_to_contributors=False,
                org_id=1,
                course_uuid="course_missing",
                creation_date="2024-01-01T00:00:00",
                update_date="2024-01-01T00:00:00",
            ),
            cert_uuid="cert_missing_course",
        )

        with pytest.raises(HTTPException) as exc_info:
            await get_certification(
                mock_request,
                certification.certification_uuid,
                admin_user,
                db,
            )

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail


class TestGetCertificationsByCourse:
    @pytest.mark.asyncio
    async def test_get_certifications_by_course_success(
        self, db, course, admin_user, mock_request
    ):
        certification = _create_certification(db, course, cert_uuid="cert_by_course")

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access:
            result = await get_certifications_by_course(
                mock_request,
                course.course_uuid,
                admin_user,
                db,
            )

        assert len(result) == 1
        assert result[0].certification_uuid == certification.certification_uuid
        mock_access.assert_awaited_once_with(
            mock_request,
            db,
            admin_user,
            course.course_uuid,
            AccessAction.READ,
        )

    @pytest.mark.asyncio
    async def test_get_certifications_by_course_empty(
        self, db, org, admin_user, mock_request
    ):
        empty_course = _create_course_without_certifications(
            db,
            org,
            course_id=99,
            course_uuid="course_empty_certifications",
        )

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_certifications_by_course(
                mock_request,
                empty_course.course_uuid,
                admin_user,
                db,
            )

        assert result == []


class TestUpdateCertification:
    @pytest.mark.asyncio
    async def test_update_certification_success(
        self, db, course, admin_user, mock_request
    ):
        certification = _create_certification(
            db,
            course,
            cert_uuid="cert_update",
            config={"template": "old"},
        )
        old_update_date = certification.update_date

        update_object = CertificationUpdate(config={"template": "new"})

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access:
            result = await update_certification(
                mock_request,
                certification.certification_uuid,
                update_object,
                admin_user,
                db,
            )

        assert result.config == {"template": "new"}
        assert result.update_date != old_update_date
        mock_access.assert_awaited_once_with(
            mock_request,
            db,
            admin_user,
            course.course_uuid,
            AccessAction.UPDATE,
        )

    @pytest.mark.asyncio
    async def test_update_certification_missing_certification(
        self, db, admin_user, mock_request
    ):
        update_object = CertificationUpdate(config={"template": "new"})

        with pytest.raises(HTTPException) as exc_info:
            await update_certification(
                mock_request,
                "missing-cert",
                update_object,
                admin_user,
                db,
            )

        assert exc_info.value.status_code == 404
        assert "Certification not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_update_certification_missing_course(
        self, db, admin_user, mock_request
    ):
        certification = _create_certification(
            db,
            Course(
                id=999,
                name="Ghost Course",
                description="Missing course relation",
                public=True,
                published=True,
                open_to_contributors=False,
                org_id=1,
                course_uuid="course_missing_update",
                creation_date="2024-01-01T00:00:00",
                update_date="2024-01-01T00:00:00",
            ),
            cert_uuid="cert_update_missing_course",
        )

        with pytest.raises(HTTPException) as exc_info:
            await update_certification(
                mock_request,
                certification.certification_uuid,
                CertificationUpdate(config={"template": "new"}),
                admin_user,
                db,
            )

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail


class TestDeleteCertification:
    @pytest.mark.asyncio
    async def test_delete_certification_success(
        self, db, course, admin_user, mock_request
    ):
        certification = _create_certification(db, course, cert_uuid="cert_delete")

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access:
            result = await delete_certification(
                mock_request,
                certification.certification_uuid,
                admin_user,
                db,
            )

        assert result == {"detail": "Certification deleted successfully"}
        assert db.exec(
            select(Certifications).where(
                Certifications.certification_uuid == certification.certification_uuid
            )
        ).first() is None
        mock_access.assert_awaited_once_with(
            mock_request,
            db,
            admin_user,
            course.course_uuid,
            AccessAction.DELETE,
        )

    @pytest.mark.asyncio
    async def test_delete_certification_missing_certification(
        self, db, admin_user, mock_request
    ):
        with pytest.raises(HTTPException) as exc_info:
            await delete_certification(
                mock_request,
                "missing-cert",
                admin_user,
                db,
            )

        assert exc_info.value.status_code == 404
        assert "Certification not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_delete_certification_missing_course(
        self, db, admin_user, mock_request
    ):
        certification = _create_certification(
            db,
            Course(
                id=999,
                name="Ghost Course",
                description="Missing course relation",
                public=True,
                published=True,
                open_to_contributors=False,
                org_id=1,
                course_uuid="course_missing_delete",
                creation_date="2024-01-01T00:00:00",
                update_date="2024-01-01T00:00:00",
            ),
            cert_uuid="cert_delete_missing_course",
        )

        with pytest.raises(HTTPException) as exc_info:
            await delete_certification(
                mock_request,
                certification.certification_uuid,
                admin_user,
                db,
            )

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail


class TestCreateCertificateUser:
    @pytest.mark.asyncio
    async def test_create_certificate_user_success(
        self, db, course, org, admin_user, regular_user, mock_request
    ):
        certification = _create_certification(db, course, cert_uuid="cert_claim")

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access, patch(
            "src.services.courses.certifications.track",
            new_callable=AsyncMock,
        ) as mock_track, patch(
            "src.services.courses.certifications.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhooks:
            result = await create_certificate_user(
                mock_request,
                regular_user.id,
                certification.id,
                db,
                current_user=admin_user,
            )

        assert isinstance(result, CertificateUserRead)
        assert result.user_id == regular_user.id
        assert result.certification_id == certification.id
        parts = result.user_certification_uuid.split("-")
        current_date = datetime.now().strftime("%Y%m%d")
        assert len(parts[0]) == 2
        assert parts[1] == current_date
        assert parts[2] == regular_user.user_uuid[-4:]
        assert parts[3] == "001"
        mock_access.assert_awaited_once_with(
            mock_request,
            db,
            admin_user,
            course.course_uuid,
            AccessAction.CREATE,
        )
        mock_track.assert_awaited_once_with(
            event_name=analytics_events.CERTIFICATE_CLAIMED,
            org_id=org.id,
            user_id=regular_user.id,
            properties={"course_uuid": course.course_uuid},
        )
        mock_webhooks.assert_awaited_once()
        webhook_kwargs = mock_webhooks.await_args.kwargs
        assert webhook_kwargs["event_name"] == analytics_events.CERTIFICATE_CLAIMED
        assert webhook_kwargs["org_id"] == org.id
        assert webhook_kwargs["data"]["user"]["user_uuid"] == regular_user.user_uuid
        assert webhook_kwargs["data"]["course"]["course_uuid"] == course.course_uuid
        assert webhook_kwargs["data"]["certificate"]["user_certification_uuid"] == (
            result.user_certification_uuid
        )

    @pytest.mark.asyncio
    async def test_create_certificate_user_duplicate(
        self, db, course, admin_user, regular_user, mock_request
    ):
        certification = _create_certification(db, course, cert_uuid="cert_duplicate")
        _create_certificate_user(db, certification, regular_user)

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.certifications.track",
            new_callable=AsyncMock,
        ) as mock_track, patch(
            "src.services.courses.certifications.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhooks:
            with pytest.raises(HTTPException) as exc_info:
                await create_certificate_user(
                    mock_request,
                    regular_user.id,
                    certification.id,
                    db,
                    current_user=admin_user,
                )

        assert exc_info.value.status_code == 400
        assert "already has a certificate" in exc_info.value.detail
        mock_track.assert_not_called()
        mock_webhooks.assert_not_called()

    @pytest.mark.asyncio
    async def test_create_certificate_user_missing_user(
        self, db, course, admin_user, mock_request
    ):
        certification = _create_certification(db, course, cert_uuid="cert_missing_user")

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await create_certificate_user(
                    mock_request,
                    999,
                    certification.id,
                    db,
                    current_user=admin_user,
                )

        assert exc_info.value.status_code == 404
        assert "User not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_create_certificate_user_missing_course_for_current_user(
        self, db, admin_user, mock_request
    ):
        certification = _create_certification(
            db,
            Course(
                id=999,
                name="Ghost Course",
                description="Missing course relation",
                public=True,
                published=True,
                open_to_contributors=False,
                org_id=1,
                course_uuid="course_missing_claim",
                creation_date="2024-01-01T00:00:00",
                update_date="2024-01-01T00:00:00",
            ),
            cert_uuid="cert_missing_claim_course",
        )

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await create_certificate_user(
                    mock_request,
                    admin_user.id,
                    certification.id,
                    db,
                    current_user=admin_user,
                )

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail


class TestUserCertificatesForCourse:
    @pytest.mark.asyncio
    async def test_get_user_certificates_for_course_success(
        self, db, course, admin_user, regular_user, mock_request
    ):
        certification = _create_certification(db, course, cert_uuid="cert_user_course")
        _create_certificate_user(db, certification, regular_user)

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access:
            result = await get_user_certificates_for_course(
                mock_request,
                course.course_uuid,
                regular_user,
                db,
            )

        assert len(result) == 1
        assert result[0]["certificate_user"].user_id == regular_user.id
        assert result[0]["certification"].certification_uuid == certification.certification_uuid
        mock_access.assert_awaited_once_with(
            mock_request,
            db,
            regular_user,
            course.course_uuid,
            AccessAction.READ,
        )

    @pytest.mark.asyncio
    async def test_get_user_certificates_for_course_empty_course(
        self, db, org, regular_user, mock_request
    ):
        empty_course = _create_course_without_certifications(
            db,
            org,
            course_id=111,
            course_uuid="course_no_certifications",
        )

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_user_certificates_for_course(
                mock_request,
                empty_course.course_uuid,
                regular_user,
                db,
            )

        assert result == []

    @pytest.mark.asyncio
    async def test_get_user_certificates_for_course_no_certificate_users(
        self, db, course, regular_user, mock_request
    ):
        _create_certification(db, course, cert_uuid="cert_user_missing_link")

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_user_certificates_for_course(
                mock_request,
                course.course_uuid,
                regular_user,
                db,
            )

        assert result == []


class TestCompletionHelpers:
    @pytest.mark.asyncio
    async def test_check_course_completion_and_create_certificate_success(
        self, db, course, org, regular_user, activity, mock_request
    ):
        certification = _create_certification(
            db,
            course,
            cert_uuid="cert_completion",
        )
        _create_trail_complete_graph(db, org, course, regular_user)
        trail_step = TrailStep(
            complete=True,
            teacher_verified=False,
            grade="",
            data={},
            trailrun_id=1,
            trail_id=1,
            activity_id=activity.id,
            course_id=course.id,
            org_id=org.id,
            user_id=regular_user.id,
            creation_date="2024-01-01T00:00:00",
            update_date="2024-01-01T00:00:00",
        )
        db.add(trail_step)
        db.commit()

        with patch(
            "src.services.courses.certifications.track",
            new_callable=AsyncMock,
        ) as mock_track, patch(
            "src.services.courses.certifications.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhooks:
            result = await check_course_completion_and_create_certificate(
                mock_request,
                regular_user.id,
                course.id,
                db,
            )

        assert result is True
        created = db.exec(
            select(CertificateUser).where(
                CertificateUser.certification_id == certification.id,
                CertificateUser.user_id == regular_user.id,
            )
        ).first()
        assert created is not None
        mock_track.assert_awaited_once()
        mock_webhooks.assert_awaited_once()

        second_result = await check_course_completion_and_create_certificate(
            mock_request,
            regular_user.id,
            course.id,
            db,
        )
        assert second_result is False

    @pytest.mark.asyncio
    async def test_check_course_completion_and_create_certificate_no_activities(
        self, db, org, regular_user, mock_request
    ):
        course_without_activities = _create_course_without_certifications(
            db,
            org,
            course_id=222,
            course_uuid="course_no_activities",
        )

        result = await check_course_completion_and_create_certificate(
            mock_request,
            regular_user.id,
            course_without_activities.id,
            db,
        )

        assert result is False


class TestCertificateLookup:
    @pytest.mark.asyncio
    async def test_get_certificate_by_user_certification_uuid_success(
        self, db, course, regular_user, mock_request
    ):
        certification = _create_certification(
            db,
            course,
            cert_uuid="cert_lookup",
        )
        certificate_user = _create_certificate_user(db, certification, regular_user)

        result = await get_certificate_by_user_certification_uuid(
            mock_request,
            certificate_user.user_certification_uuid,
            regular_user,
            db,
        )

        assert result["certificate_user"].user_certification_uuid == (
            certificate_user.user_certification_uuid
        )
        assert result["certification"].certification_uuid == certification.certification_uuid
        assert result["course"]["course_uuid"] == course.course_uuid

    @pytest.mark.asyncio
    async def test_get_certificate_by_user_certification_uuid_missing_certificate(
        self, db, regular_user, mock_request
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_certificate_by_user_certification_uuid(
                mock_request,
                "missing-user-cert",
                regular_user,
                db,
            )

        assert exc_info.value.status_code == 404
        assert "Certificate not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_get_certificate_by_user_certification_uuid_missing_course(
        self, db, regular_user, mock_request
    ):
        certification = _create_certification(
            db,
            Course(
                id=999,
                name="Ghost Course",
                description="Missing course relation",
                public=True,
                published=True,
                open_to_contributors=False,
                org_id=1,
                course_uuid="course_missing_lookup",
                creation_date="2024-01-01T00:00:00",
                update_date="2024-01-01T00:00:00",
            ),
            cert_uuid="cert_lookup_missing_course",
        )
        certificate_user = _create_certificate_user(db, certification, regular_user)

        with pytest.raises(HTTPException) as exc_info:
            await get_certificate_by_user_certification_uuid(
                mock_request,
                certificate_user.user_certification_uuid,
                regular_user,
                db,
            )

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail


class TestGetAllUserCertificates:
    @pytest.mark.asyncio
    async def test_get_all_user_certificates_success(
        self, db, course, regular_user, mock_request
    ):
        certification = _create_certification(
            db,
            course,
            cert_uuid="cert_all",
        )
        certificate_user = _create_certificate_user(db, certification, regular_user)

        result = await get_all_user_certificates(
            mock_request,
            regular_user,
            db,
        )

        assert len(result) == 1
        assert result[0]["certificate_user"].user_certification_uuid == (
            certificate_user.user_certification_uuid
        )
        assert result[0]["certification"].certification_uuid == certification.certification_uuid
        assert result[0]["course"]["course_uuid"] == course.course_uuid
        assert result[0]["user"]["user_uuid"] == regular_user.user_uuid

    @pytest.mark.asyncio
    async def test_get_all_user_certificates_empty(self, db, admin_user, mock_request):
        result = await get_all_user_certificates(
            mock_request,
            admin_user,
            db,
        )

        assert result == []
