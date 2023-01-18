from fastapi import FastAPI

class Settings(FastAPI):
    title="LearnHousse",
    description="LearnHouse is a new open-source platform tailored for learning experiences.",
    version="0.1.0",
    root_path="/"
    docs_url="/docs"
    
async def get_settings() -> Settings:
    return Settings()