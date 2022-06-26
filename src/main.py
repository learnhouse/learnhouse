from .routers import users
from fastapi import APIRouter
from .routers import users, auth, houses
from starlette.responses import FileResponse 


global_router = APIRouter(prefix="/api")


## API Routes
global_router.include_router(users.router, prefix="/users", tags=["users"])
global_router.include_router(auth.router, prefix="/auth", tags=["auth"])
global_router.include_router(houses.router, prefix="/houses", tags=["houses"])





