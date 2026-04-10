from fastapi import APIRouter

router = APIRouter()

@router.get("/status")
async def get_ee_status():
    """Return the status of the Enterprise Edition."""
    return {
        "enabled": True,
        "version": "1.1.2",
        "license": "enterprise"
    }

