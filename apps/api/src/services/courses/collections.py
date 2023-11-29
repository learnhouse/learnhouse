from datetime import datetime
from typing import List, Literal
from uuid import uuid4
from sqlmodel import Session, select
from src.db.users import AnonymousUser
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_if_user_is_anon,
)
from src.db.collections import (
    Collection,
    CollectionCreate,
    CollectionRead,
    CollectionUpdate,
)
from src.db.collections_courses import CollectionCourse
from src.db.courses import Course
from src.services.users.users import PublicUser
from fastapi import HTTPException, status, Request


####################################################
# CRUD
####################################################


async def get_collection(
    request: Request, collection_id: str, current_user: PublicUser, db_session: Session
) -> CollectionRead:
    statement = select(Collection).where(Collection.id == collection_id)
    collection = db_session.exec(statement).first()

    if not collection:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection does not exist"
        )

    # RBAC check
    await rbac_check(
        request, collection.collection_uuid, current_user, "read", db_session
    )

    # get courses in collection
    statement = (
        select(Course)
        .join(CollectionCourse, Course.id == CollectionCourse.course_id)
        .distinct(Course.id)
    )
    courses = db_session.exec(statement).all()

    collection = CollectionRead(**collection.dict(), courses=courses)

    return collection


async def create_collection(
    request: Request,
    collection_object: CollectionCreate,
    current_user: PublicUser,
    db_session: Session,
) -> CollectionRead:
    collection = Collection.from_orm(collection_object)

    # RBAC check
    await rbac_check(request, "collection_x", current_user, "create", db_session)

    # Complete the collection object
    collection.collection_uuid = f"collection_{uuid4()}"
    collection.creation_date = str(datetime.now())
    collection.update_date = str(datetime.now())

    # Add collection to database
    db_session.add(collection)
    db_session.commit()

    db_session.refresh(collection)

    # Link courses to collection
    if collection:
        for course_id in collection_object.courses:
            collection_course = CollectionCourse(
                collection_id=int(collection.id),  # type: ignore
                course_id=course_id,
                org_id=int(collection_object.org_id),
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
            # Add collection_course to database
            db_session.add(collection_course)

    db_session.commit()
    db_session.refresh(collection)

    # Get courses once again
    statement = (
        select(Course)
        .join(CollectionCourse, Course.id == CollectionCourse.course_id)
        .distinct(Course.id)
    )
    courses = db_session.exec(statement).all()

    collection = CollectionRead(**collection.dict(), courses=courses)

    return CollectionRead.from_orm(collection)


async def update_collection(
    request: Request,
    collection_object: CollectionUpdate,
    collection_id: int,
    current_user: PublicUser,
    db_session: Session,
) -> CollectionRead:
    statement = select(Collection).where(Collection.id == collection_id)
    collection = db_session.exec(statement).first()

    if not collection:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection does not exist"
        )

    # RBAC check
    await rbac_check(
        request, collection.collection_uuid, current_user, "update", db_session
    )

    courses = collection_object.courses

    del collection_object.courses

    # Update only the fields that were passed in
    for var, value in vars(collection_object).items():
        if value is not None:
            setattr(collection, var, value)

    collection.update_date = str(datetime.now())

    # Update only the fields that were passed in
    for var, value in vars(collection_object).items():
        if value is not None:
            setattr(collection, var, value)

    statement = select(CollectionCourse).where(
        CollectionCourse.collection_id == collection.id
    )
    collection_courses = db_session.exec(statement).all()

    # Delete all collection_courses
    for collection_course in collection_courses:
        db_session.delete(collection_course)

    # Add new collection_courses
    for course in courses or []:
        collection_course = CollectionCourse(
            collection_id=int(collection.id),  # type: ignore
            course_id=int(course),
            org_id=int(collection.org_id),
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        # Add collection_course to database
        db_session.add(collection_course)

    db_session.commit()
    db_session.refresh(collection)

    # Get courses once again
    statement = (
        select(Course)
        .join(CollectionCourse, Course.id == CollectionCourse.course_id)
        .distinct(Course.id)
    )

    courses = db_session.exec(statement).all()

    collection = CollectionRead(**collection.dict(), courses=courses)

    return collection


async def delete_collection(
    request: Request, collection_id: str, current_user: PublicUser, db_session: Session
):
    statement = select(Collection).where(Collection.id == collection_id)
    collection = db_session.exec(statement).first()

    if not collection:
        raise HTTPException(
            status_code=404,
            detail="Collection not found",
        )

    # RBAC check
    await rbac_check(
        request, collection.collection_uuid, current_user, "delete", db_session
    )

    # delete collection from database
    db_session.delete(collection)
    db_session.commit()

    return {"detail": "Collection deleted"}


####################################################
# Misc
####################################################


async def get_collections(
    request: Request,
    org_id: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    page: int = 1,
    limit: int = 10,
) -> List[CollectionRead]:
    # RBAC check
    await rbac_check(request, "collection_x", current_user, "read", db_session)

    statement = (
        select(Collection).where(Collection.org_id == org_id).distinct(Collection.id)
    )
    collections = db_session.exec(statement).all()

    if not collections:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="No collections found"
        )

    collections_with_courses = []
    for collection in collections:
        statement = (
            select(Course)
            .join(CollectionCourse, Course.id == CollectionCourse.course_id)
            .distinct(Course.id)
        )
        courses = db_session.exec(statement).all()

        collection = CollectionRead(**collection.dict(), courses=courses)
        collections_with_courses.append(collection)

    return collections_with_courses


## 🔒 RBAC Utils ##


async def rbac_check(
    request: Request,
    course_id: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
):
    await authorization_verify_if_user_is_anon(current_user.id)

    await authorization_verify_based_on_roles_and_authorship(
        request,
        current_user.id,
        action,
        course_id,
        db_session,
    )


## 🔒 RBAC Utils ##
