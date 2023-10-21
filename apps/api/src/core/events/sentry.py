from fastapi import FastAPI

import sentry_sdk

from config.config import LearnHouseConfig 

async def init_sentry(app: FastAPI) -> None:
    
    learnhouse_config : LearnHouseConfig = app.learnhouse_config # type: ignore 
    if learnhouse_config.hosting_config.sentry_config is not None:
        sentry_sdk.init(
        dsn=app.learnhouse_config.hosting_config.sentry_config.dsn, # type: ignore
        environment=app.learnhouse_config.hosting_config.sentry_config.environment, # type: ignore
        release=app.learnhouse_config.hosting_config.sentry_config.release, # type: ignore
        traces_sample_rate=1.0,
    )
