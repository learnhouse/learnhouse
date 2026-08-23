"""Entry into the shared demo, and the guardrails around it."""

from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from src.db.demo_state import DEMO_STATE_ID, DemoState, DemoStateEnum
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser
from src.routers.demo import demo_status, enter_demo
from src.security.rbac.constants import ADMIN_ROLE_ID


def _always(value):
    """An async stand-in that ignores its arguments and returns `value`."""

    async def _stub(*args, **kwargs):
        return value

    return _stub


@pytest.fixture
def demo_on(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_DEMO_ENABLED", "1")
    monkeypatch.setenv("LEARNHOUSE_DEMO_SLUG", "demo")


@pytest.fixture
async def ready_demo(db, demo_on):
    org = Organization(
        # Explicit id: the shared `org` fixture pins id=1, and tests that use
        # both would otherwise collide.
        id=99,
        name="Demo Academy",
        slug="demo",
        email="demo@example.com",
        org_uuid="org_demo",
        is_demo=True,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(org)
    await db.flush()
    db.add(
        DemoState(
            id=DEMO_STATE_ID,
            org_id=org.id,
            state=DemoStateEnum.READY,
            bundle_version="1.0.0",
            content_epoch="2026-08-09",
            last_refresh_at=str(datetime.now()),
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    return org


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

async def test_status_reports_disabled_when_the_flag_is_off(db, monkeypatch):
    monkeypatch.delenv("LEARNHOUSE_DEMO_ENABLED", raising=False)
    status = await demo_status(db_session=db)
    assert status.enabled is False
    assert status.ready is False


async def test_status_reports_ready(db, ready_demo):
    status = await demo_status(db_session=db)
    assert status.enabled is True
    assert status.ready is True
    assert status.slug == "demo"
    assert status.next_refresh_at is not None


async def test_status_is_not_ready_before_the_first_sync(db, demo_on):
    status = await demo_status(db_session=db)
    assert status.enabled is True
    assert status.ready is False


# ---------------------------------------------------------------------------
# entering
# ---------------------------------------------------------------------------

async def test_entering_joins_the_user_as_admin(db, ready_demo, admin_user):
    result = await enter_demo(db_session=db, current_user=admin_user)

    assert result.org_slug == "demo"

    membership = (
        await db.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == admin_user.id,
                UserOrganization.org_id == ready_demo.id,
            )
        )
    ).scalars().first()
    assert membership is not None
    assert membership.role_id == ADMIN_ROLE_ID


async def test_entering_twice_does_not_duplicate_membership(db, ready_demo, admin_user):
    """A returning visitor must not accumulate memberships."""
    await enter_demo(db_session=db, current_user=admin_user)
    await enter_demo(db_session=db, current_user=admin_user)

    rows = (
        await db.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == admin_user.id,
                UserOrganization.org_id == ready_demo.id,
            )
        )
    ).scalars().all()
    assert len(rows) == 1


async def test_anonymous_users_are_rejected(db, ready_demo):
    with pytest.raises(HTTPException) as exc:
        await enter_demo(db_session=db, current_user=AnonymousUser())
    assert exc.value.status_code == 401


async def test_entering_a_disabled_demo_is_a_404(db, admin_user, monkeypatch):
    monkeypatch.delenv("LEARNHOUSE_DEMO_ENABLED", raising=False)
    with pytest.raises(HTTPException) as exc:
        await enter_demo(db_session=db, current_user=admin_user)
    assert exc.value.status_code == 404


async def test_entering_while_provisioning_is_a_409(db, demo_on, admin_user):
    """Being built is a different thing from being unavailable."""
    db.add(
        DemoState(
            id=DEMO_STATE_ID,
            state=DemoStateEnum.PROVISIONING,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await enter_demo(db_session=db, current_user=admin_user)
    assert exc.value.status_code == 409


# ---------------------------------------------------------------------------
# guardrails
# ---------------------------------------------------------------------------

async def test_invites_are_blocked_in_the_demo(db, ready_demo, admin_user):
    """The abuse vector: an admin in a shared org emailing strangers."""
    from src.services.orgs.invites import create_invite_code

    with pytest.raises(HTTPException) as exc:
        await create_invite_code(
            request=None,  # type: ignore[arg-type]
            org_id=ready_demo.id,
            current_user=admin_user,
            db_session=db,
        )
    assert exc.value.status_code == 403
    # Pinned to the guard's own message: RBAC also answers 403 here, so without
    # this the test would keep passing even if the guard were removed.
    assert "demo" in str(exc.value.detail).lower()


async def test_invites_still_work_for_a_real_org(db, org, admin_user):
    """The guard must not block ordinary organizations.

    Invite creation reaches Redis, which CI does not run, so the call is
    expected to blow up somewhere further along. Catching everything and
    asserting only on the 403 keeps the test about the one thing it can
    honestly check — that a real org is not rejected as a demo org — instead of
    passing or failing on whether a Redis server happens to be listening.
    """
    from src.services.orgs.invites import create_invite_code

    try:
        await create_invite_code(
            request=None,  # type: ignore[arg-type]
            org_id=org.id,
            current_user=admin_user,
            db_session=db,
        )
    except HTTPException as exc:
        assert exc.status_code != 403, "the demo guard blocked a real organization"
    except Exception:
        pass  # Redis, or anything else past the guard: not what this asserts.


async def test_batch_invites_are_blocked_in_the_demo(db, ready_demo, admin_user):
    """The endpoint that actually sends the mail needs its own guard.

    Guarding only create_invite_code guarded nothing that matters: the invite
    code is optional on this route, and without one the mail still goes out
    pointing at the org's signup page. Every visitor is an admin here, and the
    free-tier age gate that exists to stop exactly this exempts paid plans —
    which the demo runs on — so a minutes-old account could otherwise have the
    platform email 25 strangers at a time.
    """
    from src.services.orgs.users import invite_batch_users

    # Enter the demo the way a visitor does, so the caller genuinely holds
    # admin on it. Without this the call is refused by RBAC instead and the
    # test proves nothing about the demo guard.
    await enter_demo(db_session=db, current_user=admin_user)

    with pytest.raises(HTTPException) as exc:
        await invite_batch_users(
            request=None,  # type: ignore[arg-type]
            org_id=ready_demo.id,
            emails="victim@example.com",
            invite_code_uuid=None,
            db_session=db,
            current_user=admin_user,
        )
    assert exc.value.status_code == 403
    assert "demo" in str(exc.value.detail).lower(), (
        f"403 came from somewhere other than the demo guard: {exc.value.detail}"
    )


async def test_custom_scripts_cannot_be_set_on_the_demo_org(
    db, ready_demo, admin_user, monkeypatch
):
    """Stored XSS on a shared public organization.

    OrgScripts injects every entry of `Organization.scripts` as a real <script>
    element on each page of that org. Every demo visitor holds admin, so
    without this guard one visitor could run arbitrary JavaScript in every
    later visitor's browser — on a public subdomain, indefinitely.
    """
    from src.db.organizations import OrganizationUpdate
    from src.services.orgs.orgs import update_org

    # The caller must get past RBAC first, or the 403 below is the ordinary
    # "not an admin here" one and this test proves nothing about the guard.
    async def _allow(*args, **kwargs):
        return True

    monkeypatch.setattr("src.services.orgs.orgs.rbac_check", _allow)

    payload = OrganizationUpdate(
        scripts={"scripts": [{"name": "pwn", "content": "alert(document.cookie)"}]}
    )

    with pytest.raises(HTTPException) as exc:
        await update_org(
            request=None,  # type: ignore[arg-type]
            org_object=payload,
            org_id=ready_demo.id,
            current_user=admin_user,
            db_session=db,
        )
    assert exc.value.status_code == 403
    assert "scripts" in str(exc.value.detail).lower()


async def test_deleting_the_demo_org_is_blocked(db, ready_demo, admin_user):
    """Every visitor is an admin, so RBAC alone would let any of them do it."""
    from src.services.orgs.orgs import delete_org

    with pytest.raises(HTTPException) as exc:
        await delete_org(
            request=None,  # type: ignore[arg-type]
            org_id=ready_demo.id,
            current_user=admin_user,
            db_session=db,
        )
    assert exc.value.status_code == 403


async def test_resetting_a_members_two_factor_is_blocked_in_the_demo(
    db, ready_demo, admin_user, monkeypatch
):
    """The worst thing an admin of a shared sandbox could reach.

    Two-factor is a property of the account, not of a membership: UserMFA and
    UserMFABackupCode carry no org column, so the reset clears the target's
    factor everywhere they log in. Every visitor is an admin here, and anyone
    who has ever opened the demo counts as a member of it — so without this
    guard a visitor could strip the two-factor off a stranger's real account
    and then go after their password.
    """
    from src.routers.mfa import api_org_reset_member_mfa

    await enter_demo(db_session=db, current_user=admin_user)

    monkeypatch.setattr("src.security.org_auth.is_org_admin", _always(True))
    monkeypatch.setattr("src.routers.mfa._require_human_user", _always(admin_user))

    with pytest.raises(HTTPException) as exc:
        await api_org_reset_member_mfa(
            org_id=ready_demo.id,
            user_id=4242,
            db_session=db,
            current_user=admin_user,
        )
    assert exc.value.status_code == 403
    assert "demo" in str(exc.value.detail).lower()


async def test_two_factor_compliance_list_hides_other_visitors(
    db, ready_demo, admin_user, monkeypatch
):
    """The same listing the members page filters, in a more damaging form.

    It pairs each real visitor's email with whether they have two-factor
    enabled, sorted with the unprotected accounts first.
    """
    from datetime import datetime as _datetime

    from src.db.users import User
    from src.routers.mfa import api_org_mfa_compliance_list

    await enter_demo(db_session=db, current_user=admin_user)

    stranger = User(
        id=888,
        username="stranger",
        first_name="Stran",
        last_name="Ger",
        email="stranger@example.com",
        password="hashed",
        user_uuid="user_stranger_mfa",
        signup_method="email",
        creation_date=str(_datetime.now()),
        update_date=str(_datetime.now()),
    )
    db.add(stranger)
    await db.flush()
    db.add(
        UserOrganization(
            user_id=stranger.id,
            org_id=ready_demo.id,
            role_id=ADMIN_ROLE_ID,
            creation_date=str(_datetime.now()),
            update_date=str(_datetime.now()),
        )
    )
    await db.commit()

    monkeypatch.setattr("src.security.org_auth.is_org_admin", _always(True))
    monkeypatch.setattr("src.routers.mfa._require_human_user", _always(admin_user))

    result = await api_org_mfa_compliance_list(
        org_id=ready_demo.id, db_session=db, current_user=admin_user
    )

    emails = {member["email"] for member in result["members"]}
    assert "stranger@example.com" not in emails
    assert admin_user.email in emails, "you can always see yourself"


async def test_api_tokens_cannot_be_minted_in_the_demo(db, ready_demo, admin_user):
    """A token here is a key to the headless admin surface of a shared org.

    That surface reaches the user export, the anonymize endpoint and the
    magic-link route, whose targets are the real people who once opened the
    demo. The refresh sweeps minted tokens, but a session minted with one
    outlives the sweep.
    """
    from src.db.api_tokens import APITokenCreate
    from src.services.api_tokens.api_tokens import create_api_token

    await enter_demo(db_session=db, current_user=admin_user)

    with pytest.raises(HTTPException) as exc:
        await create_api_token(
            request=None,  # type: ignore[arg-type]
            org_id=ready_demo.id,
            token_data=APITokenCreate(name="mine"),
            current_user=admin_user,
            db_session=db,
        )
    assert exc.value.status_code == 403
    assert "demo" in str(exc.value.detail).lower()


async def test_webhooks_cannot_be_registered_in_the_demo(db, ready_demo, admin_user):
    """An endpoint here is a live feed of the next visitor's email address."""
    from src.db.webhooks import WebhookEndpointCreate
    from src.services.webhooks.webhooks import create_webhook_endpoint

    await enter_demo(db_session=db, current_user=admin_user)

    with pytest.raises(HTTPException) as exc:
        await create_webhook_endpoint(
            request=None,  # type: ignore[arg-type]
            db_session=db,
            org_id=ready_demo.id,
            webhook_object=WebhookEndpointCreate(
                url="https://attacker.example.com/hook",
                events=["user.signed_up"],
                description="mine",
            ),
            current_user=admin_user,
        )
    assert exc.value.status_code == 403
    assert "demo" in str(exc.value.detail).lower()


async def test_status_survives_an_unparsable_last_refresh(db, demo_on):
    """The countdown is cosmetic; a bad timestamp must not 500 the endpoint."""
    db.add(
        DemoState(
            id=DEMO_STATE_ID,
            state=DemoStateEnum.READY,
            bundle_version="1.0.0",
            content_epoch="2026-08-09",
            last_refresh_at="not a timestamp",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()

    status = await demo_status(db_session=db)

    assert status.enabled is True
    assert status.next_refresh_at is None


async def test_entering_is_a_409_when_the_state_points_at_no_org(db, demo_on, admin_user):
    """READY but orphaned: mid-provision, or after the org was removed."""
    db.add(
        DemoState(
            id=DEMO_STATE_ID,
            org_id=4242,
            state=DemoStateEnum.READY,
            bundle_version="1.0.0",
            content_epoch="2026-08-09",
            last_refresh_at=str(datetime.now()),
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await enter_demo(db_session=db, current_user=admin_user)
    assert exc.value.status_code == 409
