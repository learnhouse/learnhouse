from fastapi import APIRouter, Depends, Request
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.search.search import search_across_org, SearchResult

router = APIRouter()

@router.get("/org_slug/{org_slug}", response_model=SearchResult)
async def api_search_across_org(
    request: Request,
    org_slug: str,
    query: str,
    page: int = 1,
    limit: int = 10,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> SearchResult:
    """
    Search across courses, collections and users within an organization
    """
    return await search_across_org(
        request=request,
        current_user=current_user,
        org_slug=org_slug,
        search_query=query,
        db_session=db_session,
        page=page,
        limit=limit
    ) 