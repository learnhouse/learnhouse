from fastapi import APIRouter
from src.routers import users, auth, houses, orgs, roles, files
from src.routers.courses import chapters, collections, courses,elements


global_router = APIRouter(prefix="/api")


# API Routes
global_router.include_router(users.router, prefix="/users", tags=["users"])
global_router.include_router(auth.router, prefix="/auth", tags=["auth"])
global_router.include_router(houses.router, prefix="/houses", tags=["houses"])
global_router.include_router(orgs.router, prefix="/orgs", tags=["orgs"])
global_router.include_router(roles.router, prefix="/roles", tags=["roles"])
global_router.include_router(files.router, prefix="/files", tags=["files"])
global_router.include_router(courses.router, prefix="/courses", tags=["courses"])
global_router.include_router(chapters.router, prefix="/chapters", tags=["chapters"])
global_router.include_router(elements.router, prefix="/elements", tags=["elements"])
global_router.include_router(collections.router, prefix="/collections", tags=["collections"])

