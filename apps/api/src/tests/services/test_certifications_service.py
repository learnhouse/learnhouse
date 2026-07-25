"""Tests for `src.services.courses.certifications`."""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

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
    revoke_user_certificate,
    sync_trailrun_status,
    update_certification,
)
from src.security.rbac import AccessAction
from src.services.analytics import events as analytics_events


async def _create_certification(
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
    await db.commit()
    await db.refresh(certification)
    return certification


async def _create_certificate_user(
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
    await db.commit()
    await db.refresh(certificate_user)
    return certificate_user


async def _create_course_without_certifications(db, org, *, course_id: int, course_uuid: str):
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
    await db.commit()
    await db.refresh(course)
    return course


async def _create_trail_complete_graph(db, org, course, user):
    trail = Trail(
        id=1,
        org_id=org.id,
        user_id=user.id,
        trail_uuid="trail_test",
        creation_date="2024-01-01T00:00:00",
        update_date="2024-01-01T00:00:00",
    )
    db.add(trail)
    await db.commit()
    await db.refresh(trail)

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
    await db.commit()
    await db.refresh(trail_run)

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

    @pytest.mark.asyncio
    async def test_create_certification_rbac_failure_bubbles(
        self, db, course, admin_user, mock_request
    ):
        certification_object = CertificationCreate(course_id=course.id, config={})

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=403, detail="denied"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await create_certification(
                    mock_request,
                    certification_object,
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == 403


class TestGetCertification:
    @pytest.mark.asyncio
    async def test_get_certification_success(
        self, db, course, admin_user, mock_request
    ):
        certification = await _create_certification(db, course, cert_uuid="cert_get")

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
        certification = await _create_certification(
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

    @pytest.mark.asyncio
    async def test_get_certification_rbac_failure_bubbles(
        self, db, course, admin_user, mock_request
    ):
        certification = await _create_certification(db, course, cert_uuid="cert_get_denied")

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=403, detail="denied"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_certification(
                    mock_request,
                    certification.certification_uuid,
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == 403


class TestGetCertificationsByCourse:
    @pytest.mark.asyncio
    async def test_get_certifications_by_course_success(
        self, db, course, admin_user, mock_request
    ):
        certification = await _create_certification(db, course, cert_uuid="cert_by_course")

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
        empty_course = await _create_course_without_certifications(
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

    @pytest.mark.asyncio
    async def test_get_certifications_by_course_missing_course(
        self, db, admin_user, mock_request
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_certifications_by_course(
                mock_request,
                "missing-course",
                admin_user,
                db,
            )

        assert exc_info.value.status_code == 404


class TestUpdateCertification:
    @pytest.mark.asyncio
    async def test_update_certification_success(
        self, db, course, admin_user, mock_request
    ):
        certification = await _create_certification(
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
        certification = await _create_certification(
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

    @pytest.mark.asyncio
    async def test_update_certification_rbac_failure_bubbles(
        self, db, course, admin_user, mock_request
    ):
        certification = await _create_certification(
            db,
            course,
            cert_uuid="cert_update_denied",
        )

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=403, detail="denied"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await update_certification(
                    mock_request,
                    certification.certification_uuid,
                    CertificationUpdate(config={"template": "new"}),
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == 403


class TestDeleteCertification:
    @pytest.mark.asyncio
    async def test_delete_certification_success(
        self, db, course, admin_user, mock_request
    ):
        certification = await _create_certification(db, course, cert_uuid="cert_delete")

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
        assert (
            await db.execute(
                select(Certifications).where(
                    Certifications.certification_uuid == certification.certification_uuid
                )
            )
        ).scalars().first() is None
        mock_access.assert_awaited_once_with(
            mock_request,
            db,
            admin_user,
            course.course_uuid,
            AccessAction.DELETE,
        )

    @pytest.mark.asyncio
    async def test_delete_certification_refuses_when_certificates_awarded(
        self, db, course, admin_user, regular_user, mock_request
    ):
        """CertificateUser cascades on certification delete, so removing the
        template would destroy awarded certificates and break the verification
        links their holders have shared."""
        certification = await _create_certification(db, course, cert_uuid="cert_awarded")
        await _create_certificate_user(db, certification, regular_user)

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await delete_certification(
                    mock_request,
                    certification.certification_uuid,
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == 409
        # The template and the awarded certificate both survive.
        assert (
            await db.execute(
                select(Certifications).where(
                    Certifications.certification_uuid == certification.certification_uuid
                )
            )
        ).scalars().first() is not None
        assert (
            await db.execute(
                select(CertificateUser).where(
                    CertificateUser.certification_id == certification.id
                )
            )
        ).scalars().first() is not None

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
        certification = await _create_certification(
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

    @pytest.mark.asyncio
    async def test_delete_certification_rbac_failure_bubbles(
        self, db, course, admin_user, mock_request
    ):
        certification = await _create_certification(
            db,
            course,
            cert_uuid="cert_delete_denied",
        )

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=403, detail="denied"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await delete_certification(
                    mock_request,
                    certification.certification_uuid,
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == 403


class TestCreateCertificateUser:
    @pytest.mark.asyncio
    async def test_create_certificate_user_success(
        self, db, course, org, admin_user, regular_user, mock_request
    ):
        certification = await _create_certification(db, course, cert_uuid="cert_claim")

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
        # Suffix is now an 8-char hex token (collision-safe), not sequential.
        assert len(parts[3]) == 8
        assert all(c in "0123456789abcdef" for c in parts[3])
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
        certification = await _create_certification(db, course, cert_uuid="cert_duplicate")
        await _create_certificate_user(db, certification, regular_user)

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
        certification = await _create_certification(db, course, cert_uuid="cert_missing_user")

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
        certification = await _create_certification(
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

    @pytest.mark.asyncio
    async def test_create_certificate_user_rbac_failure_bubbles(
        self, db, course, admin_user, regular_user, mock_request
    ):
        certification = await _create_certification(db, course, cert_uuid="cert_claim_denied")

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=403, detail="denied"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await create_certificate_user(
                    mock_request,
                    regular_user.id,
                    certification.id,
                    db,
                    current_user=admin_user,
                )

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_create_certificate_user_missing_certification(
        self, db, mock_request, regular_user
    ):
        with pytest.raises(HTTPException) as exc_info:
            await create_certificate_user(
                mock_request,
                regular_user.id,
                9999,
                db,
                current_user=None,
            )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_create_certificate_user_tracks_failures_are_swallowed(
        self, db, course, admin_user, regular_user, mock_request
    ):
        certification = await _create_certification(db, course, cert_uuid="cert_claim_track")

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.certifications.track",
            new_callable=AsyncMock,
            side_effect=Exception("boom"),
        ), patch(
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

        assert result.certification_id == certification.id
        mock_webhooks.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_create_certificate_user_missing_user_uuid_falls_back_to_user(
        self, db, course, admin_user, mock_request
    ):
        certification = await _create_certification(db, course, cert_uuid="cert_claim_fallback")

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.certifications.track",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.certifications.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            result = await create_certificate_user(
                mock_request,
                admin_user.id,
                certification.id,
                db,
                current_user=admin_user,
            )

        assert result.user_certification_uuid.split("-")[2] == admin_user.user_uuid[-4:]

    @pytest.mark.asyncio
    async def test_create_certificate_user_missing_user_without_current_user_404(
        self, db, mock_request
    ):
        with pytest.raises(HTTPException) as exc_info:
            await create_certificate_user(
                mock_request,
                9999,
                9999,
                db,
                current_user=None,
            )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_duplicate_row_blocked_by_db_constraint(
        self, db, course, regular_user
    ):
        # The unique (user_id, certification_id) constraint must reject a second
        # certificate row for the same user+certification at the DB level — the
        # safety net behind the race-recovery path.
        from sqlalchemy.exc import IntegrityError

        certification = await _create_certification(db, course, cert_uuid="cert_uq")
        await _create_certificate_user(db, certification, regular_user)
        dup = CertificateUser(
            user_id=regular_user.id,
            certification_id=certification.id,
            user_certification_uuid="AB-20240101-TEST-002",
            created_at="2024-01-01T00:00:00",
            updated_at="2024-01-01T00:00:00",
        )
        db.add(dup)
        with pytest.raises(IntegrityError):
            await db.commit()
        await db.rollback()

    @pytest.mark.asyncio
    async def test_create_certificate_user_race_returns_existing(
        self, db, course, admin_user, regular_user, mock_request
    ):
        # Simulate the race: a concurrent request already inserted the winning
        # certificate, but this request's pre-existence SELECT missed it (the
        # race window). Its own INSERT then trips the unique constraint. The
        # service must recover — roll back and return the existing row — instead
        # of 500-ing an already-committed submission.
        certification = await _create_certification(db, course, cert_uuid="cert_race")
        winner = await _create_certificate_user(
            db,
            certification,
            regular_user,
            user_certification_uuid="WIN-20240101-TEST-999",
        )

        # Force the FIRST CertificateUser SELECT (the pre-existence check) to
        # return an empty result so the code proceeds to its own INSERT; later
        # CertificateUser SELECTs (the except-branch fetch) run for real and
        # find the winner.
        real_execute = db.execute
        state = {"cu_selects": 0}

        async def fake_execute(statement, *args, **kwargs):
            text = str(statement).lower()
            is_cu_select = "certificateuser" in text and text.strip().startswith("select")
            if is_cu_select:
                state["cu_selects"] += 1
                if state["cu_selects"] == 1:
                    # Empty result: same query shape but matches nothing.
                    return await real_execute(
                        select(CertificateUser).where(CertificateUser.id == -1)
                    )
            return await real_execute(statement, *args, **kwargs)

        with patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.certifications.track",
            new_callable=AsyncMock,
        ) as mock_track, patch(
            "src.services.courses.certifications.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhooks, patch.object(db, "execute", side_effect=fake_execute):
            result = await create_certificate_user(
                mock_request,
                regular_user.id,
                certification.id,
                db,
                current_user=admin_user,
            )

        # Recovered the winner's row rather than raising.
        assert isinstance(result, CertificateUserRead)
        assert result.user_certification_uuid == winner.user_certification_uuid
        # No duplicate CERTIFICATE_CLAIMED emitted on the losing racer.
        mock_track.assert_not_called()
        mock_webhooks.assert_not_called()


class TestUserCertificatesForCourse:
    @pytest.mark.asyncio
    async def test_get_user_certificates_for_course_success(
        self, db, course, admin_user, regular_user, mock_request
    ):
        certification = await _create_certification(db, course, cert_uuid="cert_user_course")
        await _create_certificate_user(db, certification, regular_user)

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
        empty_course = await _create_course_without_certifications(
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
    async def test_get_user_certificates_for_course_no_certification_ids(
        self, db, course, regular_user, mock_request
    ):
        certification = Certifications(
            id=0,
            course_id=course.id,
            config={},
            certification_uuid="cert_zero_id",
            creation_date="2024-01-01T00:00:00",
            update_date="2024-01-01T00:00:00",
        )
        db.add(certification)
        await db.commit()
        await _create_certificate_user(
            db,
            certification,
            regular_user,
            cert_user_id=2,
            user_certification_uuid="AB-20240101-TEST-002",
        )

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

    @pytest.mark.asyncio
    async def test_get_user_certificates_for_course_missing_course(
        self, db, regular_user, mock_request
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_user_certificates_for_course(
                mock_request,
                "missing-course",
                regular_user,
                db,
            )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_user_certificates_for_course_no_certificate_users(
        self, db, course, regular_user, mock_request
    ):
        await _create_certification(db, course, cert_uuid="cert_user_missing_link")

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
        certification = await _create_certification(
            db,
            course,
            cert_uuid="cert_completion",
        )
        await _create_trail_complete_graph(db, org, course, regular_user)
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
        await db.commit()

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
        created = (
            await db.execute(
                select(CertificateUser).where(
                    CertificateUser.certification_id == certification.id,
                    CertificateUser.user_id == regular_user.id,
                )
            )
        ).scalars().first()
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
    async def test_check_course_completion_promotes_trailrun_status(
        self, db, course, org, regular_user, activity, mock_request
    ):
        # H2: when the last activity is an assignment, nothing but this check
        # would flip the enrollment status. Start the run IN_PROGRESS with the
        # only activity complete, and assert the completion check promotes the
        # TrailRun to COMPLETED (no certification needed for the sync itself).
        trail = Trail(
            id=1,
            org_id=org.id,
            user_id=regular_user.id,
            trail_uuid="trail_promote",
            creation_date="2024-01-01T00:00:00",
            update_date="2024-01-01T00:00:00",
        )
        db.add(trail)
        await db.commit()
        trail_run = TrailRun(
            id=1,
            data={},
            status=StatusEnum.STATUS_IN_PROGRESS,
            trail_id=trail.id,
            course_id=course.id,
            org_id=org.id,
            user_id=regular_user.id,
            creation_date="2024-01-01T00:00:00",
            update_date="2024-01-01T00:00:00",
        )
        db.add(trail_run)
        db.add(
            TrailStep(
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
        )
        await db.commit()

        await check_course_completion_and_create_certificate(
            mock_request, regular_user.id, course.id, db
        )

        await db.refresh(trail_run)
        assert trail_run.status == StatusEnum.STATUS_COMPLETED

    @pytest.mark.asyncio
    async def test_check_course_completion_and_create_certificate_no_activities(
        self, db, org, regular_user, mock_request
    ):
        course_without_activities = await _create_course_without_certifications(
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

    @pytest.mark.asyncio
    async def test_check_course_completion_and_create_certificate_missing_certification(
        self, db, course, org, regular_user, activity, mock_request
    ):
        await _create_trail_complete_graph(db, org, course, regular_user)
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
        await db.commit()

        result = await check_course_completion_and_create_certificate(
            mock_request,
            regular_user.id,
            course.id,
            db,
        )

        assert result is False

    @pytest.mark.asyncio
    async def test_check_course_completion_and_create_certificate_reraises_http_error(
        self, db, course, org, regular_user, activity, mock_request
    ):
        await _create_certification(db, course, cert_uuid="cert_completion_bubbles")
        await _create_trail_complete_graph(db, org, course, regular_user)
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
        await db.commit()

        with patch(
            "src.services.courses.certifications.create_certificate_user",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=500, detail="boom"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await check_course_completion_and_create_certificate(
                    mock_request,
                    regular_user.id,
                    course.id,
                    db,
                )

        assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_check_course_completion_and_create_certificate_duplicate_certificate(
        self, db, course, org, regular_user, mock_request
    ):
        certification = await _create_certification(
            db,
            course,
            cert_uuid="cert_completion_duplicate",
        )
        await _create_trail_complete_graph(db, org, course, regular_user)
        trail_step = TrailStep(
            complete=True,
            teacher_verified=False,
            grade="",
            data={},
            trailrun_id=1,
            trail_id=1,
            activity_id=1,
            course_id=course.id,
            org_id=org.id,
            user_id=regular_user.id,
            creation_date="2024-01-01T00:00:00",
            update_date="2024-01-01T00:00:00",
        )
        db.add(trail_step)
        await db.commit()
        await _create_certificate_user(db, certification, regular_user)

        result = await check_course_completion_and_create_certificate(
            mock_request,
            regular_user.id,
            course.id,
            db,
        )

        assert result is False


class TestCertificateLookup:
    @pytest.mark.asyncio
    async def test_get_certificate_by_user_certification_uuid_success(
        self, db, course, regular_user, mock_request
    ):
        certification = await _create_certification(
            db,
            course,
            cert_uuid="cert_lookup",
        )
        certificate_user = await _create_certificate_user(db, certification, regular_user)

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
        certification = await _create_certification(
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
        certificate_user = await _create_certificate_user(db, certification, regular_user)

        with pytest.raises(HTTPException) as exc_info:
            await get_certificate_by_user_certification_uuid(
                mock_request,
                certificate_user.user_certification_uuid,
                regular_user,
                db,
            )

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_get_certificate_by_user_certification_uuid_missing_certification(
        self, db, course, regular_user, mock_request
    ):
        certification = await _create_certification(
            db,
            course,
            cert_uuid="cert_lookup_missing_cert",
        )
        certificate_user = await _create_certificate_user(db, certification, regular_user)
        cert_obj = await db.get(Certifications, certification.id)
        await db.delete(cert_obj)
        await db.commit()

        with pytest.raises(HTTPException) as exc_info:
            await get_certificate_by_user_certification_uuid(
                mock_request,
                certificate_user.user_certification_uuid,
                regular_user,
                db,
            )

        assert exc_info.value.status_code == 404


class TestGetAllUserCertificates:
    @pytest.mark.asyncio
    async def test_get_all_user_certificates_success(
        self, db, course, regular_user, mock_request
    ):
        certification = await _create_certification(
            db,
            course,
            cert_uuid="cert_all",
        )
        certificate_user = await _create_certificate_user(db, certification, regular_user)

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

    @pytest.mark.asyncio
    async def test_get_all_user_certificates_missing_relations(
        self, db, course, regular_user, mock_request
    ):
        orphan_cert = Certifications(
            id=1,
            course_id=0,
            config={},
            certification_uuid="cert_no_course",
            creation_date="2024-01-01T00:00:00",
            update_date="2024-01-01T00:00:00",
        )
        db.add(orphan_cert)
        await db.commit()
        await _create_certificate_user(
            db,
            orphan_cert,
            regular_user,
            cert_user_id=3,
            user_certification_uuid="AB-20240101-TEST-003",
        )
        orphan_link = CertificateUser(
            id=4,
            user_id=regular_user.id,
            certification_id=9999,
            user_certification_uuid="AB-20240101-TEST-999",
            created_at="2024-01-01T00:00:00",
            updated_at="2024-01-01T00:00:00",
        )
        db.add(orphan_link)
        await db.commit()

        result = await get_all_user_certificates(
            mock_request,
            regular_user,
            db,
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_get_all_user_certificates_missing_course_or_certification(
        self, db, course, regular_user, mock_request
    ):
        certification = await _create_certification(
            db,
            course,
            cert_uuid="cert_all_missing_course",
        )
        await _create_certificate_user(db, certification, regular_user)
        course_obj = await db.get(Course, course.id)
        await db.delete(course_obj)
        await db.commit()

        result = await get_all_user_certificates(
            mock_request,
            regular_user,
            db,
        )

        assert result == []


class TestIsCourseFullyCompleted:
    """Tests for is_course_fully_completed (line 428)."""

    @pytest.mark.asyncio
    async def test_is_course_fully_completed_no_activities_returns_false(
        self, db, org, regular_user
    ):
        """Line 428: course with no ChapterActivity entries -> returns False."""
        from src.services.courses.certifications import is_course_fully_completed

        course_no_acts = await _create_course_without_certifications(
            db,
            org,
            course_id=333,
            course_uuid="course_no_acts_completed",
        )

        result = await is_course_fully_completed(regular_user.id, course_no_acts.id, db)

        assert result is False

    @pytest.mark.asyncio
    async def test_unpublished_activity_does_not_block_completion(
        self, db, org, course, regular_user
    ):
        """A draft (unpublished) activity is never shown to the learner, so it
        must not count toward completion — otherwise the course could never be
        finished and the certificate would be permanently withheld."""
        from src.db.courses.activities import (
            Activity, ActivityTypeEnum, ActivitySubTypeEnum,
        )
        from src.db.courses.chapter_activities import ChapterActivity
        from src.services.courses.certifications import is_course_fully_completed

        published = Activity(
            id=4101, name="Published", activity_uuid="activity_pub_4101",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            published=True, org_id=org.id, course_id=course.id, content={},
            creation_date="2024-01-01", update_date="2024-01-01",
        )
        draft = Activity(
            id=4102, name="Draft", activity_uuid="activity_draft_4102",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            published=False, org_id=org.id, course_id=course.id, content={},
            creation_date="2024-01-01", update_date="2024-01-01",
        )
        db.add(published)
        db.add(draft)
        await db.commit()
        for a in (published, draft):
            db.add(ChapterActivity(
                activity_id=a.id, course_id=course.id, chapter_id=1,
                org_id=org.id, order=1,
                creation_date="2024-01-01", update_date="2024-01-01",
            ))
        # Only the PUBLISHED activity is completed.
        db.add(TrailStep(
            complete=True, teacher_verified=False, grade="", data={},
            trailrun_id=1, trail_id=1, activity_id=published.id,
            course_id=course.id, org_id=org.id, user_id=regular_user.id,
            creation_date="2024-01-01", update_date="2024-01-01",
        ))
        await db.commit()

        # The draft activity is excluded, so the course is fully completed.
        assert await is_course_fully_completed(regular_user.id, course.id, db) is True


class TestSyncTrailrunStatus:
    """Tests for sync_trailrun_status — keeps TrailRun.status aligned with
    actual course completion so enrollment/analytics counts are correct."""

    async def _make_in_progress_run(self, db, org, course, user, *, status=StatusEnum.STATUS_IN_PROGRESS):
        trail = Trail(
            org_id=org.id,
            user_id=user.id,
            trail_uuid="trail_sync_test",
            creation_date="2024-01-01T00:00:00",
            update_date="2024-01-01T00:00:00",
        )
        db.add(trail)
        await db.commit()
        await db.refresh(trail)

        trail_run = TrailRun(
            data={},
            status=status,
            trail_id=trail.id,
            course_id=course.id,
            org_id=org.id,
            user_id=user.id,
            creation_date="2024-01-01T00:00:00",
            update_date="2024-01-01T00:00:00",
        )
        db.add(trail_run)
        await db.commit()
        await db.refresh(trail_run)
        return trail_run

    @pytest.mark.asyncio
    async def test_promotes_to_completed_when_course_fully_completed(
        self, db, org, course, regular_user
    ):
        trail_run = await self._make_in_progress_run(db, org, course, regular_user)

        with patch(
            "src.services.courses.certifications.is_course_fully_completed",
            new_callable=AsyncMock,
            return_value=True,
        ):
            await sync_trailrun_status(regular_user.id, course.id, db)

        await db.refresh(trail_run)
        assert trail_run.status == StatusEnum.STATUS_COMPLETED

    @pytest.mark.asyncio
    async def test_demotes_to_in_progress_when_completion_lost(
        self, db, org, course, regular_user
    ):
        trail_run = await self._make_in_progress_run(
            db, org, course, regular_user, status=StatusEnum.STATUS_COMPLETED
        )

        with patch(
            "src.services.courses.certifications.is_course_fully_completed",
            new_callable=AsyncMock,
            return_value=False,
        ):
            await sync_trailrun_status(regular_user.id, course.id, db)

        await db.refresh(trail_run)
        assert trail_run.status == StatusEnum.STATUS_IN_PROGRESS

    @pytest.mark.asyncio
    async def test_leaves_paused_runs_untouched(
        self, db, org, course, regular_user
    ):
        trail_run = await self._make_in_progress_run(
            db, org, course, regular_user, status=StatusEnum.STATUS_PAUSED
        )

        with patch(
            "src.services.courses.certifications.is_course_fully_completed",
            new_callable=AsyncMock,
            return_value=True,
        ):
            await sync_trailrun_status(regular_user.id, course.id, db)

        await db.refresh(trail_run)
        assert trail_run.status == StatusEnum.STATUS_PAUSED


class TestAreCourseAssignmentsPassed:
    """Certificate eligibility gate: all graded assignments must be passed."""

    async def _make_assignment(self, db, org, course, activity, *, threshold=None, max_grade=100):
        from src.db.courses.assignments import (
            Assignment,
            AssignmentTask,
            AssignmentTaskTypeEnum,
            GradingTypeEnum,
        )
        assignment = Assignment(
            title="Final Exam",
            description="Score at least 80% to pass",
            due_date="2024-01-01",
            published=True,
            grading_type=GradingTypeEnum.PERCENTAGE,
            pass_threshold_percentage=threshold,
            org_id=org.id,
            course_id=course.id,
            chapter_id=1,
            activity_id=activity.id,
            assignment_uuid="assignment_gate_test",
            creation_date="2024-01-01T00:00:00",
            update_date="2024-01-01T00:00:00",
        )
        db.add(assignment)
        await db.commit()
        await db.refresh(assignment)
        task = AssignmentTask(
            title="Q1",
            description="",
            hint="",
            assignment_type=AssignmentTaskTypeEnum.QUIZ,
            contents={},
            max_grade_value=max_grade,
            assignment_id=assignment.id,
            org_id=org.id,
            course_id=course.id,
            chapter_id=1,
            activity_id=activity.id,
            assignment_task_uuid="task_gate_test",
            creation_date="2024-01-01T00:00:00",
            update_date="2024-01-01T00:00:00",
        )
        db.add(task)
        await db.commit()
        return assignment

    async def _make_submission(self, db, assignment, user, *, grade, status):
        from src.db.courses.assignments import AssignmentUserSubmission
        sub = AssignmentUserSubmission(
            submission_status=status,
            grade=grade,
            user_id=user.id,
            assignment_id=assignment.id,
            assignmentusersubmission_uuid="aus_gate_test",
            creation_date="2024-01-01T00:00:00",
            update_date="2024-01-01T00:00:00",
        )
        db.add(sub)
        await db.commit()
        return sub

    @pytest.mark.asyncio
    async def test_no_assignments_passes(self, db, org, course, regular_user):
        from src.services.courses.certifications import are_course_assignments_passed
        assert await are_course_assignments_passed(regular_user.id, course.id, db) is True

    @pytest.mark.asyncio
    async def test_graded_and_passed_returns_true(self, db, org, course, activity, regular_user):
        from src.db.courses.assignments import AssignmentUserSubmissionStatus
        from src.services.courses.certifications import are_course_assignments_passed
        a = await self._make_assignment(db, org, course, activity, threshold=80)
        await self._make_submission(db, a, regular_user, grade=80, status=AssignmentUserSubmissionStatus.GRADED)
        assert await are_course_assignments_passed(regular_user.id, course.id, db) is True

    @pytest.mark.asyncio
    async def test_graded_but_failed_returns_false(self, db, org, course, activity, regular_user):
        from src.db.courses.assignments import AssignmentUserSubmissionStatus
        from src.services.courses.certifications import are_course_assignments_passed
        # 77% against a configured 80% threshold -> failed -> cert withheld.
        a = await self._make_assignment(db, org, course, activity, threshold=80)
        await self._make_submission(db, a, regular_user, grade=77, status=AssignmentUserSubmissionStatus.GRADED)
        assert await are_course_assignments_passed(regular_user.id, course.id, db) is False

    @pytest.mark.asyncio
    async def test_ungraded_submission_returns_false(self, db, org, course, activity, regular_user):
        from src.db.courses.assignments import AssignmentUserSubmissionStatus
        from src.services.courses.certifications import are_course_assignments_passed
        a = await self._make_assignment(db, org, course, activity, threshold=80)
        await self._make_submission(db, a, regular_user, grade=0, status=AssignmentUserSubmissionStatus.SUBMITTED)
        assert await are_course_assignments_passed(regular_user.id, course.id, db) is False

    @pytest.mark.asyncio
    async def test_missing_submission_returns_false(self, db, org, course, activity, regular_user):
        from src.services.courses.certifications import are_course_assignments_passed
        await self._make_assignment(db, org, course, activity, threshold=80)
        assert await are_course_assignments_passed(regular_user.id, course.id, db) is False

    @pytest.mark.asyncio
    async def test_zero_max_assignment_does_not_block(self, db, org, course, activity, regular_user):
        # A 0-point assignment (no gradable tasks) must not permanently block the
        # certificate even with no submission -> vacuously passed.
        from src.services.courses.certifications import are_course_assignments_passed
        await self._make_assignment(db, org, course, activity, threshold=80, max_grade=0)
        assert await are_course_assignments_passed(regular_user.id, course.id, db) is True


class TestRevokeUserCertificate:
    """revoke_user_certificate deletes the certificate row and emits a
    certificate_revoked analytics + webhook event (M8)."""

    @pytest.mark.asyncio
    async def test_revokes_and_emits_event(self, db, course, org, regular_user):
        certification = await _create_certification(db, course, cert_uuid="cert_revoke")
        await _create_certificate_user(
            db, certification, regular_user, user_certification_uuid="REV-1"
        )

        with patch(
            "src.services.courses.certifications.track", new_callable=AsyncMock
        ) as mock_track, patch(
            "src.services.courses.certifications.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhooks:
            revoked = await revoke_user_certificate(
                regular_user.id, course.id, db, reason="regraded_below_threshold"
            )

        assert revoked is True
        # Row is gone.
        remaining = (
            await db.execute(
                select(CertificateUser).where(
                    CertificateUser.certification_id == certification.id,
                    CertificateUser.user_id == regular_user.id,
                )
            )
        ).scalars().first()
        assert remaining is None
        # certificate_revoked emitted with the reason + revoked uuid.
        mock_track.assert_awaited_once()
        assert mock_track.await_args.kwargs["event_name"] == analytics_events.CERTIFICATE_REVOKED
        wh = mock_webhooks.await_args.kwargs
        assert wh["event_name"] == analytics_events.CERTIFICATE_REVOKED
        assert wh["data"]["reason"] == "regraded_below_threshold"
        assert wh["data"]["certificate"]["user_certification_uuid"] == "REV-1"

    @pytest.mark.asyncio
    async def test_noop_when_no_certificate(self, db, course, org, regular_user):
        await _create_certification(db, course, cert_uuid="cert_norevoke")
        with patch(
            "src.services.courses.certifications.track", new_callable=AsyncMock
        ) as mock_track, patch(
            "src.services.courses.certifications.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhooks:
            revoked = await revoke_user_certificate(regular_user.id, course.id, db)
        assert revoked is False
        mock_track.assert_not_called()
        mock_webhooks.assert_not_called()

    @pytest.mark.asyncio
    async def test_noop_when_no_certification(self, db, org, regular_user):
        course = await _create_course_without_certifications(
            db, org, course_id=909, course_uuid="course_no_cert_revoke"
        )
        revoked = await revoke_user_certificate(regular_user.id, course.id, db)
        assert revoked is False


class TestCompletionResultIsComputedOnce:
    """One submit used to run the same completion aggregates three times.

    `check_course_completion_and_create_certificate`, the `sync_trailrun_status`
    it calls, and the caller gating the course_completed event each ran their
    own copy. Callers can now hand the answer down instead.
    """

    @pytest.mark.asyncio
    async def test_passed_in_result_skips_the_recount(self, db, course, org, regular_user):
        with patch(
            "src.services.courses.certifications.is_course_fully_completed",
            new_callable=AsyncMock,
        ) as recount:
            await check_course_completion_and_create_certificate(
                MagicMock(), regular_user.id, course.id, db, is_complete=False
            )
        recount.assert_not_called()

    @pytest.mark.asyncio
    async def test_without_it_the_helper_still_works_out_completion(
        self, db, course, org, regular_user
    ):
        with patch(
            "src.services.courses.certifications.is_course_fully_completed",
            new_callable=AsyncMock,
            return_value=False,
        ) as recount:
            await check_course_completion_and_create_certificate(
                MagicMock(), regular_user.id, course.id, db
            )
        recount.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_sync_trailrun_status_accepts_the_same_result(
        self, db, course, org, regular_user
    ):
        with patch(
            "src.services.courses.certifications.is_course_fully_completed",
            new_callable=AsyncMock,
        ) as recount:
            await sync_trailrun_status(regular_user.id, course.id, db, is_complete=True)
        recount.assert_not_called()
