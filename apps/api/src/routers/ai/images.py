"""AI image generation endpoints (Google "nano banana").

Backs the shared AIImagePicker used across every image-upload surface. Follows
the same guard/credit ordering as the other AI routers: resolve org → org
membership → rate limit → reserve credit → generate → refund on failure.

Refinement reads the prior image server-side by ``source_file_id`` (a client
base64 data URL is only a fallback), so the edit is reliable without a client
re-fetch. Durable history rows are grouped by ``session_uuid`` to reconstruct the
thread — so no Redis session is needed for images (the hybrid model's Redis half
is used by the streaming quiz/assignment refine chats instead).
"""

import base64
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.ai.generations import AIGenerationKind
from src.db.organizations import Organization
from src.db.users import PublicUser
from src.security.auth import get_authenticated_user
from src.security.features_utils.usage import refund_ai_credit, reserve_ai_credit
from src.security.org_auth import is_org_member
from src.services.ai.generations import (
    delete_generation,
    list_generations,
    record_generation,
)
from src.services.ai.image.generator import OUTPUT_EXT, generate_image
from src.services.ai.llm import AINotConfiguredError
from src.services.ai.schemas.image import (
    AIImageHistoryItem,
    GenerateImageRequest,
    GenerateImageResponse,
)
from src.services.security.rate_limiting import enforce_ai_rate_limit
from src.services.utils.upload_content import read_content, upload_content

logger = logging.getLogger(__name__)

router = APIRouter()

# Generating an image is markedly more expensive than a text turn.
IMAGE_CREDIT_COST = 5

AI_IMAGE_DIR = "ai_images"


def _media_path(org_uuid: str, file_id: str) -> str:
    """Relative content path; the frontend prepends the media base to build a URL."""
    return f"content/orgs/{org_uuid}/{AI_IMAGE_DIR}/{file_id}"


def _validate_file_id(file_id: str) -> None:
    """Reject any file_id that could escape the org's ai_images directory.

    A single shared guard so the read-bytes and refine paths cannot drift. This
    matters most in S3/R2 mode, where the key is built by string interpolation.
    """
    if not file_id or "/" in file_id or "\\" in file_id or ".." in file_id or "\x00" in file_id:
        raise HTTPException(status_code=400, detail="Invalid file id")


async def _load_org_and_authorize(
    org_id: int, user: PublicUser, db_session: AsyncSession
) -> Organization:
    org = (
        await db_session.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    if not await is_org_member(user.id, org.id, db_session):
        raise HTTPException(
            status_code=403, detail="User is not a member of this organization"
        )
    return org


@router.post(
    "/images/generate",
    response_model=GenerateImageResponse,
    summary="Generate an image with AI (nano banana)",
    description="Generate or refine an image from a text prompt. Consumes AI credits.",
    responses={
        200: {"description": "Image generated and stored.", "model": GenerateImageResponse},
        401: {"description": "Authentication required"},
        403: {"description": "Not an org member, AI disabled, or insufficient credits"},
        404: {"description": "Organization not found"},
    },
)
async def api_generate_image(
    body: GenerateImageRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> GenerateImageResponse:
    if not (body.prompt or "").strip():
        raise HTTPException(status_code=400, detail="A prompt is required")

    org = await _load_org_and_authorize(body.org_id, current_user, db_session)
    assert org.id is not None

    # Rate limit then reserve credit (feature-enabled + quota checked inside reserve).
    enforce_ai_rate_limit(current_user.id, org.id)
    await reserve_ai_credit(org.id, db_session, amount=IMAGE_CREDIT_COST)

    # Resolve an optional source image for iterative refinement / editing.
    # Prefer reading it from our own storage by file_id (reliable, no CORS);
    # fall back to a client-supplied base64 data URL.
    input_images: list[bytes] = []
    if body.source_file_id:
        _validate_file_id(body.source_file_id)
        try:
            input_images.append(
                await read_content(
                    directory=AI_IMAGE_DIR,
                    type_of_dir="orgs",
                    uuid=org.org_uuid,
                    file_and_format=body.source_file_id,
                )
            )
        except HTTPException:
            raise HTTPException(
                status_code=404,
                detail="Source image to refine was not found.",
            )
    elif body.source_image_base64:
        raw = body.source_image_base64
        if "," in raw and raw.strip().startswith("data:"):
            raw = raw.split(",", 1)[1]  # strip a data: URL prefix if present
        try:
            input_images.append(base64.b64decode(raw))
        except Exception:
            logger.warning("Ignoring invalid source_image_base64 on image refine")

    try:
        image_bytes = await generate_image(body.prompt, input_images=input_images or None)
    except AINotConfiguredError as e:
        refund_ai_credit(org.id, IMAGE_CREDIT_COST)
        raise HTTPException(status_code=403, detail=str(e))
    except Exception:
        refund_ai_credit(org.id, IMAGE_CREDIT_COST)
        # Do not log the traceback: the chained SDK error can embed the API key.
        # generate_image already logs the sanitized exception type.
        logger.error("Image generation failed")
        raise HTTPException(
            status_code=502,
            detail="Image generation failed. Please try again or rephrase your prompt.",
        )

    # Persist the bytes through the shared storage abstraction (filesystem or S3/R2).
    file_id = f"{uuid4()}_ai_generated.{OUTPUT_EXT}"
    try:
        await upload_content(
            directory=AI_IMAGE_DIR,
            type_of_dir="orgs",
            uuid=org.org_uuid,
            file_binary=image_bytes,
            file_and_format=file_id,
            allowed_formats=[OUTPUT_EXT],
        )
    except Exception:
        refund_ai_credit(org.id, IMAGE_CREDIT_COST)
        logger.exception("Failed to store generated image")
        raise HTTPException(status_code=500, detail="Failed to store generated image")

    session_uuid = body.session_uuid or f"aiimg_{uuid4()}"
    media_path = _media_path(org.org_uuid, file_id)
    record = await record_generation(
        db_session,
        kind=AIGenerationKind.IMAGE,
        org_id=org.id,
        user_id=current_user.id,
        prompt=body.prompt.strip(),
        result={"file_id": file_id, "media_url": media_path, "source": "ai_generated"},
        session_uuid=session_uuid,
        course_id=body.course_id,
        activity_id=body.activity_id,
    )

    return GenerateImageResponse(
        ai_generation_uuid=record.ai_generation_uuid,
        session_uuid=session_uuid,
        file_id=file_id,
        media_url=media_path,
        prompt=body.prompt.strip(),
    )


@router.get(
    "/images/{org_id}/{file_id}/bytes",
    summary="Download a generated AI image (same-origin, authenticated)",
    responses={
        200: {"description": "Image bytes returned", "content": {"image/png": {}}},
        400: {"description": "Invalid file id"},
        401: {"description": "Authentication required"},
        403: {"description": "Not an org member"},
        404: {"description": "Image not found"},
    },
)
async def api_get_image_bytes(
    org_id: int,
    file_id: str,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> Response:
    """Serve a generated image's raw bytes from the SAME origin as the API.

    Upload surfaces fetch this (instead of the public, possibly cross-origin
    media URL) so building a File to re-upload never trips CORS.
    """
    org = await _load_org_and_authorize(org_id, current_user, db_session)
    if "/" in file_id or "\\" in file_id or ".." in file_id or "\x00" in file_id:
        raise HTTPException(status_code=400, detail="Invalid file id")
    try:
        data = await read_content(
            directory=AI_IMAGE_DIR,
            type_of_dir="orgs",
            uuid=org.org_uuid,
            file_and_format=file_id,
        )
    except HTTPException:
        raise HTTPException(status_code=404, detail="Image not found")
    return Response(
        content=data,
        media_type=f"image/{OUTPUT_EXT}",
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get(
    "/images/history",
    response_model=list[AIImageHistoryItem],
    summary="List AI image generation history",
)
async def api_list_image_history(
    org_id: int,
    limit: int = 30,
    offset: int = 0,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> list[AIImageHistoryItem]:
    await _load_org_and_authorize(org_id, current_user, db_session)
    rows = await list_generations(
        db_session,
        org_id=org_id,
        user_id=current_user.id,
        kind=AIGenerationKind.IMAGE,
        limit=limit,
        offset=offset,
    )
    items: list[AIImageHistoryItem] = []
    for r in rows:
        result = r.result or {}
        items.append(
            AIImageHistoryItem(
                ai_generation_uuid=r.ai_generation_uuid,
                session_uuid=r.session_uuid,
                prompt=r.prompt,
                file_id=result.get("file_id", ""),
                media_url=result.get("media_url", ""),
                creation_date=r.creation_date,
            )
        )
    return items


@router.delete(
    "/images/history/{ai_generation_uuid}",
    summary="Delete an AI image generation from history",
)
async def api_delete_image_history(
    ai_generation_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    deleted = await delete_generation(
        db_session,
        ai_generation_uuid=ai_generation_uuid,
        user_id=current_user.id,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Generation not found")
    return {"detail": "deleted"}
