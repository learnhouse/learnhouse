"""
Tests for the Zapier integration router.

Exercises the router functions directly against an in-memory SQLite database.
Covers auth, plan gating, dynamic dropdowns, and REST Hook subscription CRUD.
"""

import asyncio
from datetime import datetime
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import JSON, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select
from starlette.requests import Request

from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.usergroups import UserGroup
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, APITokenUser, PublicUser, User
from src.db.webhooks import WebhookEndpoint
from src.routers.integrations.zapier import (
    ZapierSubscriptionCreate,
    _require_api_token,
    zapier_create_subscription,
    zapier_delete_subscription,
    zapier_list_courses,
    zapier_list_events,
    zapier_list_subscriptions,
    zapier_list_usergroups,
    zapier_list_users,
    zapier_me,
)


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        pass

    for table in SQLModel.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()

    SQLModel.metadata.create_all(engine)
    return engine


@pytest.fixture
def db(engine):
    with Session(engine) as session:
        yield session


@pytest.fixture
def org(db):
    o = Organization(
        id=1,
        name="Test Org",
        slug="test-org",
        email="test@org.com",
        org_uuid="org_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


@pytest.fixture
def other_org(db):
    o = Organization(
        id=2,
        name="Other",
        slug="other",
        email="o@o.com",
        org_uuid="org_other",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


@pytest.fixture
def user(db, org):
    u = User(
        id=1,
        username="testuser",
        first_name="Test",
        last_name="User",
        email="test@example.com",
        password="hashed",
        user_uuid="user_test",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    db.add(
        UserOrganization(
            user_id=u.id,
            org_id=org.id,
            role_id=1,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    db.commit()
    return u


@pytest.fixture
def token_user(org, user):
    return APITokenUser(
        id=1,
        user_uuid="apitoken_test",
        username="api_token",
        org_id=org.id,
        token_name="Test Token",
        created_by_user_id=user.id,
    )


@pytest.fixture
def other_token(other_org):
    return APITokenUser(
        id=2,
        user_uuid="apitoken_other",
        username="api_token",
        org_id=other_org.id,
        token_name="Other Token",
        created_by_user_id=99,
    )


@pytest.fixture
def course(db, org):
    c = Course(
        id=1,
        name="Test Course",
        description="desc",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid="course_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@pytest.fixture
def usergroup(db, org):
    g = UserGroup(
        id=1,
        name="Students",
        description="",
        org_id=org.id,
        usergroup_uuid="ug_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return g


@pytest.fixture
def request_obj():
    scope = {"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""}
    return Request(scope)


def _patch_plan_pro():
    return patch(
        "src.routers.integrations.zapier.get_org_plan",
        return_value="pro",
    )


def _patch_plan_free():
    return patch(
        "src.routers.integrations.zapier.get_org_plan",
        return_value="free",
    )


# ── _require_api_token ─────────────────────────────────────────────────────


class TestRequireApiToken:
    def test_accepts_api_token(self, token_user):
        assert _require_api_token(token_user) is token_user

    def test_rejects_public_user(self):
        public = PublicUser(
            id=1,
            email="a@b.c",
            username="x",
            first_name="A",
            last_name="B",
            user_uuid="user_x",
        )
        with pytest.raises(HTTPException) as exc:
            _require_api_token(public)
        assert exc.value.status_code == 401

    def test_rejects_anonymous(self):
        with pytest.raises(HTTPException) as exc:
            _require_api_token(AnonymousUser())
        assert exc.value.status_code == 401


# ── /me ─────────────────────────────────────────────────────────────────────


class TestZapierMe:
    def test_me_returns_org_context(self, db, token_user, org):
        with _patch_plan_pro():
            result = asyncio.run(zapier_me(ctx=(token_user, db)))
        assert result.org_id == org.id
        assert result.org_slug == "test-org"
        assert result.org_name == "Test Org"
        assert result.token_name == "Test Token"

    def test_me_rejects_free_plan(self, db, token_user):
        from src.routers.integrations.zapier import _require_pro_plan
        with _patch_plan_free(), patch(
            "src.routers.integrations.zapier.plan_meets_requirement",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as exc:
                _require_pro_plan(token_user.org_id, db)
        assert exc.value.status_code == 403
        assert "Pro plan" in exc.value.detail


# ── /events ─────────────────────────────────────────────────────────────────


class TestZapierEvents:
    def test_events_returns_registry(self, db, token_user):
        with _patch_plan_pro():
            result = asyncio.run(zapier_list_events(ctx=(token_user, db)))
        assert "events" in result
        assert "course_completed" in result["events"]
        assert "ping" in result["events"]


# ── Dynamic dropdowns ──────────────────────────────────────────────────────


class TestZapierCourses:
    def test_lists_only_own_org(self, db, token_user, course, other_org):
        # Add a course in another org
        other_course = Course(
            id=2,
            name="Other Org Course",
            description="",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=other_org.id,
            course_uuid="course_other",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(other_course)
        db.commit()

        with _patch_plan_pro():
            result = asyncio.run(zapier_list_courses(limit=100, ctx=(token_user, db)))
        assert len(result) == 1
        assert result[0].course_uuid == "course_test"


class TestZapierUsers:
    def test_lists_org_members(self, db, token_user, user):
        with _patch_plan_pro():
            result = asyncio.run(zapier_list_users(limit=100, ctx=(token_user, db)))
        assert len(result) == 1
        assert result[0].email == "test@example.com"


class TestZapierUsergroups:
    def test_lists_org_groups(self, db, token_user, usergroup):
        with _patch_plan_pro():
            result = asyncio.run(zapier_list_usergroups(limit=100, ctx=(token_user, db)))
        assert len(result) == 1
        assert result[0].name == "Students"


# ── Subscriptions CRUD ──────────────────────────────────────────────────────


class TestZapierSubscriptions:
    def test_create_subscription_persists_zapier_webhook(self, db, token_user, request_obj):
        payload = ZapierSubscriptionCreate(
            target_url="https://hooks.zapier.com/hooks/catch/123/abc",
            event="course_completed",
            zap_id="zap_abc",
            zap_name="My Zap",
        )
        with _patch_plan_pro():
            result = asyncio.run(
                zapier_create_subscription(
                    request=request_obj,
                    payload=payload,
                    ctx=(token_user, db),
                )
            )

        assert result.id > 0
        assert result.target_url == payload.target_url
        assert result.event == "course_completed"
        assert result.is_active is True

        stored = db.scalars(
            select(WebhookEndpoint).where(WebhookEndpoint.id == result.id)
        ).first()
        assert stored is not None
        assert stored.source == "zapier"
        assert stored.zap_name == "My Zap"
        assert stored.zap_id == "zap_abc"
        assert stored.events == ["course_completed"]
        assert stored.secret_encrypted  # defence-in-depth secret persisted

    def test_create_rejects_unknown_event(self, db, token_user, request_obj):
        payload = ZapierSubscriptionCreate(
            target_url="https://hooks.zapier.com/hooks/catch/1/x",
            event="nonexistent_event",
        )
        with _patch_plan_pro():
            with pytest.raises(HTTPException) as exc:
                asyncio.run(
                    zapier_create_subscription(
                        request=request_obj,
                        payload=payload,
                        ctx=(token_user, db),
                    )
                )
        assert exc.value.status_code == 400

    def test_list_subscriptions_only_own_org_and_zapier_source(
        self, db, token_user, other_token, request_obj
    ):
        # Create one via the router under our token
        with _patch_plan_pro():
            asyncio.run(
                zapier_create_subscription(
                    request=request_obj,
                    payload=ZapierSubscriptionCreate(
                        target_url="https://hooks.zapier.com/hooks/catch/1/a",
                        event="ping",
                        zap_name="A",
                    ),
                    ctx=(token_user, db),
                )
            )

        # A manual (non-Zapier) webhook in the same org — should NOT appear
        db.add(
            WebhookEndpoint(
                webhook_uuid="webhook_manual",
                org_id=token_user.org_id,
                url="https://example.com/manual",
                secret_encrypted="x",
                description="manual",
                events=["ping"],
                is_active=True,
                source="manual",
                created_by_user_id=1,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        # A Zapier webhook in another org — should NOT appear
        db.add(
            WebhookEndpoint(
                webhook_uuid="webhook_other",
                org_id=other_token.org_id,
                url="https://hooks.zapier.com/hooks/catch/2/x",
                secret_encrypted="x",
                description="other org",
                events=["ping"],
                is_active=True,
                source="zapier",
                created_by_user_id=1,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with _patch_plan_pro():
            result = asyncio.run(zapier_list_subscriptions(ctx=(token_user, db)))
        assert len(result) == 1
        assert result[0].zap_name == "A"

    def test_delete_subscription_removes_row(self, db, token_user, request_obj):
        with _patch_plan_pro():
            created = asyncio.run(
                zapier_create_subscription(
                    request=request_obj,
                    payload=ZapierSubscriptionCreate(
                        target_url="https://hooks.zapier.com/hooks/catch/1/a",
                        event="ping",
                    ),
                    ctx=(token_user, db),
                )
            )
            asyncio.run(
                zapier_delete_subscription(
                    subscription_id=created.id,
                    ctx=(token_user, db),
                )
            )

        remaining = db.scalars(
            select(WebhookEndpoint).where(WebhookEndpoint.id == created.id)
        ).first()
        assert remaining is None

    def test_delete_refuses_cross_org(
        self, db, token_user, other_token, request_obj
    ):
        # Create a Zapier webhook in other org
        with _patch_plan_pro():
            with patch(
                "src.routers.integrations.zapier.get_org_plan",
                return_value="pro",
            ):
                created = asyncio.run(
                    zapier_create_subscription(
                        request=request_obj,
                        payload=ZapierSubscriptionCreate(
                            target_url="https://hooks.zapier.com/hooks/catch/2/x",
                            event="ping",
                        ),
                        ctx=(other_token, db),
                    )
                )

        # Our token tries to delete — should 404 (not leak existence)
        with _patch_plan_pro():
            with pytest.raises(HTTPException) as exc:
                asyncio.run(
                    zapier_delete_subscription(
                        subscription_id=created.id,
                        ctx=(token_user, db),
                    )
                )
        assert exc.value.status_code == 404

    def test_delete_refuses_manual_webhook(self, db, token_user):
        # Create a manual webhook in our org
        wh = WebhookEndpoint(
            webhook_uuid="webhook_manual",
            org_id=token_user.org_id,
            url="https://example.com/manual",
            secret_encrypted="x",
            description="manual",
            events=["ping"],
            is_active=True,
            source="manual",
            created_by_user_id=1,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(wh)
        db.commit()
        db.refresh(wh)

        with _patch_plan_pro():
            with pytest.raises(HTTPException) as exc:
                asyncio.run(
                    zapier_delete_subscription(
                        subscription_id=wh.id,
                        ctx=(token_user, db),
                    )
                )
        assert exc.value.status_code == 404
