from typing import List
import os
from fastapi import APIRouter, Depends, UploadFile, Form, Request, Query, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel, field_validator
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.courses.course_updates import (
    CourseUpdateCreate,
    CourseUpdateRead,
    CourseUpdateUpdate,
)
from src.db.users import PublicUser
from src.db.courses.courses import (
    CourseCreate,
    CourseRead,
    CourseUpdate,
    FullCourseRead,
    ThumbnailType,
)
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_courses_feature
from src.services.courses.courses import (
    create_course,
    get_course,
    get_course_by_id,
    get_course_meta,
    get_courses_orgslug,
    get_courses_count_orgslug,
    update_course,
    delete_course,
    update_course_thumbnail,
    search_courses,
    get_course_user_rights,
    clone_course,
)
from src.services.courses.updates import (
    create_update,
    delete_update,
    get_updates_by_course_uuid,
    update_update,
)
from src.services.courses.contributors import (
    apply_course_contributor,
    update_course_contributor,
    get_course_contributors,
    add_bulk_course_contributors,
    remove_bulk_course_contributors,
)
from src.db.resource_authors import ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.services.courses.transfer import (
    export_course,
    export_courses_batch,
    analyze_import_package,
    import_courses,
    ImportOptions,
    ImportAnalysisResponse,
    ImportResult,
)


# Request models for batch operations
class BatchExportRequest(BaseModel):
    """
    Request model for batch course export.

    SECURITY: Limited to 20 courses per request to prevent resource exhaustion.
    """
    course_uuids: List[str]

    @field_validator('course_uuids')
    @classmethod
    def validate_course_uuids(cls, v):
        if len(v) > 20:
            raise ValueError('Maximum 20 courses can be exported at once')
        if len(v) == 0:
            raise ValueError('At least one course UUID is required')
        return v


class ImportRequest(BaseModel):
    """
    Request model for course import.

    SECURITY: Limited to 20 courses per import request.
    """
    temp_id: str
    course_uuids: List[str]
    name_prefix: str | None = None
    set_private: bool = True
    set_unpublished: bool = True

    @field_validator('course_uuids')
    @classmethod
    def validate_course_uuids(cls, v):
        if len(v) > 20:
            raise ValueError('Maximum 20 courses can be imported at once')
        if len(v) == 0:
            raise ValueError('At least one course UUID is required')
        return v


router = APIRouter(dependencies=[Depends(require_courses_feature)])


# Static routes must come before dynamic /{course_uuid} routes
@router.post("/export/batch")
async def api_export_courses_batch(
    request: Request,
    batch_request: BatchExportRequest,
    background_tasks: BackgroundTasks,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Export multiple courses as a single ZIP file.

    **Request Body:**
    ```json
    {
        "course_uuids": ["course_uuid_1", "course_uuid_2", ...]
    }
    ```

    **Required Permissions:**
    - Read access to all specified courses
    - All courses must belong to the same organization
    """
    from datetime import datetime

    zip_path = await export_courses_batch(
        request, batch_request.course_uuids, current_user, db_session
    )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"learnhouse-export-batch-{timestamp}.zip"

    # Clean up the temp file after the response is sent
    background_tasks.add_task(os.unlink, zip_path)

    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=filename,
    )


@router.post("/import/analyze")
async def api_analyze_import_package(
    request: Request,
    org_id: int,
    zip_file: UploadFile,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> ImportAnalysisResponse:
    """
    Analyze a LearnHouse course export package for import.

    Upload a ZIP file containing exported courses. The endpoint will:
    1. Validate the package format
    2. Extract and analyze the contents
    3. Return a list of courses available for import
    4. Store the package temporarily for subsequent import

    The returned `temp_id` should be used when calling the import endpoint.
    Temporary packages are automatically cleaned up after 30 minutes.

    **Required Permissions:**
    - Create permission for courses in the organization
    """
    return await analyze_import_package(
        request, zip_file, org_id, current_user, db_session
    )


@router.post("/import")
async def api_import_courses(
    request: Request,
    org_id: int,
    import_request: ImportRequest,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> ImportResult:
    """
    Import courses from an analyzed package.

    **Request Body:**
    ```json
    {
        "temp_id": "uuid-from-analyze-step",
        "course_uuids": ["course_uuid_1", "course_uuid_2"],
        "name_prefix": "Imported",
        "set_private": true,
        "set_unpublished": true
    }
    ```

    **Options:**
    - `course_uuids`: Which courses to import from the package
    - `name_prefix`: Optional prefix to add to imported course names
    - `set_private`: Make imported courses private (default: true)
    - `set_unpublished`: Make imported courses unpublished (default: true)

    **Required Permissions:**
    - Create permission for courses in the organization
    """
    options = ImportOptions(
        course_uuids=import_request.course_uuids,
        name_prefix=import_request.name_prefix,
        set_private=import_request.set_private,
        set_unpublished=import_request.set_unpublished,
    )

    return await import_courses(
        request, import_request.temp_id, org_id, options, current_user, db_session
    )


@router.post("/")
async def api_create_course(
    request: Request,
    org_id: int,
    name: str = Form(),
    description: str = Form(),
    public: bool = Form(),
    learnings: str = Form(None),
    tags: str = Form(None),
    about: str = Form(),
    thumbnail_type: ThumbnailType = Form(default=ThumbnailType.IMAGE),
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
    thumbnail: UploadFile | None = None,
) -> CourseRead:
    """
    Create new Course
    """
    course = CourseCreate(
        name=name,
        description=description,
        org_id=org_id,
        public=public,
        thumbnail_type=thumbnail_type,
        thumbnail_image="",
        thumbnail_video="",
        about=about,
        learnings=learnings,
        tags=tags,
        open_to_contributors=False,
    )
    return await create_course(
        request, org_id, course, current_user, db_session, thumbnail, thumbnail_type
    )


@router.put("/{course_uuid}/thumbnail")
async def api_create_course_thumbnail(
    request: Request,
    course_uuid: str,
    thumbnail_type: ThumbnailType = Form(default=ThumbnailType.IMAGE),
    thumbnail: UploadFile | None = None,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CourseRead:
    """
    Update Course Thumbnail (Image or Video)
    """
    return await update_course_thumbnail(
        request, course_uuid, current_user, db_session, thumbnail, thumbnail_type
    )


@router.get("/{course_uuid}")
async def api_get_course(
    request: Request,
    course_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CourseRead:
    """
    Get single Course by course_uuid
    """
    return await get_course(
        request, course_uuid, current_user=current_user, db_session=db_session
    )


@router.get("/id/{course_id}")
async def api_get_course_by_id(
    request: Request,
    course_id: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CourseRead:
    """
    Get single Course by id
    """
    return await get_course_by_id(
        request, course_id, current_user=current_user, db_session=db_session
    )


@router.get("/{course_uuid}/meta")
async def api_get_course_meta(
    request: Request,
    course_uuid: str,
    with_unpublished_activities: bool = False,
    slim: bool = False,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> FullCourseRead:
    """
    Get single Course Metadata (chapters, activities) by course_uuid.
    Use slim=true to exclude heavy activity content/details (useful for navigation).
    """
    return await get_course_meta(
        request, course_uuid, with_unpublished_activities, current_user=current_user, db_session=db_session, slim=slim
    )


@router.get("/org_slug/{org_slug}/page/{page}/limit/{limit}")
async def api_get_course_by_orgslug(
    request: Request,
    page: int,
    limit: int,
    org_slug: str,
    include_unpublished: bool = False,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[CourseRead]:
    """
    Get courses by page and limit
    """
    return await get_courses_orgslug(
        request, current_user, org_slug, db_session, page, limit, include_unpublished
    )


@router.get("/org_slug/{org_slug}/count")
async def api_get_courses_count(
    request: Request,
    org_slug: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> int:
    """
    Get total count of courses for an organization
    """
    return await get_courses_count_orgslug(
        request, current_user, org_slug, db_session
    )


@router.get("/org_slug/{org_slug}/search")
async def api_search_courses(
    request: Request,
    org_slug: str,
    query: str = Query(..., min_length=1, max_length=200, description="Search query"),
    page: int = Query(default=1, ge=1, description="Page number"),
    limit: int = Query(default=10, ge=1, le=50, description="Items per page (max 50)"),
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[CourseRead]:
    """
    Search courses by title and description.

    SECURITY:
    - Maximum limit is 50 to prevent data dumping
    - Query length limited to 200 characters
    - Uses parameterized SQL queries (SQL injection protected)
    """
    return await search_courses(
        request, current_user, org_slug, query, db_session, page, limit
    )


@router.put("/{course_uuid}")
async def api_update_course(
    request: Request,
    course_object: CourseUpdate,
    course_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CourseRead:
    """
    Update Course by course_uuid
    """
    return await update_course(
        request, course_object, course_uuid, current_user, db_session
    )


@router.delete("/{course_uuid}")
async def api_delete_course(
    request: Request,
    course_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Delete Course by ID
    """

    return await delete_course(request, course_uuid, current_user, db_session)


@router.post("/{course_uuid}/clone")
async def api_clone_course(
    request: Request,
    course_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CourseRead:
    """
    Clone a course with all its chapters, activities, blocks, and files.

    Creates a complete copy of the course including:
    - Course metadata (name, description, about, learnings, tags, SEO, etc.)
    - Thumbnail files
    - Chapters with their ordering
    - Activities with their files (videos, documents, PDFs)
    - Dynamic activity blocks with their files (images, videos, PDFs)

    The cloned course will:
    - Have a new course_uuid
    - Have "(Copy)" appended to the name
    - Be set to private (public=False) by default
    - Have the current user as the creator

    **Required Permissions:**
    - Read access to the source course
    - Create permission for courses in the organization
    """
    return await clone_course(request, course_uuid, current_user, db_session)


@router.get("/{course_uuid}/export")
async def api_export_course(
    request: Request,
    course_uuid: str,
    background_tasks: BackgroundTasks,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Export a single course as a ZIP file.

    The exported package contains:
    - Course metadata (name, description, about, learnings, tags, SEO, etc.)
    - Thumbnail files
    - Chapters with their ordering
    - Activities with their files (videos, documents, PDFs)
    - Dynamic activity blocks with their files (images, videos, PDFs)

    The ZIP file follows the LearnHouse export format and can be imported
    into any LearnHouse instance.

    **Required Permissions:**
    - Read access to the course
    """
    from datetime import datetime

    zip_path = await export_course(request, course_uuid, current_user, db_session)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"learnhouse-export-{course_uuid}-{timestamp}.zip"

    # Clean up the temp file after the response is sent
    background_tasks.add_task(os.unlink, zip_path)

    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=filename,
    )


@router.post("/{course_uuid}/apply-contributor")
async def api_apply_course_contributor(
    request: Request,
    course_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Apply to be a contributor for a course
    """
    return await apply_course_contributor(request, course_uuid, current_user, db_session)


@router.get("/{course_uuid}/updates")
async def api_get_course_updates(
    request: Request,
    course_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[CourseUpdateRead]:
    """
    Get Course Updates by course_uuid
    """

    return await get_updates_by_course_uuid(
        request, course_uuid, current_user, db_session
    )


@router.post("/{course_uuid}/updates")
async def api_create_course_update(
    request: Request,
    course_uuid: str,
    update_object: CourseUpdateCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CourseUpdateRead:
    """
    Create new Course Update
    """

    return await create_update(
        request, course_uuid, update_object, current_user, db_session
    )


@router.put("/{course_uuid}/update/{courseupdate_uuid}")
async def api_update_course_update(
    request: Request,
    course_uuid: str,
    courseupdate_uuid: str,
    update_object: CourseUpdateUpdate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CourseUpdateRead:
    """
    Update Course Update by courseupdate_uuid
    """

    return await update_update(
        request, courseupdate_uuid, update_object, current_user, db_session
    )


@router.delete("/{course_uuid}/update/{courseupdate_uuid}")
async def api_delete_course_update(
    request: Request,
    course_uuid: str,
    courseupdate_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Delete Course Update by courseupdate_uuid
    """

    return await delete_update(request, courseupdate_uuid, current_user, db_session)


@router.get("/{course_uuid}/contributors")
async def api_get_course_contributors(
    request: Request,
    course_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Get all contributors for a course
    """
    return await get_course_contributors(request, course_uuid, current_user, db_session)


@router.put("/{course_uuid}/contributors/{contributor_user_id}")
async def api_update_course_contributor(
    request: Request,
    course_uuid: str,
    contributor_user_id: int,
    authorship: ResourceAuthorshipEnum,
    authorship_status: ResourceAuthorshipStatusEnum,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Update a course contributor's role and status
    Only administrators can perform this action
    """
    return await update_course_contributor(
        request,
        course_uuid,
        contributor_user_id,
        authorship,
        authorship_status,
        current_user,
        db_session
    )


@router.post("/{course_uuid}/bulk-add-contributors")
async def api_add_bulk_course_contributors(
    request: Request,
    course_uuid: str,
    usernames: List[str],
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Add multiple contributors to a course by their usernames
    Only administrators can perform this action
    """
    return await add_bulk_course_contributors(
        request,
        course_uuid,
        usernames,
        current_user,
        db_session
    )


@router.put("/{course_uuid}/bulk-remove-contributors")
async def api_remove_bulk_course_contributors(
    request: Request,
    course_uuid: str,
    usernames: List[str],
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Remove multiple contributors from a course by their usernames
    """
    return await remove_bulk_course_contributors(
        request, course_uuid, usernames, current_user, db_session
    )


@router.get("/{course_uuid}/rights")
async def api_get_course_user_rights(
    request: Request,
    course_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    """
    Get detailed user rights for a specific course.
    
    This endpoint returns comprehensive rights information that can be used
    by the UI to enable/disable features based on user permissions.
    
    
    
    **Response Structure:**
    ```json
    {
        "course_uuid": "course_123",
        "user_id": 456,
        "is_anonymous": false,
        "permissions": {
            "read": true,
            "create": false,
            "update": true,
            "delete": false,
            "create_content": true,
            "update_content": true,
            "delete_content": true,
            "manage_contributors": true,
            "manage_access": true,
            "grade_assignments": true,
            "mark_activities_done": true,
            "create_certifications": true
        },
        "ownership": {
            "is_owner": true,
            "is_creator": true,
            "is_maintainer": false,
            "is_contributor": false,
            "authorship_status": "ACTIVE"
        },
        "roles": {
            "is_admin": false,
            "is_maintainer_role": false,
            "is_instructor": true,
            "is_user": true
        }
    }
    ```
    
    **Permissions Explained:**
    - `read`: Can read the course content
    - `create`: Can create new courses (instructor role or higher)
    - `update`: Can update course settings (title, description, etc.)
    - `delete`: Can delete the course
    - `create_content`: Can create activities, assignments, chapters, etc.
    - `update_content`: Can update course content
    - `delete_content`: Can delete course content
    - `manage_contributors`: Can add/remove contributors
    - `manage_access`: Can change course access settings (public, open_to_contributors)
    - `grade_assignments`: Can grade student assignments
    - `mark_activities_done`: Can mark activities as done for other users
    - `create_certifications`: Can create course certifications
    
    **Ownership Information:**
    - `is_owner`: Is course owner (CREATOR, MAINTAINER, or CONTRIBUTOR)
    - `is_creator`: Is course creator
    - `is_maintainer`: Is course maintainer
    - `is_contributor`: Is course contributor
    - `authorship_status`: Current authorship status (ACTIVE, PENDING, INACTIVE)
    
    **Role Information:**
    - `is_admin`: Has admin role (role 1)
    - `is_maintainer_role`: Has maintainer role (role 2)
    - `is_instructor`: Has instructor role (role 3)
    - `is_user`: Has basic user role (role 4)
    
    **Security Notes:**
    - Returns rights based on course ownership and user roles
    - Safe to expose to UI as it only returns permission information
    - Anonymous users can only read public courses
    - All permissions are calculated based on current user context
    """
    return await get_course_user_rights(request, course_uuid, current_user, db_session)
