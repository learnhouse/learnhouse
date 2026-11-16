"""AI audio / podcast generation endpoint (Google Gemini TTS).

Backs the "Generate" tab of the editor Audio block. Follows the same
guard/credit ordering as the other AI routers: resolve org → org membership →
rate limit → reserve credit → generate → refund on failure. The generated WAV is
stored through the normal audio-block pipeline (``create_audio_block``), so it is
persisted and streamed exactly like an uploaded file and the frontend can treat
the result identically to an upload.
"""

import io
import logging
import math

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.datastructures import Headers

from src.core.events.database import get_db_session
from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.db.courses.blocks import BlockRead
from src.db.users import PublicUser
from src.security.auth import get_authenticated_user
from src.services.ai import metering, pricing
from src.security.org_auth import is_org_member, enforce_org_mfa
from src.security.rbac import check_resource_access, AccessAction
from src.services.ai.audio.generator import (
    MAX_TEXT_CHARS,
    OUTPUT_EXT,
    WORDS_PER_MINUTE,
    Speaker,
    generate_speech,
    generate_spoken_script,
)
from src.services.ai.llm import AINotConfiguredError
from src.services.ai.schemas.audio import (
    GenerateAudioRequest,
    GenerateScriptRequest,
    GenerateScriptResponse,
)
from src.services.blocks.block_types.audioBlock.audioBlock import create_audio_block
from src.services.security.rate_limiting import enforce_ai_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter()

# Published prices (src/services/ai/pricing.py): audio is charged per started
# minute of generated speech, a script per request; both are metered.
AUDIO_CREDIT_COST = pricing.FEATURES["podcast_audio"].credits
SCRIPT_CREDIT_COST = pricing.FEATURES["podcast_script"].credits

_WAV_HEADER_BYTES = 44
_PCM_BYTES_PER_SECOND = 24000 * 2  # 24 kHz, 16-bit mono (generator output)


def estimated_audio_minutes(text: str) -> int:
    """Started minutes of speech ``text`` will make (reserved before generating)."""
    words = len((text or "")[:MAX_TEXT_CHARS].split())
    return max(1, math.ceil(words / WORDS_PER_MINUTE))


def wav_minutes(wav_bytes: bytes) -> int:
    """Started minutes of a generated WAV (what the request is charged for)."""
    seconds = max(len(wav_bytes) - _WAV_HEADER_BYTES, 0) / _PCM_BYTES_PER_SECOND
    return max(1, math.ceil(seconds / 60))


async def _resolve_org_id_for_activity(request: Request, activity_uuid: str, current_user: PublicUser, db_session: AsyncSession) -> int:
    """Resolve the owning org for an activity; the caller must be able to edit its course."""
    activity = (
        await db_session.execute(select(Activity).where(Activity.activity_uuid == activity_uuid))
    ).scalars().first()
    if not activity or activity.org_id is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    if not await is_org_member(current_user.id, activity.org_id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")
    # Org-wide two-factor policy, applied after the membership gate.
    await enforce_org_mfa(current_user.id, activity.org_id, db_session)
    # Generating audio into an activity is an authoring action on its course.
    course = (
        await db_session.execute(select(Course).where(Course.id == activity.course_id))
    ).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )
    return activity.org_id


@router.post(
    "/audio/generate",
    response_model=BlockRead,
    summary="Generate an audio block with AI (Gemini TTS)",
    description=(
        "Generate speech (single voice) or a podcast (up to two speakers) from "
        "text and attach it to an activity as an audio block. Consumes AI credits."
    ),
    responses={
        200: {"description": "Audio generated, stored and returned.", "model": BlockRead},
        400: {"description": "Invalid request"},
        401: {"description": "Authentication required"},
        403: {"description": "Not an org member, AI disabled, or insufficient credits"},
        404: {"description": "Activity not found"},
    },
)
async def api_generate_audio(
    request: Request,
    body: GenerateAudioRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> BlockRead:
    if not (body.text or "").strip():
        raise HTTPException(status_code=400, detail="Some text is required to generate audio.")

    # Resolve the owning org from the activity so we can meter credits before
    # create_audio_block below.
    org_id = await _resolve_org_id_for_activity(request, body.activity_uuid, current_user, db_session)

    # Rate limit then reserve credit (feature-enabled + quota checked inside reserve).
    enforce_ai_rate_limit(current_user.id, org_id)
    # Reserve the estimated length; settle on the length actually generated.
    async with metering.charge(
        "podcast_audio",
        org_id=org_id,
        db=db_session,
        user_id=current_user.id,
        units=estimated_audio_minutes(body.text),
    ) as meter:
        return await _generate_audio_block(request, body, current_user, db_session, meter)


async def _generate_audio_block(request, body, current_user, db_session, meter) -> BlockRead:
    speakers = None
    if body.mode == "podcast" and body.speakers:
        speakers = [Speaker(name=s.name, voice=s.voice) for s in body.speakers if s.name.strip()]

    try:
        wav_bytes = await generate_speech(
            body.text,
            voice=body.voice,
            speakers=speakers,
            style=body.style,
            language=body.language,
        )
    except AINotConfiguredError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        # Do not log the traceback: the chained SDK error can embed the API key.
        logger.error("Audio generation failed")
        raise HTTPException(
            status_code=502,
            detail="Audio generation failed. Please try again or rephrase your text.",
        )

    meter.units = wav_minutes(wav_bytes)

    # Persist + create the block through the normal audio-block pipeline so the
    # result is stored and streamed identically to an uploaded file.
    upload = UploadFile(
        file=io.BytesIO(wav_bytes),
        size=len(wav_bytes),
        filename=f"ai_generated.{OUTPUT_EXT}",
        headers=Headers({"content-type": "audio/wav"}),
    )
    try:
        return await create_audio_block(
            request, upload, body.activity_uuid, db_session, current_user
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to store generated audio")
        raise HTTPException(status_code=500, detail="Failed to store generated audio")


@router.post(
    "/audio/script",
    response_model=GenerateScriptResponse,
    summary="Generate a spoken script with AI (podcast dialogue or monologue)",
    description=(
        "Turn a topic, question, or source material into a spoken script: a "
        "two-speaker discussion ('podcast') or a detailed single-speaker explanation "
        "('speak'), of an approximate length. Consumes AI credits."
    ),
    responses={
        200: {"description": "Script generated.", "model": GenerateScriptResponse},
        400: {"description": "Invalid request"},
        401: {"description": "Authentication required"},
        403: {"description": "Not an org member, AI disabled, or insufficient credits"},
        404: {"description": "Activity not found"},
    },
)
async def api_generate_script(
    request: Request,
    body: GenerateScriptRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> GenerateScriptResponse:
    if not (body.text or "").strip():
        raise HTTPException(status_code=400, detail="Add a topic or some text to generate a script from.")

    org_id = await _resolve_org_id_for_activity(request, body.activity_uuid, current_user, db_session)

    enforce_ai_rate_limit(current_user.id, org_id)

    kind = "monologue" if body.mode == "speak" else "podcast"
    names = [s.name for s in (body.speakers or []) if s.name.strip()] or None
    async with metering.charge("podcast_script", org_id=org_id, db=db_session, user_id=current_user.id):
        try:
            transcript = await generate_spoken_script(
                body.text,
                kind=kind,
                speaker_names=names,
                language=body.language,
                style=body.style,
                minutes=body.minutes,
            )
        except AINotConfiguredError as e:
            raise HTTPException(status_code=403, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception:
            logger.error("Script generation failed")
            raise HTTPException(
                status_code=502,
                detail="Script generation failed. Please try again.",
            )

    return GenerateScriptResponse(transcript=transcript)
