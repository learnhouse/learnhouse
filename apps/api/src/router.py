from fastapi import APIRouter, Depends
from src.routers import analytics as analytics_router_module
from src.routers import code_execution
from src.routers import health
from src.routers import instance
from src.routers import plans
from src.routers import usergroups
from src.routers import dev, trail, users, auth, orgs, roles, search
from src.routers import stream
from src.routers import api_tokens
from src.routers.ai import ai, magicblocks, courseplanning, rag
from src.routers.boards import boards_playground
from src.routers.orgs import ai_credits
from src.routers.orgs import custom_domains
from src.routers.orgs import packs
from src.routers.courses import chapters, collections, courses, assignments, certifications
from src.routers.communities import communities as communities_router_module
from src.routers.communities import discussions as discussions_router_module
from src.routers.courses.activities import activities, blocks
from src.routers.podcasts import podcasts as podcasts_router_module
from src.routers.podcasts import episodes as episodes_router_module
from src.routers.boards import boards as boards_router_module
from src.routers.playgrounds import playgrounds as playgrounds_router_module
from src.routers.playgrounds import playgrounds_generator as playgrounds_generator_router
from src.core.ee_hooks import register_ee_routers
from src.services.dev.dev import isDevModeEnabledOrRaise
from src.routers.utils import router as utils_router
from src.security.auth import get_current_user
from src.security.api_token_utils import require_non_api_token_user
from src.security.features_utils.plan_check import require_plan, require_plan_for_boards, require_plan_for_certifications, require_plan_for_community, require_plan_for_usergroups, require_plan_for_playgrounds


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
v1_router.include_router(
    usergroups.router,
    prefix="/usergroups",
    tags=["usergroups"],
    dependencies=[Depends(require_plan_for_usergroups("standard", "User Groups"))]
)
v1_router.include_router(auth.router, prefix="/auth", tags=["auth"])
v1_router.include_router(
    orgs.router,
    prefix="/orgs",
    tags=["orgs"],
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(
    ai_credits.router,
    prefix="/orgs",
    tags=["ai-credits"],
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
    dependencies=[Depends(get_non_api_token_user), Depends(require_plan("pro", "API Access"))]
)
v1_router.include_router(
    custom_domains.router,
    prefix="/orgs",
    tags=["custom-domains"],
    dependencies=[Depends(get_non_api_token_user), Depends(require_plan("standard", "Custom Domains"))]
)
# Public domain resolution endpoint (no auth required)
v1_router.include_router(
    custom_domains.public_router,
    prefix="/orgs",
    tags=["custom-domains"],
)
# Internal domain listing endpoint (protected by internal key)
v1_router.include_router(
    custom_domains.internal_router,
    prefix="/internal",
    tags=["custom-domains-internal"],
)
# Internal packs endpoint (protected by platform key)
v1_router.include_router(
    packs.internal_router,
    prefix="/internal/packs",
    tags=["packs-internal"],
)
# Org-facing packs endpoint (user auth, admin only)
v1_router.include_router(
    packs.router,
    prefix="/orgs",
    tags=["packs"],
    dependencies=[Depends(get_non_api_token_user)],
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
    communities_router_module.router,
    prefix="/communities",
    tags=["communities"],
    dependencies=[Depends(require_plan_for_community("standard", "Communities"))]
)
v1_router.include_router(
    discussions_router_module.router,
    tags=["discussions"],
    dependencies=[Depends(require_plan_for_community("standard", "Communities"))]
)
v1_router.include_router(
    podcasts_router_module.router,
    prefix="/podcasts",
    tags=["podcasts"]
)
v1_router.include_router(
    episodes_router_module.router,
    prefix="/podcasts",
    tags=["podcasts", "episodes"]
)
v1_router.include_router(
    certifications.router,
    prefix="/certifications",
    tags=["certifications"],
    dependencies=[Depends(require_plan_for_certifications("pro", "Certifications"))]
)
v1_router.include_router(
    boards_router_module.router,
    prefix="/boards",
    tags=["boards"],
    dependencies=[Depends(get_non_api_token_user), Depends(require_plan_for_boards("pro", "Boards"))]
)
v1_router.include_router(
    boards_router_module.internal_router,
    prefix="/boards",
    tags=["boards-internal"],
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
v1_router.include_router(
    magicblocks.router,
    prefix="/ai",
    tags=["ai", "magicblocks"],
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(
    courseplanning.router,
    prefix="/ai",
    tags=["ai", "courseplanning"],
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(
    rag.router,
    prefix="/ai",
    tags=["ai", "rag"],
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(
    boards_playground.router,
    prefix="/boards",
    tags=["boards", "boards-playground"],
    dependencies=[Depends(get_non_api_token_user), Depends(require_plan_for_boards("pro", "Boards"))]
)
v1_router.include_router(
    playgrounds_router_module.router,
    prefix="/playgrounds",
    tags=["playgrounds"],
    dependencies=[Depends(get_non_api_token_user), Depends(require_plan_for_playgrounds("pro", "Playgrounds"))]
)
v1_router.include_router(
    playgrounds_generator_router.router,
    prefix="/playgrounds",
    tags=["playgrounds", "playgrounds-generator"],
    dependencies=[Depends(get_non_api_token_user), Depends(require_plan_for_playgrounds("pro", "Playgrounds"))]
)

v1_router.include_router(
    analytics_router_module.router,
    prefix="/analytics",
    tags=["analytics"],
    dependencies=[Depends(get_non_api_token_user)],
)

v1_router.include_router(
    code_execution.router,
    prefix="/code",
    tags=["code-execution"],
    dependencies=[Depends(get_non_api_token_user)],
)

# Instance info (public, no auth)
v1_router.include_router(instance.router, prefix="/instance", tags=["instance"])

# Plan limits (public, no auth — used by frontend pricing pages)
v1_router.include_router(plans.router, prefix="/plans", tags=["plans"])

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
