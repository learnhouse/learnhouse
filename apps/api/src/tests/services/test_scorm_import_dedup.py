"""
SCORM import storage: a multi-SCO package must be extracted ONCE into a shared
content root, not duplicated per SCO. Skips cleanly when EE is absent.
"""

import glob
import io
import uuid
import zipfile

import pytest
from sqlmodel import select

scorm = pytest.importorskip("ee.services.scorm.scorm")
from ee.db.scorm import ScormScoAssignment  # noqa: E402

from src.db.courses.activities import Activity, ActivityTypeEnum  # noqa: E402
from src.tests.fixtures import scorm_packages as pkg  # noqa: E402


def _stage_temp_package(tmp_path, zip_bytes) -> str:
    tid = str(uuid.uuid4())
    base = tmp_path / "content" / "temp" / "scorm" / tid
    base.mkdir(parents=True)
    (base / "package.zip").write_bytes(zip_bytes)
    extract = base / "extracted"
    extract.mkdir()
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        zf.extractall(extract)
    return tid


class TestMultiScoDedup:
    async def test_multi_sco_shares_one_extracted_root(
        self, db, org, course, chapter, admin_user, mock_request, monkeypatch, tmp_path
    ):
        monkeypatch.chdir(tmp_path)
        tid = _stage_temp_package(tmp_path, pkg.valid_12_multi())
        assignments = [
            ScormScoAssignment(sco_identifier=f"ITEM-{i}", chapter_id=chapter.id,
                               activity_name=f"SCO {i}")
            for i in (1, 2, 3)
        ]

        created = await scorm.import_scorm_package(
            mock_request, tid, assignments, admin_user, db, course.course_uuid)
        assert len(created) == 3

        acts = (await db.execute(
            select(Activity).where(Activity.activity_type == ActivityTypeEnum.TYPE_SCORM)
        )).scalars().all()
        pkg_uuids = {a.content.get("scorm_package_uuid") for a in acts}
        assert len(pkg_uuids) == 1 and None not in pkg_uuids

        # Exactly ONE shared extracted tree on disk (not one per SCO)...
        shared = glob.glob(str(tmp_path / "content/orgs/*/courses/*/scorm/*/extracted"))
        assert len(shared) == 1, shared
        # ...and NO legacy per-activity extracted trees.
        per_activity = glob.glob(
            str(tmp_path / "content/orgs/*/courses/*/activities/*/scorm/extracted"))
        assert per_activity == []

        # Content resolves through the shared package layout.
        puid = pkg_uuids.pop()
        path = scorm.get_scorm_content_path(
            org.org_uuid, course.course_uuid, acts[0].activity_uuid,
            "lesson1/index.html", package_uuid=puid)
        assert path is not None and path.endswith("lesson1/index.html")

        # Temp package is cleaned up after a successful import.
        assert not (tmp_path / "content" / "temp" / "scorm" / tid).exists()
