"""Edge paths of certificate issuance and revocation.

- An IntegrityError on insert that is *not* the duplicate-certificate race
  (no existing row after rollback) must propagate, not be swallowed.
- Revocation analytics are best-effort: a failing tracker never fails the
  revocation itself.
- A complete course with a certification still withholds the certificate
  while a graded assignment is not passed.
"""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from src.db.courses.certifications import CertificateUser, Certifications
from src.services.courses.certifications import (
    check_course_completion_and_create_certificate,
    create_certificate_user,
    revoke_user_certificate,
)

CERT_MODULE = "src.services.courses.certifications"


async def _certification(db, course) -> Certifications:
    certification = Certifications(
        course_id=course.id,
        config={},
        certification_uuid="certification_edge",
        creation_date="2024-01-01T00:00:00",
        update_date="2024-01-01T00:00:00",
    )
    db.add(certification)
    await db.commit()
    await db.refresh(certification)
    return certification


class TestCreateCertificateUserIntegrityError:
    async def test_integrity_error_without_a_winning_row_is_reraised(
        self, db, course, regular_user, mock_request
    ):
        certification = await _certification(db, course)
        boom = IntegrityError("INSERT certificateuser", {}, Exception("fk"))

        with patch.object(db, "commit", new=AsyncMock(side_effect=boom)), patch(
            f"{CERT_MODULE}.track", new_callable=AsyncMock
        ) as track:
            with pytest.raises(IntegrityError):
                await create_certificate_user(
                    mock_request, regular_user.id, certification.id, db,
                    current_user=None,
                )

        track.assert_not_awaited()
        rows = (await db.execute(select(CertificateUser))).scalars().all()
        assert rows == []


class TestRevokeTrackingFailure:
    async def test_tracker_failure_does_not_undo_the_revocation(
        self, db, course, regular_user
    ):
        certification = await _certification(db, course)
        db.add(
            CertificateUser(
                user_id=regular_user.id,
                certification_id=certification.id,
                user_certification_uuid="REV-EDGE-1",
                created_at="2024-01-01T00:00:00",
                updated_at="2024-01-01T00:00:00",
            )
        )
        await db.commit()

        with patch(
            f"{CERT_MODULE}.track",
            new_callable=AsyncMock,
            side_effect=RuntimeError("analytics down"),
        ), patch(f"{CERT_MODULE}.dispatch_webhooks", new_callable=AsyncMock) as hooks:
            revoked = await revoke_user_certificate(regular_user.id, course.id, db)

        assert revoked is True
        hooks.assert_not_awaited()
        remaining = (await db.execute(select(CertificateUser))).scalars().all()
        assert remaining == []


class TestCompletionWithFailedAssignment:
    async def test_certificate_withheld_until_assignments_pass(
        self, db, course, regular_user, mock_request
    ):
        await _certification(db, course)

        with patch(f"{CERT_MODULE}.sync_trailrun_status", new_callable=AsyncMock), patch(
            "src.services.paths.paths.check_paths_for_completed_course",
            new_callable=AsyncMock,
        ), patch(
            f"{CERT_MODULE}.are_course_assignments_passed",
            new_callable=AsyncMock,
            return_value=False,
        ) as passed, patch(
            f"{CERT_MODULE}.create_certificate_user", new_callable=AsyncMock
        ) as create:
            result = await check_course_completion_and_create_certificate(
                mock_request, regular_user.id, course.id, db, is_complete=True
            )

        assert result is False
        passed.assert_awaited_once_with(regular_user.id, course.id, db)
        create.assert_not_awaited()
