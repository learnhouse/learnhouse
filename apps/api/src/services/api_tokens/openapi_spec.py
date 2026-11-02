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
}

HTTP_METHODS = {"get", "post", "put", "patch", "delete"}
SCHEMA_REF_PREFIX = "#/components/schemas/"


def _normalize_tag(tag: str) -> str:
    return re.sub(r"[^a-z]", "", tag.lower())


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
            and _normalize_tag((operation.get("tags") or ["other"])[0]) in API_TOKEN_TAGS
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
    spec["components"] = {
        "schemas": {name: all_schemas[name] for name in sorted(needed) if name in all_schemas}
    }
    return copy.deepcopy(spec)


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
