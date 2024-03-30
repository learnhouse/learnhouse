from fastapi import APIRouter, Depends
from src.routers import usergroups
from src.routers import blocks, dev, trail, users, auth, orgs, roles
from src.routers.ai import ai
from src.routers.courses import chapters, collections, courses, activities
from src.routers.install import install
from src.services.dev.dev import isDevModeEnabledOrRaise
from src.services.install.install import isInstallModeEnabled


v1_router = APIRouter(prefix="/api/v1")


# API Routes
v1_router.include_router(users.router, prefix="/users", tags=["users"])
v1_router.include_router(usergroups.router, prefix="/usergroups", tags=["usergroups"])
v1_router.include_router(auth.router, prefix="/auth", tags=["auth"])
v1_router.include_router(orgs.router, prefix="/orgs", tags=["orgs"])
v1_router.include_router(roles.router, prefix="/roles", tags=["roles"])
v1_router.include_router(blocks.router, prefix="/blocks", tags=["blocks"])
v1_router.include_router(courses.router, prefix="/courses", tags=["courses"])
v1_router.include_router(chapters.router, prefix="/chapters", tags=["chapters"])
v1_router.include_router(activities.router, prefix="/activities", tags=["activities"])
v1_router.include_router(collections.router, prefix="/collections", tags=["collections"])
v1_router.include_router(trail.router, prefix="/trail", tags=["trail"])
v1_router.include_router(ai.router, prefix="/ai", tags=["ai"])

# Dev Routes
v1_router.include_router(
    dev.router,
    prefix="/dev",
    tags=["dev"],
    dependencies=[Depends(isDevModeEnabledOrRaise)],
)

# Install Routes
v1_router.include_router(
    install.router,
    prefix="/install",
    tags=["install"],
    dependencies=[Depends(isInstallModeEnabled)],
)
