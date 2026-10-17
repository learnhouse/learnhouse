from fastapi import APIRouter, Depends, HTTPException, Query
from src.db.users import AnonymousUser, PublicUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.services.security.rate_limiting import check_rate_limit
from src.services.utils.link_preview import fetch_link_preview

router = APIRouter()

# Each preview is an outbound fetch made by the server on the caller's behalf
LINK_PREVIEW_MAX_PER_MINUTE = 60


@router.get(
    "/link-preview",
    summary="Fetch link preview metadata",
    description="Fetches OpenGraph-style preview metadata (title, description, image) for a given URL. Requires an authenticated user.",
    responses={
        200: {"description": "Link preview metadata fetched successfully"},
        400: {"description": "Failed to fetch or parse link preview"},
        401: {"description": "Authentication required"},
    },
)
async def link_preview(
    url: str = Query(..., max_length=2048, description="URL to preview"),
    current_user: PublicUser = Depends(get_current_user),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    is_allowed, _count, retry_after = check_rate_limit(
        key=f"link_preview:{resolve_acting_user_id(current_user)}",
        max_attempts=LINK_PREVIEW_MAX_PER_MINUTE,
        window_seconds=60,
    )
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many link preview requests. Please slow down.",
            headers={"Retry-After": str(retry_after)},
        )

    try:
        data = await fetch_link_preview(url)
        return data
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to fetch link preview")
