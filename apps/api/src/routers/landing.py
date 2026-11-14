"""Landing page builder endpoints.

Signed-in admins and org API tokens build pages here (the builder itself,
scripts, no-code tools); visitors read published pages through ``/public``.
The ``landing`` tool set exposes the same operations to Atlas, MCP clients
and API tokens (``/api/v1/tools/<name>``).

The legacy landing (``PUT /orgs/{org_id}/landing``) is unchanged and keeps
working next to these routes.
"""

import logging
from typing import Any, Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from src.core.events.database import get_db_session
from src.db.users import APITokenUser, PublicUser
from src.security.api_token_utils import reject_api_token_access
from src.security.auth import get_authenticated_user
from src.services.ai import metering
from src.services.landing import recipes, service
from src.services.landing.schema import DocError, schema_summary, validate_doc
from src.services.security.rate_limiting import enforce_ai_rate_limit
from sqlmodel.ext.asyncio.session import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter()

Editor = Union[PublicUser, APITokenUser]


Palette = Literal["template", "org"]


class CreatePageBody(BaseModel):
    slug: str = Field(..., max_length=64)
    title: str = Field("", max_length=120)
    template: Optional[str] = Field(None, max_length=40)
    palette: Palette = Field("template", description="'org' swaps the template's colors and fonts for the organization's brand.")
    copy_chrome: bool = Field(True, description="Start with the home page's navigation and footer.")
    add_to_nav: bool = Field(False, description="Add a link to the new page in the home page's navigation (draft).")


class PageMetaBody(BaseModel):
    title: Optional[str] = Field(None, max_length=120)
    slug: Optional[str] = Field(None, max_length=64)


class DraftBody(BaseModel):
    doc: dict
    base_revision: Optional[int] = Field(None, description="The draft revision this edit started from; a newer draft answers 409.")


class PublishBody(BaseModel):
    label: str = Field("", max_length=120)
    base_revision: Optional[int] = None


class TemplateBody(BaseModel):
    template: str = Field(..., max_length=40)
    base_revision: Optional[int] = None
    palette: Palette = Field("template", description="'org' uses the organization's brand colors and fonts instead of the template's.")
    keep_chrome: bool = Field(True, description="Keep the page's own navigation and footer sections.")


class SavedSectionBody(BaseModel):
    name: str = Field("", max_length=80)
    node: dict
    symbols: Optional[dict] = None


class RenameBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)


class VariantBody(BaseModel):
    label: str = Field("", max_length=120)
    doc: Optional[dict] = None


class ReviewBody(BaseModel):
    action: Literal["keep", "discard"]


class ValidateBody(BaseModel):
    doc: Any


class GenerateBody(BaseModel):
    page_uuid: str = Field(..., max_length=100)
    brief: str = Field(..., min_length=3, max_length=3000)
    base_revision: Optional[int] = None


class CopyBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    instruction: str = Field("Make it clearer and more compelling", max_length=500)
    context: str = Field("", max_length=500)


# ─── builder ──────────────────────────────────────────────────────────────────


@router.get("/schema", summary="The landing page document format")
async def api_schema() -> dict:
    return schema_summary()


@router.get("/templates", summary="Page templates and ready-made sections")
async def api_templates(include_legacy: bool = False, current_user: Editor = Depends(get_authenticated_user)) -> dict:
    from src.services.landing import templates as gallery

    return {
        "templates": recipes.template_summaries(include_legacy=include_legacy),
        "categories": list(gallery.CATEGORIES),
        "sections": recipes.section_library({"org_name": "", "year": ""}),
        "presets": recipes.PRESETS,
    }


@router.get("/templates/{template_id}/sections", summary="The designed sections of one template, for the section library")
async def api_template_sections(template_id: str, current_user: Editor = Depends(get_authenticated_user)) -> dict:
    from src.services.landing import templates as gallery

    if not gallery.has(template_id):
        raise HTTPException(status_code=404, detail=f"No template '{template_id}'.")
    doc = gallery.build(template_id, {})
    return {
        "template": template_id,
        "theme": doc["theme"],
        "sections": [{"kind": "template", "variant": template_id, "name": n.get("name") or n["type"], "node": n} for n in validate_doc(doc)["root"]],
    }


@router.get("/org/{org_id}", summary="Landing pages of an organization, the home switch and plan limits")
async def api_site(request: Request, org_id: int, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.site_overview(request, db_session, current_user, org_id)


@router.post("/org/{org_id}/pages", summary="Create an extra page (Standard plan and up)")
async def api_create_page(request: Request, org_id: int, body: CreatePageBody, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.create_page(
        request, db_session, current_user, org_id, slug=body.slug, title=body.title, template=body.template,
        palette=body.palette, copy_chrome=body.copy_chrome, add_to_nav=body.add_to_nav,
    )


@router.get("/template-preview/{template_id}", summary="A template rendered with this organization's details (not saved)")
async def api_template_preview(
    request: Request, template_id: str, org_id: int, palette: Palette = "template",
    db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user),
) -> dict:
    org = await service.get_org(db_session, org_id)
    await service.require_editor(request, db_session, current_user, org)
    return {"doc": await service.template_for_org(db_session, org, template_id, palette)}


@router.get("/pages/{page_uuid}", summary="A page with its draft and published documents")
async def api_get_page(request: Request, page_uuid: str, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.get_page(request, db_session, current_user, page_uuid)


@router.patch("/pages/{page_uuid}", summary="Rename a page or change its address")
async def api_update_page(request: Request, page_uuid: str, body: PageMetaBody, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.update_page_meta(request, db_session, current_user, page_uuid, title=body.title, slug=body.slug)


@router.delete("/pages/{page_uuid}", summary="Delete an extra page")
async def api_delete_page(request: Request, page_uuid: str, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.delete_page(request, db_session, current_user, page_uuid)


@router.put(
    "/pages/{page_uuid}/draft",
    summary="Save the draft (autosave)",
    description="Validated on save (422 lists every problem with its path). Pass base_revision: a draft changed elsewhere answers 409.",
)
async def api_save_draft(request: Request, page_uuid: str, body: DraftBody, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.save_draft(request, db_session, current_user, page_uuid, body.doc, body.base_revision)


@router.post("/pages/{page_uuid}/publish", summary="Publish the draft")
async def api_publish(request: Request, page_uuid: str, body: PublishBody, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.publish(request, db_session, current_user, page_uuid, label=body.label, base_revision=body.base_revision)


@router.post("/pages/{page_uuid}/unpublish", summary="Take a page offline")
async def api_unpublish(request: Request, page_uuid: str, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.unpublish(request, db_session, current_user, page_uuid)


@router.post("/pages/{page_uuid}/template", summary="Replace the draft with a template")
async def api_apply_template(request: Request, page_uuid: str, body: TemplateBody, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.apply_template(request, db_session, current_user, page_uuid, body.template, body.base_revision, palette=body.palette, keep_chrome=body.keep_chrome)


@router.get("/pages/{page_uuid}/versions", summary="Version history of a page")
async def api_versions(request: Request, page_uuid: str, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> list[dict]:
    return await service.list_versions(request, db_session, current_user, page_uuid)


@router.post("/pages/{page_uuid}/variants", summary="Save the draft (or a given document) as a named variant")
async def api_variant(request: Request, page_uuid: str, body: VariantBody, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.save_variant(request, db_session, current_user, page_uuid, label=body.label, doc=body.doc)


@router.post("/pages/{page_uuid}/preview-token", summary="Make a new preview link (the old one stops working)")
async def api_rotate_preview(request: Request, page_uuid: str, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.rotate_preview(request, db_session, current_user, page_uuid)


@router.post("/pages/{page_uuid}/review", summary="Keep or discard unreviewed Atlas / API changes")
async def api_review(request: Request, page_uuid: str, body: ReviewBody, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.resolve_review(request, db_session, current_user, page_uuid, body.action)


@router.get("/versions/{version_uuid}", summary="One version with its document")
async def api_version(request: Request, version_uuid: str, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.get_version(request, db_session, current_user, version_uuid)


@router.post("/versions/{version_uuid}/restore", summary="Put a version back into the draft")
async def api_restore(request: Request, version_uuid: str, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.restore_version(request, db_session, current_user, version_uuid)


@router.post("/org/{org_id}/validate", summary="Check a page document without saving it")
async def api_validate(request: Request, org_id: int, body: ValidateBody, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    org = await service.get_org(db_session, org_id)
    await service.require_editor(request, db_session, current_user, org)
    caps = await service.plan_caps(db_session, org_id)
    try:
        return {"ok": True, "doc": validate_doc(body.doc, caps=service.caps_set(caps))}
    except DocError as e:
        return {"ok": False, **e.as_detail()}


@router.get("/org/{org_id}/submissions", summary="Contact form messages sent from published pages")
async def api_submissions(
    request: Request, org_id: int, page_uuid: Optional[str] = None, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0),
    db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user),
) -> dict:
    return await service.list_submissions(request, db_session, current_user, org_id, page_uuid=page_uuid, limit=limit, offset=offset)


@router.delete("/org/{org_id}/submissions/{submission_uuid}", summary="Delete a contact form message")
async def api_delete_submission(request: Request, org_id: int, submission_uuid: str, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.delete_submission(request, db_session, current_user, org_id, submission_uuid)


@router.get("/org/{org_id}/saved-sections", summary="Sections saved to reuse on any page")
async def api_saved_sections(request: Request, org_id: int, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> list[dict]:
    return await service.list_saved_sections(request, db_session, current_user, org_id)


@router.post("/org/{org_id}/saved-sections", summary="Save a section to reuse on other pages")
async def api_save_section(request: Request, org_id: int, body: SavedSectionBody, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.save_section(request, db_session, current_user, org_id, name=body.name, node=body.node, symbols=body.symbols)


@router.patch("/org/{org_id}/saved-sections/{section_uuid}", summary="Rename a saved section")
async def api_rename_section(request: Request, org_id: int, section_uuid: str, body: RenameBody, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.rename_saved_section(request, db_session, current_user, org_id, section_uuid, body.name)


@router.delete("/org/{org_id}/saved-sections/{section_uuid}", summary="Delete a saved section")
async def api_delete_section(request: Request, org_id: int, section_uuid: str, db_session: AsyncSession = Depends(get_db_session), current_user: Editor = Depends(get_authenticated_user)) -> dict:
    return await service.delete_saved_section(request, db_session, current_user, org_id, section_uuid)


# ─── AI (spends credits: people only) ─────────────────────────────────────────


@router.post("/org/{org_id}/ai/generate", summary="Design the draft from a brief with AI")
async def api_ai_generate(request: Request, org_id: int, body: GenerateBody, db_session: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_authenticated_user)) -> dict:
    from src.db.courses.courses import Course
    from sqlmodel import select
    from src.services.ai.llm import AINotConfiguredError, resolve_model_for_org
    from src.services.landing.ai import plan_page, plan_to_doc

    reject_api_token_access(current_user)
    org = await service.get_org(db_session, org_id)
    await service.require_editor(request, db_session, current_user, org)
    page = await service.get_page_row(db_session, body.page_uuid, org_id)
    enforce_ai_rate_limit(current_user.id, org_id)
    ctx = await service.org_context(db_session, org)
    rows = (await db_session.execute(
        select(Course.course_uuid, Course.name).where(Course.org_id == org_id, Course.public == True, Course.published == True).limit(12)  # noqa: E712
    )).all()
    courses = [{"uuid": r[0], "name": r[1]} for r in rows]
    async with metering.charge("landing_generation", org_id=org_id, db=db_session, user_id=current_user.id):
        try:
            model_name = await resolve_model_for_org(org_id, db_session, purpose="chat")
            plan = await plan_page(brief=body.brief, ctx=ctx, courses=courses, model_name=model_name)
        except AINotConfiguredError as e:
            raise HTTPException(status_code=403, detail=str(e))
        except HTTPException:
            raise
        except Exception:
            logger.exception("Landing page generation failed")
            raise HTTPException(status_code=502, detail="Generation failed. Please try again.")
    try:
        doc = plan_to_doc(plan, ctx)
    except Exception:
        logger.exception("Landing page plan could not be built")
        raise HTTPException(status_code=502, detail="Generation failed. Please try again.")
    clean = await service._validated(db_session, org_id, doc)
    uid = current_user.id
    if page.draft.get("root"):
        await service._add_version(db_session, page, "template", page.draft, uid, label="Before AI design")
    page = await service.write_draft(db_session, page, clean, uid, base_revision=body.base_revision, checkpoint=False)
    return service.page_detail(page)


@router.post("/org/{org_id}/ai/copy", summary="Rewrite a text with AI")
async def api_ai_copy(request: Request, org_id: int, body: CopyBody, db_session: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_authenticated_user)) -> dict:
    from src.services.ai.llm import AINotConfiguredError, resolve_model_for_org
    from src.services.landing.ai import rewrite_copy

    reject_api_token_access(current_user)
    org = await service.get_org(db_session, org_id)
    await service.require_editor(request, db_session, current_user, org)
    enforce_ai_rate_limit(current_user.id, org_id)
    async with metering.charge("landing_copy", org_id=org_id, db=db_session, user_id=current_user.id):
        try:
            model_name = await resolve_model_for_org(org_id, db_session, purpose="chat")
            text = await rewrite_copy(text=body.text, instruction=body.instruction, context=body.context, model_name=model_name)
        except AINotConfiguredError as e:
            raise HTTPException(status_code=403, detail=str(e))
        except HTTPException:
            raise
        except Exception:
            logger.exception("Landing copy rewrite failed")
            raise HTTPException(status_code=502, detail="Rewrite failed. Please try again.")
    return {"text": text}


# ─── public ───────────────────────────────────────────────────────────────────


class FormBody(BaseModel):
    data: dict = Field(default_factory=dict)


@router.get("/public/{org_slug}", summary="A published page (or the draft, with a preview token)")
async def api_public_page(
    org_slug: str, slug: str = Query("", max_length=64), preview: Optional[str] = Query(None, max_length=100),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await service.public_page(db_session, org_slug, slug, preview)


@router.post("/public/{org_slug}/forms/{form_id}", summary="Send a contact form on a published page")
async def api_submit_form(
    request: Request, org_slug: str, form_id: str, body: FormBody, slug: str = Query("", max_length=64),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    if len(body.data) > 30:
        raise HTTPException(status_code=400, detail="Too many fields")
    return await service.submit_form(request, db_session, org_slug, slug, form_id[:40], body.data)
