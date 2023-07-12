from datetime import datetime
from uuid import uuid4
from fastapi import HTTPException, Request, status
from pydantic import BaseModel
import requests
from config.config import get_learnhouse_config
from src.security.security import security_hash_password
from src.services.courses.activities.activities import Activity, create_activity
from src.services.courses.chapters import create_coursechapter, CourseChapter
from src.services.courses.courses import CourseInDB

from src.services.orgs.schemas.orgs import Organization, OrganizationInDB
from faker import Faker


from src.services.roles.schemas.roles import Elements, Permission, RoleInDB
from src.services.users.schemas.users import (
    PublicUser,
    User,
    UserInDB,
    UserOrganization,
    UserRolesInOrganization,
    UserWithPassword,
)


class InstallInstance(BaseModel):
    install_id: str
    created_date: str
    updated_date: str
    step: int
    data: dict


async def isInstallModeEnabled():
    config = get_learnhouse_config()

    if config.general_config.install_mode:
        return True
    else:
        raise HTTPException(
            status_code=403,
            detail="Install mode is not enabled",
        )


async def create_install_instance(request: Request, data: dict):
    installs = request.app.db["installs"]

    # get install_id
    install_id = str(f"install_{uuid4()}")
    created_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    updated_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    step = 1

    # create install
    install = InstallInstance(
        install_id=install_id,
        created_date=created_date,
        updated_date=updated_date,
        step=step,
        data=data,
    )

    # insert install
    installs.insert_one(install.dict())

    return install


async def get_latest_install_instance(request: Request):
    installs = request.app.db["installs"]

    # get latest created install instance using find_one
    install = await installs.find_one(
        sort=[("created_date", -1)], limit=1, projection={"_id": 0}
    )

    if install is None:
        raise HTTPException(
            status_code=404,
            detail="No install instance found",
        )

    else:
        install = InstallInstance(**install)

        return install


async def update_install_instance(request: Request, data: dict, step: int):
    installs = request.app.db["installs"]

    # get latest created install
    install = await installs.find_one(
        sort=[("created_date", -1)], limit=1, projection={"_id": 0}
    )

    if install is None:
        return None

    else:
        # update install
        install["data"] = data
        install["step"] = step
        install["updated_date"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # update install
        await installs.update_one(
            {"install_id": install["install_id"]}, {"$set": install}
        )

        install = InstallInstance(**install)

        return install


############################################################################################################
# Steps
############################################################################################################


# Install Default roles
async def install_default_elements(request: Request, data: dict):
    roles = request.app.db["roles"]

    # check if default roles ADMIN_ROLE and USER_ROLE already exist
    admin_role = await roles.find_one({"role_id": "role_super_admin"})
    user_role = await roles.find_one({"role_id": "role_user"})

    if admin_role is not None or user_role is not None:
        raise HTTPException(
            status_code=400,
            detail="Default roles already exist",
        )

    # get default roles
    SUPER_ADMIN_ROLE = RoleInDB(
        name="SuperAdmin Role",
        description="This role grants all permissions to the user",
        elements=Elements(
            courses=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            users=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            houses=Permission(
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
        ),
        org_id="*",
        role_id="role_super_admin",
        created_at=str(datetime.now()),
        updated_at=str(datetime.now()),
    )

    ADMIN_ROLE = RoleInDB(
        name="SuperAdmin Role",
        description="This role grants all permissions to the user",
        elements=Elements(
            courses=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            users=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            houses=Permission(
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
        ),
        org_id="*",
        role_id="role_super_admin",
        created_at=str(datetime.now()),
        updated_at=str(datetime.now()),
    )

    USER_ROLE = RoleInDB(
        name="User role",
        description="This role grants read-only permissions to the user",
        elements=Elements(
            courses=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            users=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            houses=Permission(
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
                action_read=True,
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
        ),
        org_id="*",
        role_id="role_user",
        created_at=str(datetime.now()),
        updated_at=str(datetime.now()),
    )

    try:
        # insert default roles
        await roles.insert_many(
            [ADMIN_ROLE.dict(), USER_ROLE.dict(), SUPER_ADMIN_ROLE.dict()]
        )
        return True

    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Error while inserting default roles",
        )


# Organization creation
async def install_create_organization(
    request: Request,
    org_object: Organization,
):
    orgs = request.app.db["organizations"]
    request.app.db["users"]

    # find if org already exists using name

    isOrgAvailable = await orgs.find_one({"slug": org_object.slug.lower()})

    if isOrgAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Organization slug already exists",
        )

    # generate org_id with uuid4
    org_id = str(f"org_{uuid4()}")

    org = OrganizationInDB(org_id=org_id, **org_object.dict())

    org_in_db = await orgs.insert_one(org.dict())

    if not org_in_db:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unavailable database",
        )

    return org.dict()


async def install_create_organization_user(
    request: Request, user_object: UserWithPassword, org_slug: str
):
    users = request.app.db["users"]

    isUsernameAvailable = await users.find_one({"username": user_object.username})
    isEmailAvailable = await users.find_one({"email": user_object.email})

    if isUsernameAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Username already exists"
        )

    if isEmailAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already exists"
        )

    # Generate user_id with uuid4
    user_id = str(f"user_{uuid4()}")

    # Set the username & hash the password
    user_object.username = user_object.username.lower()
    user_object.password = await security_hash_password(user_object.password)

    # Get org_id from org_slug
    orgs = request.app.db["organizations"]

    # Check if the org exists
    isOrgExists = await orgs.find_one({"slug": org_slug})

    # If the org does not exist, raise an error
    if not isOrgExists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You are trying to create a user in an organization that does not exist",
        )

    org_id = isOrgExists["org_id"]

    # Create initial orgs list with the org_id passed in
    orgs = [UserOrganization(org_id=org_id, org_role="owner")]

    # Give role
    roles = [UserRolesInOrganization(role_id="role_super_admin", org_id=org_id)]

    # Create the user
    user = UserInDB(
        user_id=user_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        orgs=orgs,
        roles=roles,
        **user_object.dict(),
    )

    # Insert the user into the database
    await users.insert_one(user.dict())

    return User(**user.dict())


async def create_sample_data(org_slug: str, username: str, request: Request):
    Faker(["en_US"])
    fake_multilang = Faker(
        ["en_US", "de_DE", "ja_JP", "es_ES", "it_IT", "pt_BR", "ar_PS"]
    )

    users = request.app.db["users"]
    orgs = request.app.db["organizations"]
    user = await users.find_one({"username": username})
    org = await orgs.find_one({"slug": org_slug.lower()})
    user_id = user["user_id"]
    org_id = org["org_id"]

    current_user = PublicUser(**user)

    print(current_user)
    for i in range(0, 5):
        # get image in BinaryIO format from unsplash and save it to disk
        image = requests.get("https://source.unsplash.com/random/800x600")
        with open("thumbnail.jpg", "wb") as f:
            f.write(image.content)

        course_id = f"course_{uuid4()}"
        course = CourseInDB(
            name=fake_multilang.unique.sentence(),
            description=fake_multilang.unique.text(),
            mini_description=fake_multilang.unique.text(),
            thumbnail="thumbnail",
            org_id=org_id,
            learnings=[fake_multilang.unique.sentence() for i in range(0, 5)],
            public=True,
            chapters=[],
            course_id=course_id,
            creationDate=str(datetime.now()),
            updateDate=str(datetime.now()),
            authors=[user_id],
            chapters_content=[],
        )

        courses = request.app.db["courses"]

        course = CourseInDB(**course.dict())
        await courses.insert_one(course.dict())

        # create chapters
        for i in range(0, 5):
            coursechapter = CourseChapter(
                name=fake_multilang.unique.sentence(),
                description=fake_multilang.unique.text(),
                activities=[],
            )
            coursechapter = await create_coursechapter(
                request, coursechapter, course_id, current_user
            )
            if coursechapter:
                # create activities
                for i in range(0, 5):
                    activity = Activity(
                        name=fake_multilang.unique.sentence(),
                        type="dynamic",
                        content={},
                    )
                    activity = await create_activity(
                        request,
                        activity,
                        org_id,
                        coursechapter["coursechapter_id"],
                        current_user,
                    )
