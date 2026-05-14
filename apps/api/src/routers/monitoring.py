"""Server-side relay so adblockers can't drop Sentry user feedback."""

from typing import Optional

import sentry_sdk
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

router = APIRouter()


_MAX_ATTACHMENTS = 3
_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
_MAX_MESSAGE_LENGTH = 4096


@router.post(
    "/feedback",
    summary="Submit user feedback",
    description=(
        "Relay user feedback to Sentry from the server so requests aren't "
        "dropped by client-side ad/tracker blockers."
    ),
    responses={
        204: {"description": "Feedback accepted and forwarded to Sentry."},
        400: {"description": "Empty or invalid feedback payload."},
        503: {"description": "Sentry is not configured on this instance."},
    },
    status_code=204,
)
async def submit_feedback(
    message: str = Form(""),
    name: Optional[str] = Form(None),
    email: Optional[str] = Form(None),
    associated_event_id: Optional[str] = Form(None),
    attachments: list[UploadFile] = File(default=[]),
):
    message = (message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Feedback message is required")
    if len(message) > _MAX_MESSAGE_LENGTH:
        message = message[:_MAX_MESSAGE_LENGTH]

    if not sentry_sdk.get_client().is_active():
        return

    files = (attachments or [])[:_MAX_ATTACHMENTS]
    loaded: list[tuple[str, bytes, str]] = []
    for upload in files:
        if not upload or not upload.filename:
            continue
        data = await upload.read()
        if not data:
            continue
        if len(data) > _MAX_ATTACHMENT_BYTES:
            data = data[:_MAX_ATTACHMENT_BYTES]
        loaded.append((upload.filename, data, upload.content_type or "application/octet-stream"))

    # sentry-sdk 2.x has no capture_feedback; emit the JS SDK's envelope shape so it lands in User Feedback.
    feedback_context: dict[str, str] = {"message": message, "source": "api"}
    if name:
        feedback_context["name"] = name
    if email:
        feedback_context["contact_email"] = email
    if associated_event_id:
        feedback_context["associated_event_id"] = associated_event_id

    event = {
        "type": "feedback",
        "level": "info",
        "contexts": {"feedback": feedback_context},
    }

    with sentry_sdk.new_scope() as scope:
        for filename, data, content_type in loaded:
            scope.add_attachment(bytes=data, filename=filename, content_type=content_type)
        sentry_sdk.capture_event(event)
