from typing import Optional

from pydantic import BaseModel

from src.db.courses.activities import ActivityTypeEnum, ActivitySubTypeEnum
from src.services.og_activity.contract import ContractType
from src.services.og_activity.registry import ActivityTypeModule
from src.services.og_activity.spec import LearnHouseActivitySpec


class DocumentPayload(BaseModel):
    file_ref: str
    mime: str
    render_hint: Optional[str] = None


class DocumentModule(ActivityTypeModule):
    contract_type = ContractType.DOCUMENT
    payload_model = DocumentPayload

    def to_learnhouse(self, payload: DocumentPayload) -> LearnHouseActivitySpec:
        sub_type = (
            ActivitySubTypeEnum.SUBTYPE_DOCUMENT_PDF
            if payload.mime == "application/pdf"
            else ActivitySubTypeEnum.SUBTYPE_DOCUMENT_DOC
        )
        content: dict = {"filename": payload.file_ref, "mime": payload.mime}
        if payload.render_hint is not None:
            content["render_hint"] = payload.render_hint
        return LearnHouseActivitySpec(
            activity_type=ActivityTypeEnum.TYPE_DOCUMENT,
            activity_sub_type=sub_type,
            content=content,
        )

    def from_learnhouse(self, activity) -> dict:
        content = activity.content or {}
        return {
            "file_ref": content.get("filename", ""),
            "mime": content.get("mime", ""),
            "render_hint": content.get("render_hint"),
        }
