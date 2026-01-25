"""
SCORM Runtime Service
Handles SCORM API data model mapping and runtime data storage
for both SCORM 1.2 and SCORM 2004
"""

import re
from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlmodel import Session, select

from src.db.courses.activities import Activity
from ee.db.scorm import (
    ScormRuntimeData,
    ScormRuntimeDataRead,
    ScormRuntimeDataUpdate,
    CompletionStatusEnum,
    SuccessStatusEnum,
)
from src.db.users import PublicUser


# SCORM 1.2 CMI data model elements (read-only indicated)
SCORM_12_READ_ONLY = {
    "cmi.core._children",
    "cmi.core.student_id",
    "cmi.core.student_name",
    "cmi.core.credit",
    "cmi.core.entry",
    "cmi.core.total_time",
    "cmi.core.lesson_mode",
    "cmi.launch_data",
    "cmi.comments_from_lms",
    "cmi.objectives._children",
    "cmi.objectives._count",
    "cmi.student_data._children",
    "cmi.student_data.mastery_score",
    "cmi.student_data.max_time_allowed",
    "cmi.student_data.time_limit_action",
    "cmi.student_preference._children",
    "cmi.interactions._children",
    "cmi.interactions._count",
}

SCORM_12_WRITE_ONLY = {
    "cmi.core.session_time",
}

# SCORM 2004 CMI data model elements (read-only indicated)
SCORM_2004_READ_ONLY = {
    "cmi._version",
    "cmi.completion_threshold",
    "cmi.credit",
    "cmi.entry",
    "cmi.launch_data",
    "cmi.learner_id",
    "cmi.learner_name",
    "cmi.max_time_allowed",
    "cmi.mode",
    "cmi.scaled_passing_score",
    "cmi.time_limit_action",
    "cmi.total_time",
    "cmi.comments_from_lms._children",
    "cmi.comments_from_lms._count",
    "cmi.interactions._children",
    "cmi.interactions._count",
    "cmi.learner_preference._children",
    "cmi.objectives._children",
    "cmi.objectives._count",
    "cmi.score._children",
}

SCORM_2004_WRITE_ONLY = {
    "cmi.session_time",
    "cmi.exit",
}

# Suspend data size limits
SCORM_12_SUSPEND_DATA_LIMIT = 4096  # 4KB
SCORM_2004_SUSPEND_DATA_LIMIT = 65536  # 64KB


def parse_iso8601_duration(duration: str) -> int:
    """Parse ISO 8601 duration to total seconds"""
    if not duration:
        return 0

    # Handle SCORM 1.2 format (HH:MM:SS.ss)
    match = re.match(r'^(\d+):(\d+):(\d+(?:\.\d+)?)$', duration)
    if match:
        hours, minutes, seconds = match.groups()
        return int(float(hours) * 3600 + float(minutes) * 60 + float(seconds))

    # Handle ISO 8601 format (PT#H#M#S)
    match = re.match(r'^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$', duration)
    if match:
        hours = int(match.group(1) or 0)
        minutes = int(match.group(2) or 0)
        seconds = float(match.group(3) or 0)
        return int(hours * 3600 + minutes * 60 + seconds)

    return 0


def format_iso8601_duration(seconds: int) -> str:
    """Format seconds as ISO 8601 duration"""
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60

    parts = ["PT"]
    if hours:
        parts.append(f"{hours}H")
    if minutes:
        parts.append(f"{minutes}M")
    if secs or not (hours or minutes):
        parts.append(f"{secs}S")

    return "".join(parts)


def format_scorm_12_time(seconds: int) -> str:
    """Format seconds as SCORM 1.2 time (HHHH:MM:SS.ss)"""
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    return f"{hours:04d}:{minutes:02d}:{secs:02d}.00"


def map_completion_status_12_to_enum(lesson_status: str) -> CompletionStatusEnum:
    """Map SCORM 1.2 lesson_status to CompletionStatusEnum"""
    status_map = {
        "passed": CompletionStatusEnum.PASSED,
        "completed": CompletionStatusEnum.COMPLETED,
        "failed": CompletionStatusEnum.FAILED,
        "incomplete": CompletionStatusEnum.INCOMPLETE,
        "browsed": CompletionStatusEnum.INCOMPLETE,
        "not attempted": CompletionStatusEnum.NOT_ATTEMPTED,
    }
    return status_map.get(lesson_status.lower(), CompletionStatusEnum.NOT_ATTEMPTED)


def map_completion_status_2004_to_enum(status: str) -> CompletionStatusEnum:
    """Map SCORM 2004 completion_status to CompletionStatusEnum"""
    status_map = {
        "completed": CompletionStatusEnum.COMPLETED,
        "incomplete": CompletionStatusEnum.INCOMPLETE,
        "not attempted": CompletionStatusEnum.NOT_ATTEMPTED,
        "unknown": CompletionStatusEnum.NOT_ATTEMPTED,
    }
    return status_map.get(status.lower(), CompletionStatusEnum.NOT_ATTEMPTED)


def map_success_status_2004_to_enum(status: str) -> SuccessStatusEnum:
    """Map SCORM 2004 success_status to SuccessStatusEnum"""
    status_map = {
        "passed": SuccessStatusEnum.PASSED,
        "failed": SuccessStatusEnum.FAILED,
        "unknown": SuccessStatusEnum.UNKNOWN,
    }
    return status_map.get(status.lower(), SuccessStatusEnum.UNKNOWN)


async def get_or_create_runtime_data(
    user_id: int,
    activity_id: int,
    org_id: int,
    db_session: Session,
) -> ScormRuntimeData:
    """Get existing runtime data or create new one"""
    statement = select(ScormRuntimeData).where(
        ScormRuntimeData.user_id == user_id,
        ScormRuntimeData.activity_id == activity_id,
    )
    runtime_data = db_session.exec(statement).first()

    if not runtime_data:
        runtime_data = ScormRuntimeData(
            user_id=user_id,
            activity_id=activity_id,
            org_id=org_id,
            runtime_uuid=f"runtime_{uuid4()}",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(runtime_data)
        db_session.commit()
        db_session.refresh(runtime_data)

    return runtime_data


async def initialize_scorm_session(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser,
    db_session: Session,
) -> dict:
    """Initialize a SCORM session for the user"""
    # Get activity
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Get or create runtime data
    runtime_data = await get_or_create_runtime_data(
        user_id=current_user.id,
        activity_id=activity.id,
        org_id=activity.org_id,
        db_session=db_session,
    )

    # Determine SCORM version from activity content
    scorm_version = activity.content.get("scorm_version", "SCORM_12")

    # Build initial CMI data based on version
    if scorm_version == "SCORM_2004":
        cmi_data = build_initial_cmi_2004(current_user, runtime_data, activity)
    else:
        cmi_data = build_initial_cmi_12(current_user, runtime_data, activity)

    return {
        "success": True,
        "scorm_version": scorm_version,
        "cmi_data": cmi_data,
        "runtime_uuid": runtime_data.runtime_uuid,
    }


def build_initial_cmi_12(
    user: PublicUser,
    runtime_data: ScormRuntimeData,
    activity: Activity,
) -> dict:
    """Build initial CMI data for SCORM 1.2"""
    # Merge stored CMI data with defaults
    stored_cmi = runtime_data.cmi_data or {}

    cmi = {
        "cmi.core._children": "student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time",
        "cmi.core.student_id": str(user.id),
        "cmi.core.student_name": f"{user.last_name or ''}, {user.first_name or ''}".strip(", "),
        "cmi.core.lesson_location": runtime_data.location or "",
        "cmi.core.credit": "credit",
        "cmi.core.lesson_status": _map_completion_to_12_status(runtime_data.completion_status),
        "cmi.core.entry": "resume" if runtime_data.location else "ab-initio",
        "cmi.core.score._children": "raw,min,max",
        "cmi.core.score.raw": str(runtime_data.score_raw) if runtime_data.score_raw is not None else "",
        "cmi.core.score.min": str(runtime_data.score_min) if runtime_data.score_min is not None else "",
        "cmi.core.score.max": str(runtime_data.score_max) if runtime_data.score_max is not None else "",
        "cmi.core.total_time": format_scorm_12_time(parse_iso8601_duration(runtime_data.total_time)),
        "cmi.core.lesson_mode": "normal",
        "cmi.core.exit": "",
        "cmi.suspend_data": runtime_data.suspend_data or "",
        "cmi.launch_data": activity.content.get("launch_data", ""),
        "cmi.comments": stored_cmi.get("cmi.comments", ""),
        "cmi.comments_from_lms": "",
    }

    # Merge any additional stored CMI data
    for key, value in stored_cmi.items():
        if key not in cmi:
            cmi[key] = value

    return cmi


def build_initial_cmi_2004(
    user: PublicUser,
    runtime_data: ScormRuntimeData,
    activity: Activity,
) -> dict:
    """Build initial CMI data for SCORM 2004"""
    stored_cmi = runtime_data.cmi_data or {}

    cmi = {
        "cmi._version": "1.0",
        "cmi.learner_id": str(user.id),
        "cmi.learner_name": f"{user.last_name or ''}, {user.first_name or ''}".strip(", "),
        "cmi.location": runtime_data.location or "",
        "cmi.credit": "credit",
        "cmi.completion_status": runtime_data.completion_status.value if runtime_data.completion_status != CompletionStatusEnum.PASSED and runtime_data.completion_status != CompletionStatusEnum.FAILED else "completed",
        "cmi.completion_threshold": "",
        "cmi.success_status": runtime_data.success_status.value,
        "cmi.scaled_passing_score": "",
        "cmi.entry": "resume" if runtime_data.location else "ab-initio",
        "cmi.score._children": "scaled,raw,min,max",
        "cmi.score.scaled": str(runtime_data.score_scaled) if runtime_data.score_scaled is not None else "",
        "cmi.score.raw": str(runtime_data.score_raw) if runtime_data.score_raw is not None else "",
        "cmi.score.min": str(runtime_data.score_min) if runtime_data.score_min is not None else "",
        "cmi.score.max": str(runtime_data.score_max) if runtime_data.score_max is not None else "",
        "cmi.total_time": runtime_data.total_time,
        "cmi.mode": "normal",
        "cmi.exit": "",
        "cmi.suspend_data": runtime_data.suspend_data or "",
        "cmi.launch_data": activity.content.get("launch_data", ""),
        "cmi.learner_preference._children": "audio_level,language,delivery_speed,audio_captioning",
        "cmi.learner_preference.audio_level": "1",
        "cmi.learner_preference.language": "",
        "cmi.learner_preference.delivery_speed": "1",
        "cmi.learner_preference.audio_captioning": "0",
        "cmi.max_time_allowed": "",
        "cmi.time_limit_action": "continue,no message",
        "cmi.progress_measure": stored_cmi.get("cmi.progress_measure", ""),
    }

    # Merge any additional stored CMI data
    for key, value in stored_cmi.items():
        if key not in cmi:
            cmi[key] = value

    return cmi


def _map_completion_to_12_status(status: CompletionStatusEnum) -> str:
    """Map CompletionStatusEnum to SCORM 1.2 lesson_status"""
    status_map = {
        CompletionStatusEnum.NOT_ATTEMPTED: "not attempted",
        CompletionStatusEnum.INCOMPLETE: "incomplete",
        CompletionStatusEnum.COMPLETED: "completed",
        CompletionStatusEnum.PASSED: "passed",
        CompletionStatusEnum.FAILED: "failed",
    }
    return status_map.get(status, "not attempted")


async def commit_scorm_data(
    request: Request,
    activity_uuid: str,
    cmi_data: dict,
    current_user: PublicUser,
    db_session: Session,
) -> dict:
    """Commit (save) SCORM runtime data"""
    # Get activity
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Get runtime data
    statement = select(ScormRuntimeData).where(
        ScormRuntimeData.user_id == current_user.id,
        ScormRuntimeData.activity_id == activity.id,
    )
    runtime_data = db_session.exec(statement).first()

    if not runtime_data:
        raise HTTPException(status_code=404, detail="Runtime data not found. Call Initialize first.")

    # Determine SCORM version
    scorm_version = activity.content.get("scorm_version", "SCORM_12")

    # Validate and process CMI data
    if scorm_version == "SCORM_2004":
        await process_cmi_2004(runtime_data, cmi_data, db_session)
    else:
        await process_cmi_12(runtime_data, cmi_data, db_session)

    return {"success": True}


async def process_cmi_12(
    runtime_data: ScormRuntimeData,
    cmi_data: dict,
    db_session: Session,
) -> None:
    """Process SCORM 1.2 CMI data updates"""
    # Extract core values
    if "cmi.core.lesson_location" in cmi_data:
        runtime_data.location = cmi_data["cmi.core.lesson_location"]

    if "cmi.core.lesson_status" in cmi_data:
        runtime_data.completion_status = map_completion_status_12_to_enum(
            cmi_data["cmi.core.lesson_status"]
        )
        # Map to success status as well for SCORM 1.2
        if cmi_data["cmi.core.lesson_status"].lower() == "passed":
            runtime_data.success_status = SuccessStatusEnum.PASSED
        elif cmi_data["cmi.core.lesson_status"].lower() == "failed":
            runtime_data.success_status = SuccessStatusEnum.FAILED

    # Score
    if "cmi.core.score.raw" in cmi_data and cmi_data["cmi.core.score.raw"]:
        try:
            runtime_data.score_raw = float(cmi_data["cmi.core.score.raw"])
        except ValueError:
            pass

    if "cmi.core.score.min" in cmi_data and cmi_data["cmi.core.score.min"]:
        try:
            runtime_data.score_min = float(cmi_data["cmi.core.score.min"])
        except ValueError:
            pass

    if "cmi.core.score.max" in cmi_data and cmi_data["cmi.core.score.max"]:
        try:
            runtime_data.score_max = float(cmi_data["cmi.core.score.max"])
        except ValueError:
            pass

    # Session time - add to total time
    if "cmi.core.session_time" in cmi_data and cmi_data["cmi.core.session_time"]:
        session_seconds = parse_iso8601_duration(cmi_data["cmi.core.session_time"])
        total_seconds = parse_iso8601_duration(runtime_data.total_time)
        runtime_data.total_time = format_iso8601_duration(total_seconds + session_seconds)
        runtime_data.session_time = format_iso8601_duration(session_seconds)

    # Suspend data with size limit
    if "cmi.suspend_data" in cmi_data:
        suspend_data = cmi_data["cmi.suspend_data"] or ""
        if len(suspend_data) <= SCORM_12_SUSPEND_DATA_LIMIT:
            runtime_data.suspend_data = suspend_data
        else:
            raise HTTPException(
                status_code=400,
                detail=f"suspend_data exceeds SCORM 1.2 limit of {SCORM_12_SUSPEND_DATA_LIMIT} bytes"
            )

    # Store full CMI data
    stored_cmi = runtime_data.cmi_data or {}
    for key, value in cmi_data.items():
        if key not in SCORM_12_READ_ONLY:
            stored_cmi[key] = value
    runtime_data.cmi_data = stored_cmi

    runtime_data.update_date = str(datetime.now())
    db_session.add(runtime_data)
    db_session.commit()


async def process_cmi_2004(
    runtime_data: ScormRuntimeData,
    cmi_data: dict,
    db_session: Session,
) -> None:
    """Process SCORM 2004 CMI data updates"""
    # Location
    if "cmi.location" in cmi_data:
        runtime_data.location = cmi_data["cmi.location"]

    # Completion status
    if "cmi.completion_status" in cmi_data:
        runtime_data.completion_status = map_completion_status_2004_to_enum(
            cmi_data["cmi.completion_status"]
        )

    # Success status
    if "cmi.success_status" in cmi_data:
        runtime_data.success_status = map_success_status_2004_to_enum(
            cmi_data["cmi.success_status"]
        )

    # Score
    if "cmi.score.scaled" in cmi_data and cmi_data["cmi.score.scaled"]:
        try:
            scaled = float(cmi_data["cmi.score.scaled"])
            if -1 <= scaled <= 1:
                runtime_data.score_scaled = scaled
        except ValueError:
            pass

    if "cmi.score.raw" in cmi_data and cmi_data["cmi.score.raw"]:
        try:
            runtime_data.score_raw = float(cmi_data["cmi.score.raw"])
        except ValueError:
            pass

    if "cmi.score.min" in cmi_data and cmi_data["cmi.score.min"]:
        try:
            runtime_data.score_min = float(cmi_data["cmi.score.min"])
        except ValueError:
            pass

    if "cmi.score.max" in cmi_data and cmi_data["cmi.score.max"]:
        try:
            runtime_data.score_max = float(cmi_data["cmi.score.max"])
        except ValueError:
            pass

    # Session time
    if "cmi.session_time" in cmi_data and cmi_data["cmi.session_time"]:
        session_seconds = parse_iso8601_duration(cmi_data["cmi.session_time"])
        total_seconds = parse_iso8601_duration(runtime_data.total_time)
        runtime_data.total_time = format_iso8601_duration(total_seconds + session_seconds)
        runtime_data.session_time = format_iso8601_duration(session_seconds)

    # Suspend data with size limit
    if "cmi.suspend_data" in cmi_data:
        suspend_data = cmi_data["cmi.suspend_data"] or ""
        if len(suspend_data) <= SCORM_2004_SUSPEND_DATA_LIMIT:
            runtime_data.suspend_data = suspend_data
        else:
            raise HTTPException(
                status_code=400,
                detail=f"suspend_data exceeds SCORM 2004 limit of {SCORM_2004_SUSPEND_DATA_LIMIT} bytes"
            )

    # Store full CMI data
    stored_cmi = runtime_data.cmi_data or {}
    for key, value in cmi_data.items():
        if key not in SCORM_2004_READ_ONLY:
            stored_cmi[key] = value
    runtime_data.cmi_data = stored_cmi

    runtime_data.update_date = str(datetime.now())
    db_session.add(runtime_data)
    db_session.commit()


async def terminate_scorm_session(
    request: Request,
    activity_uuid: str,
    cmi_data: dict,
    current_user: PublicUser,
    db_session: Session,
) -> dict:
    """Terminate a SCORM session"""
    # First commit any final data
    if cmi_data:
        await commit_scorm_data(request, activity_uuid, cmi_data, current_user, db_session)

    return {"success": True}


async def get_runtime_data(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser,
    db_session: Session,
) -> ScormRuntimeDataRead:
    """Get runtime data for a user and activity"""
    # Get activity
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Get runtime data
    statement = select(ScormRuntimeData).where(
        ScormRuntimeData.user_id == current_user.id,
        ScormRuntimeData.activity_id == activity.id,
    )
    runtime_data = db_session.exec(statement).first()

    if not runtime_data:
        # Return empty data if not found
        runtime_data = await get_or_create_runtime_data(
            user_id=current_user.id,
            activity_id=activity.id,
            org_id=activity.org_id,
            db_session=db_session,
        )

    return ScormRuntimeDataRead.model_validate(runtime_data)


async def update_runtime_data(
    request: Request,
    activity_uuid: str,
    update_data: ScormRuntimeDataUpdate,
    current_user: PublicUser,
    db_session: Session,
) -> ScormRuntimeDataRead:
    """Update runtime data directly (for admin purposes)"""
    # Get activity
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Get runtime data
    statement = select(ScormRuntimeData).where(
        ScormRuntimeData.user_id == current_user.id,
        ScormRuntimeData.activity_id == activity.id,
    )
    runtime_data = db_session.exec(statement).first()

    if not runtime_data:
        raise HTTPException(status_code=404, detail="Runtime data not found")

    # Update fields
    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        if value is not None:
            setattr(runtime_data, key, value)

    runtime_data.update_date = str(datetime.now())
    db_session.add(runtime_data)
    db_session.commit()
    db_session.refresh(runtime_data)

    return ScormRuntimeDataRead.model_validate(runtime_data)
