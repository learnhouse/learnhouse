from fastapi import HTTPException
from sqlmodel import select

from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization, OrganizationCreate
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.users import User, UserCreate
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.security.security import security_verify_password
from src.services.setup.setup import (
    install_create_organization,
    install_create_organization_user,
    install_default_elements,
)


def test_install_default_elements_creates_and_updates_roles(db):
    stale_admin = Role(
        id=1,
        name="Old Admin",
        description="stale",
        role_type=RoleTypeEnum.TYPE_GLOBAL,
        role_uuid="stale-admin",
        rights={},
        creation_date="old",
        update_date="old",
    )
    db.add(stale_admin)
    db.commit()

    assert install_default_elements(db) is True

    roles = db.exec(select(Role).order_by(Role.id)).all()

    assert [role.id for role in roles] == [1, 2, 3, 4]
    assert roles[0].name == "Admin"
    assert roles[0].role_uuid == "role_global_admin"
    assert roles[0].rights["dashboard"]["action_access"] is True
    assert roles[3].name == "User"


def test_install_create_organization_creates_org_and_default_config(db):
    org = install_create_organization(
        OrganizationCreate(
            name="Acme",
            slug="acme",
            email="hello@acme.example.com",
        ),
        db,
    )

    config = db.exec(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    ).one()

    assert isinstance(org, Organization)
    assert org.org_uuid.startswith("org_")
    assert config.config["config_version"] == "2.0"
    assert config.config["plan"] == "free"


def test_install_create_organization_user_creates_user_and_admin_membership(db):
    org = install_create_organization(
        OrganizationCreate(
            name="Acme",
            slug="acme",
            email="hello@acme.example.com",
        ),
        db,
    )

    user = install_create_organization_user(
        UserCreate(
            username="founder",
            first_name="Ada",
            last_name="Lovelace",
            email="ada@acme.example.com",
            password="correct horse battery staple",
        ),
        org.slug,
        db,
    )

    stored_user = db.exec(select(User).where(User.id == user.id)).one()
    membership = db.exec(
        select(UserOrganization).where(UserOrganization.user_id == user.id)
    ).one()

    assert user.user_uuid.startswith("user_")
    assert stored_user.email_verified is False
    assert stored_user.password != "correct horse battery staple"
    assert security_verify_password("correct horse battery staple", stored_user.password)
    assert membership.org_id == org.id
    assert membership.role_id == ADMIN_ROLE_ID


def test_install_create_organization_user_rejects_missing_org(db):
    try:
        install_create_organization_user(
            UserCreate(
                username="founder",
                first_name="Ada",
                last_name="Lovelace",
                email="ada@acme.example.com",
                password="pw",
            ),
            "missing-org",
            db,
        )
    except HTTPException as exc:
        assert exc.status_code == 409
        assert exc.detail == "Organization does not exist"
    else:
        raise AssertionError("Expected HTTPException")


def test_install_create_organization_user_rejects_duplicate_username_and_email(db):
    org = install_create_organization(
        OrganizationCreate(
            name="Acme",
            slug="acme",
            email="hello@acme.example.com",
        ),
        db,
    )
    existing = User(
        username="founder",
        first_name="Ada",
        last_name="Lovelace",
        email="ada@acme.example.com",
        password="hashed",
        user_uuid="user_existing",
        creation_date="now",
        update_date="now",
    )
    db.add(existing)
    db.commit()

    for payload, expected_detail in (
        (
            UserCreate(
                username="founder",
                first_name="Grace",
                last_name="Hopper",
                    email="grace@acme.example.com",
                password="pw",
            ),
            "Username already exists",
        ),
        (
            UserCreate(
                username="grace",
                first_name="Grace",
                last_name="Hopper",
                    email="ada@acme.example.com",
                password="pw",
            ),
            "Email already exists",
        ),
    ):
        try:
            install_create_organization_user(payload, org.slug, db)
        except HTTPException as exc:
            assert exc.status_code == 409
            assert exc.detail == expected_detail
        else:
            raise AssertionError("Expected HTTPException")
