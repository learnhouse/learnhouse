import uvicorn
import logfire
import sentry_sdk
from fastapi import FastAPI
from config.config import LearnHouseConfig, get_learnhouse_config
from src.core.events.events import shutdown_app, startup_app
from src.router import v1_router
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.gzip import GZipMiddleware
from src.core.ee_hooks import register_ee_middlewares


########################
# Pre-Alpha Version 0.1.0
# Author: @swve
# (c) LearnHouse 2022
########################

# Get LearnHouse Config
learnhouse_config: LearnHouseConfig = get_learnhouse_config()

# Initialize Sentry if configured
if learnhouse_config.general_config.sentry_config.enabled:
    sentry_sdk.init(
        dsn=learnhouse_config.general_config.sentry_config.dsn,
        traces_sample_rate=1.0 if learnhouse_config.general_config.development_mode else 0.1,
        profiles_sample_rate=1.0 if learnhouse_config.general_config.development_mode else 0.1,
        environment="development" if learnhouse_config.general_config.development_mode else "production",
        send_default_pii=False,
    )

# Global Config
app = FastAPI(
    title=learnhouse_config.site_name,
    description=learnhouse_config.site_description,
    docs_url="/docs" if learnhouse_config.general_config.development_mode else None,
    redoc_url="/redoc" if learnhouse_config.general_config.development_mode else None,
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=learnhouse_config.hosting_config.allowed_regexp,
    allow_methods=["*"],
    allow_credentials=True,
    allow_headers=["*"],
)

# Only enable logfire if explicitly configured
if learnhouse_config.general_config.logfire_enabled:
    logfire.configure(console=False, service_name=learnhouse_config.site_name,)
    logfire.instrument_fastapi(app)
    # Instrument database after logfire is configured
    from src.core.events.database import engine
    logfire.instrument_sqlalchemy(engine=engine)

# Gzip Middleware (will add brotli later)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Register EE Middlewares if available
register_ee_middlewares(app)


# Events
app.add_event_handler("startup", startup_app(app))
app.add_event_handler("shutdown", shutdown_app(app))


# Static Files
app.mount("/content", StaticFiles(directory="content"), name="content")

# Global Routes
app.include_router(v1_router)


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=learnhouse_config.hosting_config.port,
        reload=learnhouse_config.general_config.development_mode,
    )


# General Routes
@app.get("/")
async def root():
    return {"Message": "Welcome to LearnHouse ✨"}
