from fastapi import APIRouter, Depends, HTTPException, Query
from src.db.users import AnonymousUser, PublicUser
from src.security.auth import get_current_user
from src.services.utils.link_preview import fetch_link_preview

router = APIRouter()


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
    url: str = Query(..., description="URL to preview"),
    current_user: PublicUser = Depends(get_current_user),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        data = await fetch_link_preview(url)
        return data
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to fetch link preview")
