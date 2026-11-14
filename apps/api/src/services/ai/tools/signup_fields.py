"""Signup fields tool: the extra questions the organization's signup form asks.

The fields are public by design (the signup page shows them to anyone), so
any member and any API token of the organization may read them. Each field
can also save its answer to the member's people data (``people_field``, used
by the Enterprise people directory and required training). Editing them stays
in the dashboard's signup settings.
"""

from __future__ import annotations

from pydantic import BaseModel

from src.security.rbac import AccessAction
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.orgs.signup_fields import get_org_signup_fields


class NoParams(BaseModel):
    pass


async def _get_signup_fields(ctx: ToolContext, p: NoParams):
    fields = await get_org_signup_fields(ctx.org.id, ctx.db_session)
    base = await refs.web_base(ctx)
    return {
        "fields": [jsonable(f) for f in sorted(fields, key=lambda f: f.order)],
        "total": len(fields),
        "saved_to_people_data": [f.key for f in fields if f.people_field],
        "url": f"{base}/dash/users/settings/signups" if base else None,
    }


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="get_signup_fields",
        title="Signup fields",
        description=(
            "The custom questions on the organization's signup form: key, label, type, required, options, "
            "and which people-data field (department, title, manager...) each answer is saved to."
        ),
        params_model=NoParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_get_signup_fields,
        idempotent=True,
    ),
]
