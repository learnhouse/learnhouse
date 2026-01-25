from fastapi import APIRouter, Depends
from src.routers import health
from src.routers import usergroups
from src.routers import dev, trail, users, auth, orgs, roles, search
from src.routers import stream
from src.routers import api_tokens
from src.routers.ai import ai
from src.routers.courses import chapters, collections, courses, assignments, certifications
from src.routers.courses.activities import activities, blocks
from src.core.ee_hooks import register_ee_routers
from src.services.dev.dev import isDevModeEnabledOrRaise
from src.routers.utils import router as utils_router
from src.security.auth import get_current_user
from src.security.api_token_utils import require_non_api_token_user


v1_router = APIRouter(prefix="/api/v1")

# Helper dependency to reject API token access
async def get_non_api_token_user(user = Depends(get_current_user)):
    """Dependency that rejects API token access."""
    return await require_non_api_token_user(user)

# API Routes
v1_router.include_router(
    users.router,
    prefix="/users",
    tags=["users"],
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(usergroups.router, prefix="/usergroups", tags=["usergroups"])
v1_router.include_router(auth.router, prefix="/auth", tags=["auth"])
v1_router.include_router(
    orgs.router,
    prefix="/orgs",
    tags=["orgs"],
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(
    roles.router,
    prefix="/roles",
    tags=["roles"],
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(
    api_tokens.router,
    prefix="/orgs",
    tags=["api-tokens"],
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(
    blocks.router,
    prefix="/blocks",
    tags=["blocks"],
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(courses.router, prefix="/courses", tags=["courses"])
v1_router.include_router(search.router, prefix="/search", tags=["search"])
v1_router.include_router(
    assignments.router,
    prefix="/assignments",
    tags=["assignments"],
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(chapters.router, prefix="/chapters", tags=["chapters"])
v1_router.include_router(activities.router, prefix="/activities", tags=["activities"])
v1_router.include_router(
    collections.router, prefix="/collections", tags=["collections"]
)
v1_router.include_router(
    certifications.router, prefix="/certifications", tags=["certifications"]
)
v1_router.include_router(
    trail.router,
    prefix="/trail",
    tags=["trail"],
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(
    ai.router,
    prefix="/ai",
    tags=["ai"],
    dependencies=[Depends(get_non_api_token_user)]
)

# Register EE Routers if available
register_ee_routers(v1_router)

v1_router.include_router(
    health.router,
    prefix="/health",
    tags=["health"],
    dependencies=[Depends(get_non_api_token_user)]
)

# Dev Routes
v1_router.include_router(
    dev.router,
    prefix="/dev",
    tags=["dev"],
    dependencies=[Depends(isDevModeEnabledOrRaise), Depends(get_non_api_token_user)],
)

v1_router.include_router(
    utils_router,
    prefix="/utils",
    tags=["utils"],
    dependencies=[Depends(get_non_api_token_user)]
)

# Video Streaming Routes
v1_router.include_router(
    stream.router,
    prefix="/stream",
    tags=["stream"],
    dependencies=[Depends(get_non_api_token_user)]
)
