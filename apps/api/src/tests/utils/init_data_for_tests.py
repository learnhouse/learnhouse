from sqlmodel import Session, select
from src.db.user_organizations import UserOrganization
from src.db.organizations import OrganizationCreate
from src.db.users import User, UserCreate
from src.services.install.install import (
    install_create_organization,
    install_create_organization_user,
    install_default_elements,
)


async def create_initial_data_for_tests(db_session: Session):
    # Install default elements
    await install_default_elements({}, db_session)

    # Initiate test Organization
    test_org = OrganizationCreate(
        name="Wayne Enterprises",
        description=None,
        slug="wayne",
        email="hello@wayne.dev",
        logo_image=None,
    )

    # Create test organization
    await install_create_organization(test_org, db_session)

    users = [
        UserCreate(
            username="batman",
            first_name="Bruce",
            last_name="Wayne",
            email="bruce@wayne.com",
            password="imbatman",
        ),
        UserCreate(
            username="robin",
            first_name="Richard John",
            last_name="Grayson",
            email="robin@wayne.com",
            password="secret",
        ),
    ]

    # Create 2 users in that Organization
    for user in users:
        await install_create_organization_user(user, "wayne", db_session)

    # Make robin a normal user
    statement = select(UserOrganization).join(User).where(User.username == "robin")
    user_org = db_session.exec(statement).first()

    user_org.role_id = 3 # type: ignore
    db_session.add(user_org)
    db_session.commit()

    return True
