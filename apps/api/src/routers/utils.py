from fastapi import APIRouter, HTTPException, Query
from src.services.utils.link_preview import fetch_link_preview

router = APIRouter()

@router.get("/link-preview")
async def link_preview(url: str = Query(..., description="URL to preview")):
    try:
        data = await fetch_link_preview(url)
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch link preview: {str(e)}") 