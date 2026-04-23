from typing import Union
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.users import AnonymousUser, PublicUser, APITokenUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.services.search.search import search_across_org, SearchResult
from src.services.security.rate_limiting import check_search_rate_limit

router = APIRouter()

@router.get(
    "/org_slug/{org_slug}",
    response_model=SearchResult,
    summary="Search within an organization",
    description="Performs a paginated search across courses, collections, and users within the given organization. Query length and page size are capped to prevent data dumping. Requires authentication.",
    responses={
        200: {"description": "Search results grouped by resource type", "model": SearchResult},
        401: {"description": "Authentication required"},
        403: {"description": "User is not permitted to search this organization"},
        404: {"description": "Organization not found"},
    },
)
async def api_search_across_org(
    request: Request,
    org_slug: str,
    query: str = Query(..., min_length=1, max_length=200, description="Search query"),
    page: int = Query(default=1, ge=1, description="Page number"),
    limit: int = Query(default=10, ge=1, le=50, description="Items per page (max 50)"),
    db_session: Session = Depends(get_db_session),
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
) -> SearchResult:
    """
    Search across courses, collections and users within an organization.

    SECURITY:
    - Maximum limit is 50 to prevent data dumping attacks
    - Query length is limited to 200 characters
    - Requires authentication (no anonymous access to user search)
    """
    # Per-user throttle: search touches full-text indexes and one session can
    # drive significant DB load without a cap. ``detail`` is a plain string
    # so the frontend's generic error path renders it as-is. Resolve API tokens
    # to their creator so token-driven searches don't bypass the throttle.
    caller_id = resolve_acting_user_id(current_user)
    if caller_id and not isinstance(current_user, AnonymousUser):
        is_allowed, retry_after = check_search_rate_limit(caller_id)
        if not is_allowed:
            raise HTTPException(
                status_code=429,
                detail="Too many search queries. Please slow down.",
                headers={"Retry-After": str(retry_after)},
            )

    return await search_across_org(
        request=request,
        current_user=current_user,
        org_slug=org_slug,
        search_query=query,
        db_session=db_session,
        page=page,
        limit=limit
    )