"""
App manifest (learnhouse.json) parsing and scope handling.

An app bundle must contain a `learnhouse.json` at its root declaring the
app's identity and the API scopes it requests. Scopes use the form
`{bucket}:{read|write}` and map onto the same per-resource `Rights` buckets
that org API tokens use, so the existing RBAC token enforcement
(`authorization_verify_api_token_permissions`) applies unchanged.
"""

import json
import re
from typing import Optional

from fastapi import HTTPException, status
from pydantic import BaseModel, Field, ValidationError

MANIFEST_FILENAME = "learnhouse.json"

# Same resource buckets API tokens are restricted to (mirrors the allowlist in
# src/security/rbac/rbac.py and validate_rights_structure). Keep in sync.
APP_SCOPE_BUCKETS = [
    "courses",
    "activities",
    "coursechapters",
    "folders",
    "media",
    "certifications",
    "usergroups",
    "payments",
    "search",
    "assignments",
]

# Slugs that collide with dashboard routes under /dash/apps/.
RESERVED_APP_IDS = {"manage"}

_SCOPE_RE = re.compile(r"^([a-z]+):(read|write)$")
_APP_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$")
_VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,28}$")
# Relative in-bundle paths for entry/icon: no leading slash, no traversal.
_BUNDLE_PATH_RE = re.compile(r"^[A-Za-z0-9_\-][A-Za-z0-9_\-./]{0,253}$")


class AppManifest(BaseModel):
    """Validated contents of learnhouse.json"""
    manifest_version: int = Field(ge=1, le=1)
    id: str
    name: str = Field(min_length=1, max_length=100)
    version: str
    description: Optional[str] = Field(default=None, max_length=500)
    entry: str = "index.html"
    icon: Optional[str] = None
    scopes: list[str] = []


def _validate_bundle_path(path: str, field: str) -> str:
    if not _BUNDLE_PATH_RE.match(path) or ".." in path.split("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid manifest: '{field}' must be a safe relative path inside the bundle",
        )
    return path


def validate_scopes(scopes: list[str]) -> list[str]:
    """Validate scope strings; returns the deduplicated, sorted list."""
    seen = set()
    for scope in scopes:
        match = _SCOPE_RE.match(scope) if isinstance(scope, str) else None
        if not match or match.group(1) not in APP_SCOPE_BUCKETS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Invalid manifest: unknown scope '{scope}'. Scopes must be "
                    f"'{{bucket}}:read' or '{{bucket}}:write' with bucket one of {APP_SCOPE_BUCKETS}"
                ),
            )
        seen.add(scope)
    return sorted(seen)


def parse_manifest(raw: bytes) -> AppManifest:
    """Parse and validate a learnhouse.json payload."""
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid app package: {MANIFEST_FILENAME} is not valid JSON",
        )
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid app package: {MANIFEST_FILENAME} must be a JSON object",
        )

    try:
        manifest = AppManifest(**data)
    except ValidationError as e:
        first = e.errors()[0]
        loc = ".".join(str(p) for p in first.get("loc", []))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid manifest: {loc}: {first.get('msg', 'invalid value')}",
        )

    if not _APP_ID_RE.match(manifest.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid manifest: 'id' must be 3-40 chars of lowercase letters, digits and hyphens",
        )
    if manifest.id in RESERVED_APP_IDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid manifest: 'id' '{manifest.id}' is reserved",
        )
    if not _VERSION_RE.match(manifest.version):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid manifest: 'version' must be a short version string (e.g. 1.0.0)",
        )
    _validate_bundle_path(manifest.entry, "entry")
    if not manifest.entry.lower().endswith((".html", ".htm")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid manifest: 'entry' must be an HTML file",
        )
    if manifest.icon is not None:
        _validate_bundle_path(manifest.icon, "icon")
    manifest.scopes = validate_scopes(manifest.scopes)
    return manifest


def scopes_to_rights(scopes: list[str]) -> dict:
    """Map approved scope strings onto an API-token-compatible rights dict.

    Every bucket is present (all-false by default) so the shape matches what
    `validate_rights_structure` and the RBAC token checks expect. `read` grants
    action_read; `write` grants create/update/delete. Write deliberately does
    NOT imply read — an app wanting both must declare both.
    """
    rights: dict = {
        bucket: {
            "action_create": False,
            "action_read": False,
            "action_update": False,
            "action_delete": False,
        }
        for bucket in APP_SCOPE_BUCKETS
    }
    for scope in validate_scopes(scopes):
        bucket, action = scope.split(":")
        if action == "read":
            rights[bucket]["action_read"] = True
        else:
            rights[bucket]["action_create"] = True
            rights[bucket]["action_update"] = True
            rights[bucket]["action_delete"] = True
    return rights
