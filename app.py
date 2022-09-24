from urllib.request import Request
from fastapi import FastAPI
from src.main import global_router
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi_jwt_auth.exceptions import AuthJWTException

########################
# Pre-Alpha Version 0.1.0
# Author: @swve 
# (c) LearnHouse 2022  
########################

#
# Global Config 
app = FastAPI(
    title="LearnHouse",
    description="LearnHouse is a new open-source platform tailored for learning experiences.",
    version="0.1.0",
    root_path="/"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_credentials=True,
    allow_headers=["*"]
)

#
# Exception Handler
@app.exception_handler(AuthJWTException)
def authjwt_exception_handler(request: Request, exc: AuthJWTException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message}
    )

app.include_router(global_router)

@app.get("/")
async def root():
    return {"Message": "Welcome to LearnHouse ✨"}

