from fastapi import APIRouter

router = APIRouter()

@router.get(
    "/status",
    summary="Get Enterprise Edition status",
    description="Return the status of the Enterprise Edition build including version and license type.",
    responses={
        200: {"description": "Enterprise Edition status payload with enabled flag, version, and license."},
    },
)
async def get_ee_status():
    """Return the status of the Enterprise Edition."""
    return {
        "enabled": True,
        "version": "1.1.4",
        "license": "enterprise"
    }

