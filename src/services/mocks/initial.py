import os
import requests
from datetime import datetime
from pprint import pprint
from uuid import uuid4
from fastapi import Request
from src.security.security import security_hash_password
from src.services.courses.chapters import CourseChapter, create_coursechapter
from src.services.courses.activities.activities import Activity, create_activity
from src.services.users.users import PublicUser, UserInDB

from src.services.orgs.orgs import Organization, create_org
from src.services.roles.schemas.roles import Permission, Elements, RoleInDB
from src.services.courses.courses import CourseInDB
from faker import Faker


async def create_initial_data(request: Request):
    fake = Faker(['en_US'])
    fake_multilang = Faker(
        ['en_US', 'de_DE', 'ja_JP', 'es_ES', 'it_IT', 'pt_BR', 'ar_PS'])
    
    
    # Create users
    ########################################

    database_users = request.app.db["users"]
    await database_users.delete_many({})

    users = []
    admin_user = UserInDB(
        user_id="user_admin",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        roles= [],
        orgs=[],
        username="admin",
        email="admin@admin.admin",
        password=str(await security_hash_password("admin")),
    )

    await database_users.insert_one(admin_user.dict())

    # find admin user
    users = request.app.db["users"]
    admin_user = await users.find_one({"username": "admin"})

    if admin_user:
        admin_user = UserInDB(**admin_user)
        current_user = PublicUser(**admin_user.dict())
    else:
        raise Exception("Admin user not found")
    # Create roles
    ########################################

    database_roles = request.app.db["roles"]
    await database_roles.delete_many({})

    
    roles = []
    admin_role = RoleInDB(
        name="Admin",
        description="Admin",
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
        org_id="org_test",
        role_id="role_admin",
        created_at=str(datetime.now()),
        updated_at=str(datetime.now()),
    )

    roles.append(admin_role)

    for role in roles:
        database_roles.insert_one(role.dict())
        

    # Create organizations
    ########################################

    database_orgs = request.app.db["organizations"]
    await database_orgs.delete_many({})

    organizations = []
    for i in range(0, 5):
        company = fake.company()
        # remove whitespace and special characters and make lowercase
        slug = ''.join(e for e in company if e.isalnum()).lower()
        org = Organization(
            name=company,
            description=fake.unique.text(),
            email=fake.unique.email(),
            slug=slug,
            logo="",
            default=False
        )
        organizations.append(org)
        await create_org(request, org, current_user)


    # Generate Courses and CourseChapters
    ########################################

    database_courses = request.app.db["courses"]
    await database_courses.delete_many({})

    courses = []
    orgs = request.app.db["organizations"]

    if await orgs.count_documents({}) > 0:
        for org in await orgs.find().to_list(length=100):
            for i in range(0, 5):

                # get image in BinaryIO format from unsplash and save it to disk
                image = requests.get(
                    "https://source.unsplash.com/random/800x600")
                with open("thumbnail.jpg", "wb") as f:
                    f.write(image.content)

                course_id = f"course_{uuid4()}"
                course = CourseInDB(
                    name=fake_multilang.unique.sentence(),
                    description=fake_multilang.unique.text(),
                    mini_description=fake_multilang.unique.text(),
                    thumbnail="thumbnail",
                    org_id=org['org_id'],
                    learnings=[fake_multilang.unique.sentence()
                               for i in range(0, 5)],
                    public=True,
                    chapters=[],
                    course_id=course_id,
                    creationDate=str(datetime.now()),
                    updateDate=str(datetime.now()),
                    authors=[current_user.user_id],
                    chapters_content=[],
                )

                courses = request.app.db["courses"]
                name_in_disk = f"test_mock{course_id}.jpeg"

                image = requests.get(
                    "https://source.unsplash.com/random/800x600/?img=1")
                
                # check if folder exists and create it if not
                if not os.path.exists("content/uploads/img"):
                
                    os.makedirs("content/uploads/img")
                
                with open(f"content/uploads/img/{name_in_disk}", "wb") as f:
                    f.write(image.content)

                course.thumbnail = name_in_disk

                course = CourseInDB(**course.dict())
                await courses.insert_one(course.dict())

                # create chapters
                for i in range(0, 5):
                    coursechapter = CourseChapter(
                        name=fake_multilang.unique.sentence(),
                        description=fake_multilang.unique.text(),
                        activities=[],
                    )
                    coursechapter = await create_coursechapter(request,coursechapter, course_id, current_user)
                    pprint(coursechapter)
                    if coursechapter:
                        # create activities
                        for i in range(0, 5):
                            activity = Activity(
                                name=fake_multilang.unique.sentence(),
                                type="dynamic",
                                content={},
                            )
                            activity = await create_activity(request,activity, "org_test", coursechapter['coursechapter_id'], current_user)
