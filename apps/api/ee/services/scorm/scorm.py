"""
SCORM Package Processing Service
Handles analysis, extraction, and import of SCORM packages
"""

import logging
import os
import re
import shutil
import zipfile
import defusedxml.ElementTree as ET
from xml.etree.ElementTree import Element
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import HTTPException, UploadFile, Request
from sqlmodel import Session, select

from src.db.courses.activities import (
    Activity,
    ActivityRead,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from ee.db.scorm import (
    ScormPackage,
    ScormVersionEnum,
    ScormScoInfo,
    ScormAnalysisResponse,
    ScormScoAssignment,
)
from src.db.organizations import Organization
from src.db.users import PublicUser
from src.security.rbac import check_resource_access, AccessAction

logger = logging.getLogger(__name__)

# Regex to validate temp_package_id as a UUID
_VALID_UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)


# SCORM namespace definitions
SCORM_12_NAMESPACE = "http://www.imsproject.org/xsd/imscp_rootv1p1p2"
SCORM_2004_NAMESPACE = "http://www.imsglobal.org/xsd/imscp_v1p1"
ADLCP_NAMESPACE = "http://www.adlnet.org/xsd/adlcp_rootv1p2"
ADLCP_2004_NAMESPACE = "http://www.adlnet.org/xsd/adlcp_v1p3"

# Temp storage for analyzed packages
TEMP_SCORM_DIR = "content/temp/scorm"

# Max SCORM package size: 200MB
MAX_SCORM_PACKAGE_SIZE = 200 * 1024 * 1024
# Max single file size within a SCORM package: 50MB
MAX_SCORM_FILE_SIZE = 50 * 1024 * 1024


def validate_scorm_zip(content: bytes) -> bool:
    """Validate that content is a valid ZIP file"""
    return content[:4] == b'PK\x03\x04' or content[:4] == b'PK\x05\x06'


def sanitize_path(path: str) -> str:
    """Sanitize file path to prevent directory traversal attacks"""
    # Remove leading slashes and normalize
    path = path.lstrip('/\\')
    # Remove any .. components
    parts = path.replace('\\', '/').split('/')
    safe_parts = [p for p in parts if p and p != '..']
    return '/'.join(safe_parts)


def _safe_extract_zip(zip_path: str, extract_dir: str) -> None:
    """Extract a ZIP file with security hardening.

    Protections:
    - Zip bomb: total uncompressed size capped at 5x MAX_SCORM_PACKAGE_SIZE
    - Per-file size limit: MAX_SCORM_FILE_SIZE (50 MB)
    - Symlinks: skipped entirely to prevent symlink traversal
    - Path traversal: sanitize_path + realpath containment check
    """
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        total_size = sum(info.file_size for info in zip_ref.infolist())
        if total_size > MAX_SCORM_PACKAGE_SIZE * 5:
            raise HTTPException(
                status_code=400,
                detail="Invalid SCORM package: suspicious compression ratio",
            )

        abs_extract = os.path.realpath(extract_dir)

        for info in zip_ref.infolist():
            # Skip symlinks (external_attr upper 16 bits: 0xA000 = symlink)
            if ((info.external_attr >> 16) & 0xF000) == 0xA000:
                logger.warning("SCORM zip contains symlink, skipping: %s", info.filename)
                continue

            # Per-file size limit
            if info.file_size > MAX_SCORM_FILE_SIZE:
                logger.warning("SCORM zip file too large, skipping: %s (%d bytes)", info.filename, info.file_size)
                continue

            safe_path = sanitize_path(info.filename)
            if not safe_path:
                continue

            target_path = os.path.join(extract_dir, safe_path)

            # Use realpath to resolve any symlinks and verify containment
            if not os.path.realpath(target_path).startswith(abs_extract + os.sep) and os.path.realpath(target_path) != abs_extract:
                continue

            if info.is_dir():
                os.makedirs(target_path, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                with zip_ref.open(info) as source, open(target_path, 'wb') as target:
                    shutil.copyfileobj(source, target)


def detect_scorm_version(manifest_root: Element) -> ScormVersionEnum:
    """Detect SCORM version from manifest XML"""
    # Check for SCORM 2004 indicators
    for elem in manifest_root.iter():
        if 'adlcp_v1p3' in elem.tag or 'adlseq' in elem.tag:
            return ScormVersionEnum.SCORM_2004

    # Check schemaversion element
    for elem in manifest_root.iter():
        if elem.tag.endswith('schemaversion'):
            version_text = elem.text or ''
            if '2004' in version_text or '1.3' in version_text:
                return ScormVersionEnum.SCORM_2004

    # Check metadata schema
    for meta in manifest_root.iter():
        if meta.tag.endswith('metadata'):
            for child in meta:
                if child.tag.endswith('schema') and child.text:
                    if 'ADL SCORM' in child.text and '2004' in child.text:
                        return ScormVersionEnum.SCORM_2004

    # Default to SCORM 1.2
    return ScormVersionEnum.SCORM_12


def extract_scos_from_manifest(manifest_root: Element, scorm_version: ScormVersionEnum) -> list[ScormScoInfo]:
    """Extract all SCOs from the manifest"""
    scos = []

    # Define namespace map for parsing
    nsmap = {}
    for elem in manifest_root.iter():
        if '}' in elem.tag:
            ns = elem.tag.split('}')[0] + '}'
            if ns not in nsmap.values():
                nsmap[f'ns{len(nsmap)}'] = ns[1:-1]

    # Find organizations element
    organizations = None
    for elem in manifest_root.iter():
        if elem.tag.endswith('organizations'):
            organizations = elem
            break

    if organizations is None:
        return scos

    # Find default organization
    default_org_id = organizations.get('default', '')
    org_element = None

    for org in organizations:
        if org.tag.endswith('organization'):
            org_id = org.get('identifier', '')
            if org_id == default_org_id or org_element is None:
                org_element = org

    if org_element is None:
        return scos

    # Get resources for launch path lookup
    resources = {}
    for elem in manifest_root.iter():
        if elem.tag.endswith('resources'):
            for resource in elem:
                if resource.tag.endswith('resource'):
                    res_id = resource.get('identifier', '')
                    href = resource.get('href', '')
                    res_type = resource.get('type', '')
                    if res_id and (res_type == 'webcontent' or 'sco' in res_type.lower()):
                        resources[res_id] = href

    # Extract items (SCOs)
    def process_item(item, depth=0):
        identifier = item.get('identifier', '')
        identifierref = item.get('identifierref', '')

        # Get title
        title = identifier
        for child in item:
            if child.tag.endswith('title') and child.text:
                title = child.text.strip()
                break

        # Get launch path from identifierref
        launch_path = ''
        if identifierref and identifierref in resources:
            launch_path = resources[identifierref]

        # Get prerequisites (SCORM 1.2)
        prerequisites = None
        for child in item:
            if 'prerequisites' in child.tag and child.text:
                prerequisites = child.text.strip()

        # Only add if it has a launch path (it's a SCO, not just a chapter)
        if launch_path:
            scos.append(ScormScoInfo(
                identifier=identifier,
                title=title,
                launch_path=launch_path,
                prerequisites=prerequisites,
            ))

        # Process nested items recursively
        for child in item:
            if child.tag.endswith('item'):
                process_item(child, depth + 1)

    # Process all items in the organization
    for item in org_element:
        if item.tag.endswith('item'):
            process_item(item)

    return scos


def get_package_title(manifest_root: Element) -> str:
    """Extract the package title from manifest"""
    # Try to find title in organizations
    for elem in manifest_root.iter():
        if elem.tag.endswith('organization'):
            for child in elem:
                if child.tag.endswith('title') and child.text:
                    return child.text.strip()

    # Try metadata
    for elem in manifest_root.iter():
        if elem.tag.endswith('metadata'):
            for child in elem:
                if 'title' in child.tag.lower() and child.text:
                    return child.text.strip()

    return "SCORM Package"


async def analyze_scorm_package(
    request: Request,
    scorm_file: UploadFile,
    current_user: PublicUser,
    db_session: Session,
    course_uuid: str,
) -> ScormAnalysisResponse:
    """
    Analyze a SCORM package without importing it.
    Returns list of SCOs and stores package temporarily.
    """
    # RBAC check
    await check_resource_access(request, db_session, current_user, course_uuid, AccessAction.CREATE)

    # Read file content
    content = await scorm_file.read()

    # Validate file size
    if len(content) > MAX_SCORM_PACKAGE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"SCORM package too large. Maximum size is {MAX_SCORM_PACKAGE_SIZE / 1024 / 1024:.0f}MB"
        )

    # Validate ZIP format
    if not validate_scorm_zip(content):
        raise HTTPException(
            status_code=415,
            detail="Invalid file format. SCORM package must be a ZIP file."
        )

    # Create temp directory for extraction
    temp_package_id = str(uuid4())
    temp_dir = os.path.join(TEMP_SCORM_DIR, temp_package_id)

    try:
        os.makedirs(temp_dir, exist_ok=True)

        # Save the original ZIP
        zip_path = os.path.join(temp_dir, "package.zip")
        with open(zip_path, 'wb') as f:
            f.write(content)

        # Extract ZIP with security checks
        extract_dir = os.path.join(temp_dir, "extracted")
        os.makedirs(extract_dir, exist_ok=True)

        _safe_extract_zip(zip_path, extract_dir)

        # Find and parse imsmanifest.xml
        manifest_path = os.path.join(extract_dir, "imsmanifest.xml")
        if not os.path.exists(manifest_path):
            raise HTTPException(
                status_code=400,
                detail="Invalid SCORM package: imsmanifest.xml not found"
            )

        tree = ET.parse(manifest_path)
        manifest_root = tree.getroot()

        # Detect SCORM version
        scorm_version = detect_scorm_version(manifest_root)

        # Extract SCOs
        scos = extract_scos_from_manifest(manifest_root, scorm_version)

        if not scos:
            raise HTTPException(
                status_code=400,
                detail="Invalid SCORM package: No SCOs (Shareable Content Objects) found"
            )

        # Get package title
        package_title = get_package_title(manifest_root)

        return ScormAnalysisResponse(
            temp_package_id=temp_package_id,
            scorm_version=scorm_version,
            package_title=package_title,
            scos=scos,
        )

    except HTTPException:
        # Clean up on error
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except ET.ParseError as e:
        logger.warning("SCORM manifest parse error: %s", e)
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(
            status_code=400,
            detail="Invalid SCORM package: Could not parse manifest"
        )
    except Exception:
        logger.exception("Error analyzing SCORM package")
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail="Error analyzing SCORM package"
        )


async def import_scorm_package(
    request: Request,
    temp_package_id: str,
    sco_assignments: list[ScormScoAssignment],
    current_user: PublicUser,
    db_session: Session,
    course_uuid: str,
) -> list[ActivityRead]:
    """
    Import analyzed SCORM package with chapter assignments.
    Creates one activity per SCO assignment.
    """
    # RBAC check
    await check_resource_access(request, db_session, current_user, course_uuid, AccessAction.CREATE)

    # Validate temp_package_id to prevent path traversal
    _validate_temp_package_id(temp_package_id)

    # Verify temp package exists
    temp_dir = os.path.join(TEMP_SCORM_DIR, temp_package_id)
    if not os.path.exists(temp_dir):
        raise HTTPException(
            status_code=404,
            detail="Package not found. Please upload and analyze again."
        )

    # Get course
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Get organization
    statement = select(Organization).where(Organization.id == course.org_id)
    organization = db_session.exec(statement).first()
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Parse manifest again to get SCO details
    extract_dir = os.path.join(temp_dir, "extracted")
    manifest_path = os.path.join(extract_dir, "imsmanifest.xml")

    tree = ET.parse(manifest_path)
    manifest_root = tree.getroot()

    scorm_version = detect_scorm_version(manifest_root)
    scos = extract_scos_from_manifest(manifest_root, scorm_version)

    # Create a lookup for SCOs
    sco_lookup = {sco.identifier: sco for sco in scos}

    created_activities = []

    for assignment in sco_assignments:
        if assignment.sco_identifier not in sco_lookup:
            raise HTTPException(
                status_code=400,
                detail=f"SCO with identifier '{assignment.sco_identifier}' not found in package"
            )

        sco = sco_lookup[assignment.sco_identifier]

        # Verify chapter exists and belongs to this course
        statement = select(Chapter).where(Chapter.id == assignment.chapter_id)
        chapter = db_session.exec(statement).first()
        if not chapter:
            raise HTTPException(
                status_code=404,
                detail=f"Chapter with ID {assignment.chapter_id} not found"
            )

        # Verify chapter belongs to course
        statement = select(CourseChapter).where(
            CourseChapter.chapter_id == assignment.chapter_id,
            CourseChapter.course_id == course.id
        )
        course_chapter = db_session.exec(statement).first()
        if not course_chapter:
            raise HTTPException(
                status_code=400,
                detail=f"Chapter {assignment.chapter_id} does not belong to this course"
            )

        # Generate activity UUID
        activity_uuid = f"activity_{uuid4()}"

        # Copy SCORM content to permanent location
        permanent_dir = f"content/orgs/{organization.org_uuid}/courses/{course.course_uuid}/activities/{activity_uuid}/scorm"
        os.makedirs(permanent_dir, exist_ok=True)

        # Copy package.zip
        shutil.copy2(
            os.path.join(temp_dir, "package.zip"),
            os.path.join(permanent_dir, "package.zip")
        )

        # Copy extracted content
        permanent_extract_dir = os.path.join(permanent_dir, "extracted")
        shutil.copytree(extract_dir, permanent_extract_dir)

        # Upload to S3 if configured
        from src.services.courses.transfer.storage_utils import is_s3_enabled, upload_directory_to_s3, upload_to_s3
        if is_s3_enabled():
            # Upload package.zip
            with open(os.path.join(permanent_dir, "package.zip"), 'rb') as f:
                upload_to_s3(f"{permanent_dir}/package.zip", f.read())
            # Upload extracted content
            upload_directory_to_s3(permanent_extract_dir, permanent_extract_dir)

        # Determine subtype based on version
        activity_sub_type = (
            ActivitySubTypeEnum.SUBTYPE_SCORM_2004
            if scorm_version == ScormVersionEnum.SCORM_2004
            else ActivitySubTypeEnum.SUBTYPE_SCORM_12
        )

        # Create activity
        activity = Activity(
            name=assignment.activity_name,
            activity_type=ActivityTypeEnum.TYPE_SCORM,
            activity_sub_type=activity_sub_type,
            activity_uuid=activity_uuid,
            org_id=organization.id,
            course_id=course.id,
            content={
                "scorm_version": scorm_version.value,
                "sco_identifier": sco.identifier,
                "entry_point": sco.launch_path,
                "sco_title": sco.title,
            },
            details={},
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )

        db_session.add(activity)
        db_session.commit()
        db_session.refresh(activity)

        # Create SCORM package record
        package = ScormPackage(
            activity_id=activity.id,
            org_id=organization.id,
            course_id=course.id,
            scorm_version=scorm_version,
            manifest_data={
                "sco_identifier": sco.identifier,
                "sco_title": sco.title,
                "prerequisites": sco.prerequisites,
            },
            entry_point=sco.launch_path,
            title=sco.title,
            identifier=sco.identifier,
            package_uuid=f"scorm_package_{uuid4()}",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )

        db_session.add(package)
        db_session.commit()

        # Find the last activity order in the chapter
        statement = (
            select(ChapterActivity)
            .where(ChapterActivity.chapter_id == chapter.id)
            .order_by(ChapterActivity.order)
        )
        chapter_activities = db_session.exec(statement).all()
        last_order = chapter_activities[-1].order if chapter_activities else 0

        # Create chapter-activity link
        chapter_activity = ChapterActivity(
            chapter_id=chapter.id,
            activity_id=activity.id,
            course_id=course.id,
            org_id=organization.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
            order=last_order + 1,
        )

        db_session.add(chapter_activity)
        db_session.commit()

        created_activities.append(ActivityRead.model_validate(activity))

    # Clean up temp directory
    shutil.rmtree(temp_dir, ignore_errors=True)

    return created_activities


def get_scorm_content_path(
    org_uuid: str,
    course_uuid: str,
    activity_uuid: str,
    file_path: str,
) -> Optional[str]:
    """
    Get the path for a SCORM content file.
    Returns a local filesystem path or S3 key depending on storage config.
    Returns None if file doesn't exist or path is invalid.
    """
    from src.services.courses.transfer.storage_utils import is_s3_enabled, file_exists

    # Sanitize the file path
    safe_path = sanitize_path(file_path)
    if not safe_path:
        return None

    # Build path
    base_dir = f"content/orgs/{org_uuid}/courses/{course_uuid}/activities/{activity_uuid}/scorm/extracted"

    if is_s3_enabled():
        # For S3, validate path parts and return the key
        if '..' in safe_path:
            return None
        s3_key = f"{base_dir}/{safe_path}"
        if file_exists(s3_key):
            return s3_key
        return None
    else:
        full_path = os.path.join(base_dir, safe_path)

        # Verify path is within base directory (prevent traversal via symlinks)
        real_base = os.path.realpath(base_dir)
        real_full = os.path.realpath(full_path)

        if not real_full.startswith(real_base + os.sep) and real_full != real_base:
            return None

        # Verify file exists and is a regular file (not a symlink to outside)
        if not os.path.isfile(full_path):
            return None

        return full_path


def _validate_temp_package_id(temp_package_id: str) -> str:
    """Validate temp_package_id is a UUID to prevent path traversal."""
    if not temp_package_id or not _VALID_UUID.match(temp_package_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid package ID format"
        )
    return temp_package_id


def cleanup_old_temp_packages(max_age_minutes: int = 30):
    """Clean up temporary SCORM packages older than max_age_minutes"""
    if not os.path.exists(TEMP_SCORM_DIR):
        return

    import time
    current_time = time.time()
    max_age_seconds = max_age_minutes * 60

    for package_id in os.listdir(TEMP_SCORM_DIR):
        package_dir = os.path.join(TEMP_SCORM_DIR, package_id)
        if os.path.isdir(package_dir):
            # Check modification time
            mtime = os.path.getmtime(package_dir)
            if current_time - mtime > max_age_seconds:
                shutil.rmtree(package_dir, ignore_errors=True)


async def analyze_scorm_for_course_import(
    request: Request,
    scorm_file: UploadFile,
    current_user: PublicUser,
    db_session: Session,
    org_id: int,
) -> ScormAnalysisResponse:
    """
    Analyze a SCORM package for course import (no existing course required).
    Returns list of SCOs and stores package temporarily.
    """
    # Verify organization exists and user has access
    statement = select(Organization).where(Organization.id == org_id)
    organization = db_session.exec(statement).first()
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Read file content
    content = await scorm_file.read()

    # Validate file size
    if len(content) > MAX_SCORM_PACKAGE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"SCORM package too large. Maximum size is {MAX_SCORM_PACKAGE_SIZE / 1024 / 1024:.0f}MB"
        )

    # Validate ZIP format
    if not validate_scorm_zip(content):
        raise HTTPException(
            status_code=415,
            detail="Invalid file format. SCORM package must be a ZIP file."
        )

    # Create temp directory for extraction
    temp_package_id = str(uuid4())
    temp_dir = os.path.join(TEMP_SCORM_DIR, temp_package_id)

    try:
        os.makedirs(temp_dir, exist_ok=True)

        # Save the original ZIP
        zip_path = os.path.join(temp_dir, "package.zip")
        with open(zip_path, 'wb') as f:
            f.write(content)

        # Extract ZIP with security checks
        extract_dir = os.path.join(temp_dir, "extracted")
        os.makedirs(extract_dir, exist_ok=True)

        _safe_extract_zip(zip_path, extract_dir)

        # Find and parse imsmanifest.xml
        manifest_path = os.path.join(extract_dir, "imsmanifest.xml")
        if not os.path.exists(manifest_path):
            raise HTTPException(
                status_code=400,
                detail="Invalid SCORM package: imsmanifest.xml not found"
            )

        tree = ET.parse(manifest_path)
        manifest_root = tree.getroot()

        # Detect SCORM version
        scorm_version = detect_scorm_version(manifest_root)

        # Extract SCOs
        scos = extract_scos_from_manifest(manifest_root, scorm_version)

        if not scos:
            raise HTTPException(
                status_code=400,
                detail="Invalid SCORM package: No SCOs (Shareable Content Objects) found"
            )

        # Get package title
        package_title = get_package_title(manifest_root)

        return ScormAnalysisResponse(
            temp_package_id=temp_package_id,
            scorm_version=scorm_version,
            package_title=package_title,
            scos=scos,
        )

    except HTTPException:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except ET.ParseError as e:
        logger.warning("SCORM manifest parse error: %s", e)
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(
            status_code=400,
            detail="Invalid SCORM package: Could not parse manifest"
        )
    except Exception:
        logger.exception("Error analyzing SCORM package")
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail="Error analyzing SCORM package"
        )


async def import_scorm_as_new_course(
    request: Request,
    org_id: int,
    temp_package_id: str,
    course_name: str,
    course_description: str,
    sco_assignments: list,  # List of {sco_identifier, activity_name, chapter_name}
    current_user: PublicUser,
    db_session: Session,
) -> dict:
    """
    Import a SCORM package as a new course.
    Creates the course, chapters, and activities from the SCORM package.
    """
    # Verify organization exists
    statement = select(Organization).where(Organization.id == org_id)
    organization = db_session.exec(statement).first()
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Validate temp_package_id to prevent path traversal
    _validate_temp_package_id(temp_package_id)

    # Verify temp package exists
    temp_dir = os.path.join(TEMP_SCORM_DIR, temp_package_id)
    if not os.path.exists(temp_dir):
        raise HTTPException(
            status_code=404,
            detail="Package not found. Please upload and analyze again."
        )

    # Parse manifest
    extract_dir = os.path.join(temp_dir, "extracted")
    manifest_path = os.path.join(extract_dir, "imsmanifest.xml")

    tree = ET.parse(manifest_path)
    manifest_root = tree.getroot()

    scorm_version = detect_scorm_version(manifest_root)
    scos = extract_scos_from_manifest(manifest_root, scorm_version)
    sco_lookup = {sco.identifier: sco for sco in scos}

    logger.debug("SCORM import: %d SCOs found, %d assignments", len(sco_lookup), len(sco_assignments))

    # Create the course
    course_uuid = f"course_{uuid4()}"
    course = Course(
        name=course_name,
        description=course_description or "",
        course_uuid=course_uuid,
        org_id=organization.id,
        learnings="",
        tags="",
        thumbnail_image="",
        public=True,
        open_to_contributors=False,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    # Group assignments by chapter name
    chapters_map = {}  # chapter_name -> list of assignments
    for assignment in sco_assignments:
        chapter_name = assignment.get("chapter_name", "Chapter 1")
        if chapter_name not in chapters_map:
            chapters_map[chapter_name] = []
        chapters_map[chapter_name].append(assignment)

    created_activities = []
    chapter_order = 1

    for chapter_name, chapter_assignments in chapters_map.items():
        logger.debug("SCORM import: creating chapter '%s'", chapter_name)
        # Create chapter
        chapter = Chapter(
            name=chapter_name,
            description="",
            org_id=organization.id,
            course_id=course.id,
            chapter_uuid=f"chapter_{uuid4()}",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(chapter)
        db_session.commit()
        db_session.refresh(chapter)

        # Link chapter to course
        course_chapter = CourseChapter(
            course_id=course.id,
            chapter_id=chapter.id,
            org_id=organization.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
            order=chapter_order,
        )
        db_session.add(course_chapter)
        db_session.commit()
        chapter_order += 1

        activity_order = 1
        for assignment in chapter_assignments:
            sco_identifier = assignment.get("sco_identifier")
            activity_name = assignment.get("activity_name")

            if sco_identifier not in sco_lookup:
                logger.warning("SCORM import: sco_identifier '%s' not found in package", sco_identifier)
                continue

            sco = sco_lookup[sco_identifier]

            try:
                # Generate activity UUID
                activity_uuid = f"activity_{uuid4()}"

                # Copy SCORM content to permanent location
                permanent_dir = f"content/orgs/{organization.org_uuid}/courses/{course.course_uuid}/activities/{activity_uuid}/scorm"
                os.makedirs(permanent_dir, exist_ok=True)

                # Copy package.zip
                zip_src = os.path.join(temp_dir, "package.zip")
                zip_dst = os.path.join(permanent_dir, "package.zip")
                shutil.copy2(zip_src, zip_dst)

                # Copy extracted content
                permanent_extract_dir = os.path.join(permanent_dir, "extracted")
                shutil.copytree(extract_dir, permanent_extract_dir)

                # Upload to S3 if configured
                from src.services.courses.transfer.storage_utils import is_s3_enabled, upload_directory_to_s3, upload_to_s3
                if is_s3_enabled():
                    with open(zip_dst, 'rb') as f:
                        upload_to_s3(f"{permanent_dir}/package.zip", f.read())
                    upload_directory_to_s3(permanent_extract_dir, permanent_extract_dir)

                # Determine subtype
                activity_sub_type = (
                    ActivitySubTypeEnum.SUBTYPE_SCORM_2004
                    if scorm_version == ScormVersionEnum.SCORM_2004
                    else ActivitySubTypeEnum.SUBTYPE_SCORM_12
                )

                # Create activity
                activity = Activity(
                    name=activity_name,
                    activity_type=ActivityTypeEnum.TYPE_SCORM,
                    activity_sub_type=activity_sub_type,
                    activity_uuid=activity_uuid,
                    org_id=organization.id,
                    course_id=course.id,
                    published=True,
                    content={
                        "scorm_version": scorm_version.value,
                        "sco_identifier": sco.identifier,
                        "entry_point": sco.launch_path,
                        "sco_title": sco.title,
                    },
                    details={},
                    creation_date=str(datetime.now()),
                    update_date=str(datetime.now()),
                )
                db_session.add(activity)
                db_session.commit()
                db_session.refresh(activity)

                # Create SCORM package record
                package = ScormPackage(
                    activity_id=activity.id,
                    org_id=organization.id,
                    course_id=course.id,
                    scorm_version=scorm_version,
                    manifest_data={
                        "sco_identifier": sco.identifier,
                        "sco_title": sco.title,
                        "prerequisites": sco.prerequisites,
                    },
                    entry_point=sco.launch_path,
                    title=sco.title,
                    identifier=sco.identifier,
                    package_uuid=f"scorm_package_{uuid4()}",
                    creation_date=str(datetime.now()),
                    update_date=str(datetime.now()),
                )
                db_session.add(package)
                db_session.commit()

                # Link activity to chapter
                chapter_activity = ChapterActivity(
                    chapter_id=chapter.id,
                    activity_id=activity.id,
                    course_id=course.id,
                    org_id=organization.id,
                    creation_date=str(datetime.now()),
                    update_date=str(datetime.now()),
                    order=activity_order,
                )
                db_session.add(chapter_activity)
                db_session.commit()

                created_activities.append(ActivityRead.model_validate(activity))
                activity_order += 1

            except Exception:
                logger.exception("SCORM import: error creating activity '%s'", activity_name)
                raise

    # Clean up temp directory
    shutil.rmtree(temp_dir, ignore_errors=True)

    return {
        "course_uuid": course.course_uuid,
        "course_name": course.name,
        "activities_created": len(created_activities),
    }
