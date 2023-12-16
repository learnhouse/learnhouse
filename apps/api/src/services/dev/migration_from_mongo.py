from datetime import date
import datetime
from fastapi import Request
from sqlmodel import Session, select
from src.db.blocks import Block, BlockTypeEnum
from src.db.chapter_activities import ChapterActivity
from src.db.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.course_chapters import CourseChapter
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum
from src.db.user_organizations import UserOrganization
from src.db.chapters import Chapter
from src.db.courses import Course
from src.db.users import User

from src.db.organizations import Organization


async def start_migrate_from_mongo(request: Request, db_session: Session):
    orgs = request.app.db["organizations"]

    ## ---->  Organizations migration
    org_db_list = await orgs.find().to_list(length=100)

    for org in org_db_list:
        org_to_add = Organization(
            name=org["name"],
            description=org["description"],
            slug=org["slug"],
            logo_image=org["logo"],
            email=org["email"],
            org_uuid=org["org_id"],
            creation_date=str(datetime.datetime.now()),
            update_date=str(datetime.datetime.now()),
        )
        db_session.add(org_to_add)
        db_session.commit()

    print("Migrated organizations.")

    ## ---->  Users migration
    users = request.app.db["users"]

    users_db_list = await users.find().to_list(length=100)

    for user in users_db_list:
        user_to_add = User(
            email=user["email"],
            username=user["username"],
            first_name="",
            last_name="",
            user_uuid=user["user_id"],
            password=user["password"],
            creation_date=user["creation_date"],
            update_date=user["update_date"],
        )
        db_session.add(user_to_add)
        db_session.commit()

        # Link Orgs to users and make them owners
        for org in user["orgs"]:
            statement = select(Organization).where(
                Organization.org_uuid == org["org_id"]
            )
            org_from_db = db_session.exec(statement).first()

            statement = select(User).where(User.user_uuid == user["user_id"])
            user_from_db = db_session.exec(statement).first()

            user_org_object = UserOrganization(
                user_id=user_from_db.id,  # type: ignore
                org_id=org_from_db.id if org_from_db is not None else None,  # type: ignore
                role_id=1,
                creation_date=str(datetime.datetime.now()),
                update_date=str(datetime.datetime.now()),
            )
            db_session.add(user_org_object)
            db_session.commit()

    print("Migrated users and linked them to orgs.")

    ## ---->  Courses migration
    courses = request.app.db["courses"]

    courses_db_list = await courses.find().to_list(length=300)

    for course in courses_db_list:
        # Get the organization id
        statement = select(Organization).where(
            Organization.org_uuid == course["org_id"]
        )
        org_from_db = db_session.exec(statement).first()

        course_to_add = Course(
            name=course["name"],
            description=course["description"],
            about=course["description"],
            learnings="",
            course_uuid=course["course_id"],
            thumbnail_image=course["thumbnail"],
            tags="",
            org_id=org_from_db.id if org_from_db is not None else None,  # type: ignore
            public=course["public"],
            creation_date=str(course["creationDate"]),
            update_date=str(course["updateDate"]),
        )
        db_session.add(course_to_add)
        db_session.commit()

        # Get this course
        statement = select(Course).where(Course.course_uuid == course["course_id"])
        course_from_db = db_session.exec(statement).first()

        # Add Authorship
        authors = course["authors"]

        for author in authors:
            # Get the user id
            statement = select(User).where(User.user_uuid == author)
            user_from_db = db_session.exec(statement).first()

            authorship = ResourceAuthor(
                resource_uuid=course_from_db.course_uuid,  # type: ignore
                user_id=user_from_db.id if user_from_db is not None else None,  # type: ignore
                authorship=ResourceAuthorshipEnum.CREATOR,
                creation_date=str(datetime.datetime.now()),
                update_date=str(datetime.datetime.now()),
            )
            db_session.add(authorship)
            db_session.commit()

            print("Added authorship.")

        ## ----> Chapters migration & Link

        chapter_object = course["chapters_content"]
        order = 0
        for chapter in chapter_object:
            chapter_to_add = Chapter(
                name=chapter["name"],
                description=chapter["description"],
                chapter_uuid=chapter["coursechapter_id"].replace(
                    "coursechapter", "chapter"
                ),
                org_id=org_from_db.id if org_from_db is not None else None, # type: ignore
                course_id=course_from_db.id,  # type: ignore
                creation_date=str(datetime.datetime.now()),
                update_date=str(datetime.datetime.now()),
            )
            db_session.add(chapter_to_add)
            db_session.commit()

            # Get this chapter
            statement = select(Chapter).where(
                Chapter.chapter_uuid
                == chapter["coursechapter_id"].replace("coursechapter", "chapter")
            )
            chapter_from_db = db_session.exec(statement).first()

            # Link chapter to course
            coursechapter_to_add = CourseChapter(
                chapter_id=chapter_from_db.id,  # type: ignore
                course_id=course_from_db.id,  # type: ignore
                order=order,
                org_id=org_from_db.id if org_from_db is not None else None,  # type: ignore
                creation_date=str(datetime.datetime.now()),
                update_date=str(datetime.datetime.now()),
            )

            db_session.add(coursechapter_to_add)
            db_session.commit()

            order += 1

            ## ---->  Activities migration
            activities = request.app.db["activities"]
            activities_db_list = await activities.find(
                {"coursechapter_id": chapter["coursechapter_id"]}
            ).to_list(length=100)

            activity_order = 0

            for activity in activities_db_list:
                type_to_use = ActivityTypeEnum.TYPE_CUSTOM
                sub_type_to_use = ActivityTypeEnum.TYPE_CUSTOM

                if activity["type"] == "video":
                    type_to_use = ActivityTypeEnum.TYPE_VIDEO
                    sub_type_to_use = ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED

                if "external_video" in activity["content"]:
                    type_to_use = ActivityTypeEnum.TYPE_VIDEO
                    sub_type_to_use = ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE

                if activity["type"] == "documentpdf":
                    type_to_use = ActivityTypeEnum.TYPE_DOCUMENT
                    sub_type_to_use = ActivitySubTypeEnum.SUBTYPE_DOCUMENT_PDF

                if activity["type"] == "dynamic":
                    type_to_use = ActivityTypeEnum.TYPE_DYNAMIC
                    sub_type_to_use = ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE

                activity_to_add = Activity(
                    name=activity["name"],
                    activity_uuid=activity["activity_id"],
                    version=1,
                    published_version=1,
                    activity_type=type_to_use,
                    content=activity["content"],
                    activity_sub_type=sub_type_to_use,
                    chapter_id=chapter_from_db.id,  # type: ignore
                    org_id=org_from_db.id if org_from_db is not None else None,  # type: ignore
                    course_id=course_from_db.id,  # type: ignore
                    creation_date=str(activity["creationDate"]),
                    update_date=str(activity["updateDate"]),
                )
                db_session.add(activity_to_add)
                db_session.commit()

                # Link activity to chapter
                statement = select(Activity).where(
                    Activity.activity_uuid == activity["activity_id"]
                )

                activity_from_db = db_session.exec(statement).first()

                activitychapter_to_add = ChapterActivity(
                    chapter_id=chapter_from_db.id,  # type: ignore
                    activity_id=activity_from_db.id,  # type: ignore
                    order=activity_order,
                    course_id=course_from_db.id,  # type: ignore
                    org_id=org_from_db.id if org_from_db is not None else None,  # type: ignore
                    creation_date=str(datetime.datetime.now()),
                    update_date=str(datetime.datetime.now()),
                )

                db_session.add(activitychapter_to_add)
                db_session.commit()

                activity_order += 1

                ## ---->  Blocks migration
                blocks = request.app.db["blocks"]

                blocks_db_list = await blocks.find(
                    {"activity_id": activity["activity_id"]}
                ).to_list(length=200)

                for block in blocks_db_list:
                    type_to_use = BlockTypeEnum.BLOCK_CUSTOM

                    if block["block_type"] == "imageBlock":
                        type_to_use = BlockTypeEnum.BLOCK_IMAGE

                    if block["block_type"] == "videoBlock":
                        type_to_use = BlockTypeEnum.BLOCK_VIDEO

                    if block["block_type"] == "pdfBlock":
                        type_to_use = BlockTypeEnum.BLOCK_DOCUMENT_PDF

                    print('block', block)

                    block_to_add = Block(
                        block_uuid=block["block_id"],
                        content=block["block_data"],
                        block_type=type_to_use,
                        activity_id=activity_from_db.id,  # type: ignore
                        org_id=org_from_db.id if org_from_db is not None else None,  # type: ignore
                        course_id=course_from_db.id,  # type: ignore
                        chapter_id=chapter_from_db.id,  # type: ignore
                        creation_date=str(datetime.datetime.now()),
                        update_date=str(datetime.datetime.now()),
                    )
                    db_session.add(block_to_add)
                    db_session.commit()

    return "Migration successfull."
