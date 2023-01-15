import requests
from datetime import datetime
from fileinput import filename
from pprint import pprint
from uuid import uuid4
from fastapi import File, UploadFile
from src.services.courses.chapters import CourseChapter, create_coursechapter
from src.services.courses.lectures.lectures import Lecture, create_lecture
from src.services.courses.thumbnails import upload_thumbnail
from src.services.users import PublicUser, User, UserInDB, UserWithPassword
from src.services.database import learnhouseDB
from src.services.orgs import OrganizationInDB, Organization, create_org
from src.services.roles import Permission, Elements, create_role
from src.services.users import create_user
from src.services.courses.courses import Course, CourseInDB, create_course
from src.services.roles import Role
from faker import Faker


async def create_initial_data():
    fake = Faker(['en_US'])
    fake_multilang = Faker(
        ['en_US', 'de_DE', 'ja_JP', 'es_ES', 'it_IT', 'pt_BR', 'ar_PS'])

    # Create users
    ########################################

    database_users = learnhouseDB["users"]
    database_users.delete_many({})

    users = []
    admin_user = UserWithPassword(
        username=f"admin",
        email=f"admin@admin.admin",
        password="admin",
        user_type="isOwner",
    )

    admin_user = await create_user(admin_user)

    for i in range(0, 20):
        user = UserWithPassword(
            username=fake.simple_profile()['username'],
            email=fake.email(),
            password=fake.password(),
            user_type="isOwner",
            full_name=fake.name(),
        )
        users.append(user)

    for user in users:
        await create_user(user)

    # find admin user
    users = learnhouseDB["users"]
    admin_user = users.find_one({"username": "admin"})

    if admin_user:
        admin_user = UserInDB(**admin_user)
        current_user = PublicUser(**admin_user.dict())
    else:
        raise Exception("Admin user not found")

    # Create organizations
    ########################################

    database_orgs = learnhouseDB["organizations"]
    database_orgs.delete_many({})

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
        )
        organizations.append(org)
        await create_org(org, current_user)

    # Create roles
    ########################################

    database_roles = learnhouseDB["roles"]
    database_roles.delete_many({})

    roles = []
    admin_role = Role(
        name="admin",
        description="admin",
        permissions=Permission(
            action_create=True,
            action_read=True,
            action_update=True,
            action_delete=True,
        ),
        elements=Elements(
            courses=["*"],
            users=["*"],
            houses=["*"],
            collections=["*"],
            organizations=["*"],
            coursechapters=["*"],
            lectures=["*"],
        ),
        linked_users=[admin_user.user_id],
    )
    roles.append(admin_role)

    await create_role(admin_role, current_user)

    # Generate Courses and CourseChapters
    ########################################

    database_courses = learnhouseDB["courses"]
    database_chapters = learnhouseDB["coursechapters"]
    database_courses.delete_many({})
    database_chapters.delete_many({})

    courses = []
    orgs = learnhouseDB["organizations"]

    if orgs.count_documents({}) > 0:
        for org in orgs.find():
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
                )

                courses = learnhouseDB["courses"]
                name_in_disk = f"test_mock{course_id}.jpeg"

                image = requests.get(
                    "https://source.unsplash.com/random/800x600")
                with open(f"content/uploads/img/{name_in_disk}", "wb") as f:
                    f.write(image.content)

                course.thumbnail = name_in_disk

                course = CourseInDB(**course.dict())
                course_in_db = courses.insert_one(course.dict())

                # create chapters
                for i in range(0, 5):
                    coursechapter = CourseChapter(
                        name=fake_multilang.unique.sentence(),
                        description=fake_multilang.unique.text(),
                        lectures=[],
                    )
                    coursechapter = await create_coursechapter(coursechapter, course_id, current_user)
                    pprint(coursechapter)
                    if coursechapter:
                        # create lectures
                        for i in range(0, 5):
                            lecture = Lecture(
                                name=fake_multilang.unique.sentence(),
                                type="dynamic",
                                content={},
                            )
                            lecture = await create_lecture(lecture, coursechapter['coursechapter_id'], current_user)
