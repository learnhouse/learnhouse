from fastapi import APIRouter

router = APIRouter()

@router.get("/status")
async def get_ee_status():
    """Return the status of the Enterprise Edition."""
    return {
        "enabled": True,
        "version": "0.1.0",
        "license": "enterprise"
    }

