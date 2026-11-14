import copy
import re
from typing import Any

from fastapi import HTTPException, Request, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.org_auth import require_org_role_permission
from src.security.rbac.rbac import authorization_verify_if_user_is_anon
from src.services.api_tokens.api_tokens import _block_api_tokens


# Resource tags API tokens can reach. The public /openapi.json is off outside
# dev mode because it lists every internal route, so the API Access playground
# gets this filtered copy instead.
API_TOKEN_TAGS = {
    "admin",
    "courses",
    "activities",
    "assignments",
    "coursechapters",
    "chapters",
    "folders",
    "media",
    "certifications",
    "usergroups",
    "payments",
    "search",
    # Plays authoring API (EE: ee/routers/playgrounds/plays_api.py; absent
    # without EE). The learner and session-only play routes lead with the
    # "playgrounds" tag and stay out.
    "plays",
    # The tools API (src/routers/tools_api.py): every token-callable agent
    # tool as POST /tools/{name}, tagged "tools/<toolset>"; plus its listing.
    "tools",
    # CRM integrations (EE: ee/routers/crm.py; absent without EE). Routes
    # that need a signed-in admin lead with "crm-admin" and stay out.
    "crm",
}
# Tag prefix of the tools API routes (normalized "tools/courses" -> "toolscourses").
TOOLS_TAG_PREFIX = "tools"

HTTP_METHODS = {"get", "post", "put", "patch", "delete"}

# Scope documentation shown in the API Access playground: what a token's
# rights on a resource bucket let it do.
TAG_DOCS = {
    "usergroups": (
        "Scope `usergroups` (token rights: read, create, update, delete). "
        "**read**: list groups and their overview, members, access, progress, history, join codes. "
        "**create**: create groups, join codes and announcements; add members and resources. "
        "**update**: change a group's type, smart rules, parent, settings and access windows; "
        "schedule or expire memberships; import CSVs; bulk add/move; managers; run a sync. "
        "**delete**: delete groups, remove members and resources, revoke codes. "
        "A token is bound to one organization; ids from another organization are refused. "
        "Smart rules, nesting, managers, group spaces and messaging need the Pro plan; "
        "emailing a group also needs newsletter rights and follows the newsletter's sending rules."
    ),
    "crm": (
        "Scope `crm` (token rights: read, update). "
        "**read**: CRM integrations and their health, sync errors, history, synced records, a member's CRM record, "
        "the field mapping, CRM properties, pipelines, lists and inbound rules. "
        "**update**: change the field mapping, start a sync or backfill, retry failed records, pause or resume. "
        "Connecting a CRM, consent, settings, inbound rules and creating CRM properties need an org admin in the dashboard. "
        "Access tokens of the CRM are never returned. HubSpot needs the Pro plan, Salesforce Enterprise."
    ),
}
SCHEMA_REF_PREFIX = "#/components/schemas/"


def _normalize_tag(tag: str) -> str:
    return re.sub(r"[^a-z]", "", tag.lower())


def _token_tag(tag: str) -> bool:
    normalized = _normalize_tag(tag)
    return normalized in API_TOKEN_TAGS or tag.lower().startswith(f"{TOOLS_TAG_PREFIX}/")


def _collect_schema_refs(node: Any, refs: set[str]) -> None:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith(SCHEMA_REF_PREFIX):
            refs.add(ref[len(SCHEMA_REF_PREFIX):])
        for value in node.values():
            _collect_schema_refs(value, refs)
    elif isinstance(node, list):
        for value in node:
            _collect_schema_refs(value, refs)


def build_api_token_openapi_spec(full_spec: dict) -> dict:
    """Keep only the operations API tokens can call, and the schemas they use."""
    paths: dict = {}
    for path, operations in full_spec.get("paths", {}).items():
        kept = {
            method: operation
            for method, operation in operations.items()
            if method in HTTP_METHODS
            and _token_tag((operation.get("tags") or ["other"])[0])
        }
        if kept:
            paths[path] = kept

    all_schemas = full_spec.get("components", {}).get("schemas", {})
    needed: set[str] = set()
    _collect_schema_refs(paths, needed)
    pending = list(needed)
    while pending:
        nested: set[str] = set()
        _collect_schema_refs(all_schemas.get(pending.pop(), {}), nested)
        for name in nested - needed:
            needed.add(name)
            pending.append(name)

    spec = {key: value for key, value in full_spec.items() if key not in ("paths", "components")}
    spec["paths"] = paths
    used = {_normalize_tag((op.get("tags") or ["other"])[0]) for ops in paths.values() for op in ops.values()}
    known = {t.get("name") for t in spec.get("tags") or [] if isinstance(t, dict)}
    spec["tags"] = [*(spec.get("tags") or []), *(
        {"name": name, "description": text} for name, text in TAG_DOCS.items() if name in used and name not in known
    )]
    spec["components"] = {
        "schemas": {name: all_schemas[name] for name in sorted(needed) if name in all_schemas}
    }
    spec = copy.deepcopy(spec)
    for ops in spec["paths"].values():
        for method, op in ops.items():
            tag = _normalize_tag((op.get("tags") or ["other"])[0])
            if tag in ("usergroups", "crm"):
                op["x-learnhouse-scope"] = f"{tag}." + ("read" if method == "get" else "delete" if method == "delete" else "update")
    return spec


_cached_spec: dict | None = None


async def get_api_token_openapi_spec(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> dict:
    """OpenAPI spec for the API Access playground, scoped to API token routes."""
    global _cached_spec
    _block_api_tokens(current_user)
    await authorization_verify_if_user_is_anon(current_user.id)

    statement = select(Organization).where(Organization.id == org_id)
    organization = (await db_session.execute(statement)).scalars().first()
    if not organization:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    # Same gate as listing the org's tokens.
    await require_org_role_permission(current_user.id, org_id, db_session, "roles", "action_read")

    if _cached_spec is None:
        _cached_spec = build_api_token_openapi_spec(request.app.openapi())
    return _cached_spec
