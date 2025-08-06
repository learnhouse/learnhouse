from datetime import datetime
import json
from uuid import uuid4
from fastapi import HTTPException, Request
from sqlalchemy import desc
from sqlmodel import Session, select
from src.db.install import Install, InstallRead
from src.db.organization_config import (
    AIOrgConfig,
    APIOrgConfig,
    AnalyticsOrgConfig,
    AssignmentOrgConfig,
    CollaborationOrgConfig,
    CourseOrgConfig,
    DiscussionOrgConfig,
    MemberOrgConfig,
    OrgCloudConfig,
    OrgFeatureConfig,
    OrgGeneralConfig,
    OrganizationConfig,
    OrganizationConfigBase,
    PaymentOrgConfig,
    StorageOrgConfig,
    UserGroupOrgConfig,
)
from src.db.organizations import Organization, OrganizationCreate
from src.db.roles import DashboardPermission, Permission, PermissionsWithOwn, Rights, Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.users import User, UserCreate, UserRead
from config.config import get_learnhouse_config
from src.security.security import security_hash_password


async def isInstallModeEnabled():
    config = get_learnhouse_config()

    if config.general_config.install_mode:
        return True
    else:
        raise HTTPException(
            status_code=403,
            detail="Install mode is not enabled",
        )


async def create_install_instance(request: Request, data: dict, db_session: Session):
    install = Install.model_validate(data)

    # complete install instance
    install.install_uuid = str(f"install_{uuid4()}")
    install.update_date = str(datetime.now())
    install.creation_date = str(datetime.now())
    install.step = 1
    # insert install instance
    db_session.add(install)

    # commit changes
    db_session.commit()

    # refresh install instance
    db_session.refresh(install)

    install = InstallRead.model_validate(install)

    return install


async def get_latest_install_instance(request: Request, db_session: Session):
    statement = select(Install).order_by(desc(Install.creation_date)).limit(1)
    install = db_session.exec(statement).first()

    if install is None:
        raise HTTPException(
            status_code=404,
            detail="No install instance found",
        )

    install = InstallRead.model_validate(install)

    return install


async def update_install_instance(
    request: Request, data: dict, step: int, db_session: Session
):
    statement = select(Install).order_by(desc(Install.creation_date)).limit(1)
    install = db_session.exec(statement).first()

    if install is None:
        raise HTTPException(
            status_code=404,
            detail="No install instance found",
        )

    install.step = step
    install.data = data

    # commit changes
    db_session.commit()

    # refresh install instance
    db_session.refresh(install)

    install = InstallRead.model_validate(install)

    return install


############################################################################################################
# Steps
############################################################################################################


# Install Default roles
def install_default_elements(db_session: Session):
    """ """
    # remove all default roles
    statement = select(Role).where(Role.role_type == RoleTypeEnum.TYPE_GLOBAL)
    roles = db_session.exec(statement).all()

    for role in roles:
        db_session.delete(role)

    db_session.commit()

    # Check if default roles already exist
    statement = select(Role).where(Role.role_type == RoleTypeEnum.TYPE_GLOBAL)
    roles = db_session.exec(statement).all()

    if roles and len(roles) == 4:
        raise HTTPException(
            status_code=409,
            detail="Default roles already exist",
        )

    # Create default roles
    role_global_admin = Role(
        name="Admin",
        description="Full platform control",
        id=1,
        role_type=RoleTypeEnum.TYPE_GLOBAL,
        role_uuid="role_global_admin",
        rights=Rights(
            courses=PermissionsWithOwn(
                action_create=True,
                action_read=True,
                action_read_own=True,
                action_update=True,
                action_update_own=True,
                action_delete=True,
                action_delete_own=True,
            ),
            users=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            usergroups=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            collections=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            organizations=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            coursechapters=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            activities=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            roles=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            dashboard=DashboardPermission(
                action_access=True,
            ),
        ),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    role_global_maintainer = Role(
        name="Maintainer",
        description="Mid-level manager, wide permissions but no platform control",
        id=2,
        role_type=RoleTypeEnum.TYPE_GLOBAL,
        role_uuid="role_global_maintainer",
        rights=Rights(
            courses=PermissionsWithOwn(
                action_create=True,
                action_read=True,
                action_read_own=True,
                action_update=True,
                action_update_own=True,
                action_delete=True,
                action_delete_own=True,
            ),
            users=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=False,
            ),
            usergroups=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            collections=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            organizations=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            coursechapters=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            activities=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            roles=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            dashboard=DashboardPermission(
                action_access=True,
            ),
        ),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    role_global_instructor = Role(
        name="Instructor",
        description="Can manage their own content",
        id=3,
        role_type=RoleTypeEnum.TYPE_GLOBAL,
        role_uuid="role_global_instructor",
        rights=Rights(
            courses=PermissionsWithOwn(
                action_create=True,
                action_read=True,
                action_read_own=True,
                action_update=False,
                action_update_own=True,
                action_delete=False,
                action_delete_own=True,
            ),
            users=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            usergroups=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            collections=Permission(
                action_create=True,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            organizations=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            coursechapters=Permission(
                action_create=True,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            activities=Permission(
                action_create=True,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            roles=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            dashboard=DashboardPermission(
                action_access=True,
            ),
        ),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    role_global_user = Role(
        name="User",
        description="Read-Only Learner",
        role_type=RoleTypeEnum.TYPE_GLOBAL,
        role_uuid="role_global_user",
        id=4,
        rights=Rights(
            courses=PermissionsWithOwn(
                action_create=False,
                action_read=True,
                action_read_own=True,
                action_update=False,
                action_update_own=False,
                action_delete=True,
                action_delete_own=True,
            ),
            users=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            usergroups=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            collections=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            organizations=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            coursechapters=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            activities=Permission(
                action_create=False,
                action_read=True,
                action_update=False,    
                action_delete=False,
            ),
            roles=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            dashboard=DashboardPermission(
                action_access=False,
            ),
        ),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # Serialize rights to JSON
    role_global_admin.rights = role_global_admin.rights.dict()  # type: ignore
    role_global_maintainer.rights = role_global_maintainer.rights.dict()  # type: ignore
    role_global_instructor.rights = role_global_instructor.rights.dict()  # type: ignore
    role_global_user.rights = role_global_user.rights.dict()  # type: ignore

    # Insert roles in DB
    db_session.add(role_global_admin)
    db_session.add(role_global_maintainer)
    db_session.add(role_global_instructor)
    db_session.add(role_global_user)

    # commit changes
    db_session.commit()

    # refresh roles
    db_session.refresh(role_global_admin)

    return True


# Organization creation
def install_create_organization(org_object: OrganizationCreate, db_session: Session):
    org = Organization.model_validate(org_object)

    # Complete the org object
    org.org_uuid = f"org_{uuid4()}"
    org.creation_date = str(datetime.now())
    org.update_date = str(datetime.now())

    db_session.add(org)
    db_session.commit()
    db_session.refresh(org)

    # Org Config
    org_config = OrganizationConfigBase(
        config_version="1.3",
        general=OrgGeneralConfig(
            enabled=True,
            color="normal",
            watermark=True,
        ),
        features=OrgFeatureConfig(
            courses=CourseOrgConfig(enabled=True, limit=0),
            members=MemberOrgConfig(
                enabled=True, signup_mode="open", admin_limit=0, limit=0
            ),
            usergroups=UserGroupOrgConfig(enabled=True, limit=0),
            storage=StorageOrgConfig(enabled=True, limit=0),
            ai=AIOrgConfig(enabled=True, limit=0, model="gpt-4o-mini"),
            assignments=AssignmentOrgConfig(enabled=True, limit=0),
            payments=PaymentOrgConfig(enabled=False),
            discussions=DiscussionOrgConfig(enabled=True, limit=0),
            analytics=AnalyticsOrgConfig(enabled=True, limit=0),
            collaboration=CollaborationOrgConfig(enabled=True, limit=0),
            api=APIOrgConfig(enabled=True, limit=0),
        ),
        cloud=OrgCloudConfig(
            plan='free',
            custom_domain=False
        ),
        landing={}
    )

    org_config = json.loads(org_config.json())

    # OrgSettings
    org_settings = OrganizationConfig(
        org_id=int(org.id if org.id else 0),
        config=org_config,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(org_settings)
    db_session.commit()
    db_session.refresh(org_settings)

    return org


def install_create_organization_user(
    user_object: UserCreate, org_slug: str, db_session: Session
):
    user = User.model_validate(user_object)

    # Complete the user object
    user.user_uuid = f"user_{uuid4()}"
    user.password = security_hash_password(user_object.password)
    user.email_verified = False
    user.creation_date = str(datetime.now())
    user.update_date = str(datetime.now())

    # Verifications

    # Check if Organization exists
    statement = select(Organization).where(Organization.slug == org_slug)
    org = db_session.exec(statement)

    if not org.first():
        raise HTTPException(
            status_code=409,
            detail="Organization does not exist",
        )

    # Username
    statement = select(User).where(User.username == user.username)
    result = db_session.exec(statement)

    if result.first():
        raise HTTPException(
            status_code=409,
            detail="Username already exists",
        )

    # Email
    statement = select(User).where(User.email == user.email)
    result = db_session.exec(statement)

    if result.first():
        raise HTTPException(
            status_code=409,
            detail="Email already exists",
        )

    # Exclude unset values
    user_data = user.dict(exclude_unset=True)
    for key, value in user_data.items():
        setattr(user, key, value)

    # Add user to database
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    # get org id
    statement = select(Organization).where(Organization.slug == org_slug)
    org = db_session.exec(statement)
    org = org.first()
    org_id = org.id if org else 0

    # Link user and organization
    user_organization = UserOrganization(
        user_id=user.id if user.id else 0,
        org_id=org_id or 0,
        role_id=1,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(user_organization)
    db_session.commit()
    db_session.refresh(user_organization)

    user = UserRead.model_validate(user)

    return user
