from datetime import datetime
from typing import List
from uuid import uuid4
from sqlmodel import Session, select
from src.db.users import AnonymousUser, PublicUser
from src.db.collections import (
    Collection,
    CollectionCreate,
    CollectionRead,
    CollectionUpdate,
)
from src.db.collections_courses import CollectionCourse
from src.db.courses.courses import Course
from fastapi import HTTPException, status, Request
from src.security.courses_security import courses_rbac_check_for_collections


####################################################
# CRUD
####################################################


async def get_collection(
    request: Request,
    collection_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> CollectionRead:
    statement = select(Collection).where(Collection.collection_uuid == collection_uuid)
    collection = db_session.exec(statement).first()

    if not collection:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection does not exist"
        )

    # RBAC check
    await courses_rbac_check_for_collections(
        request, collection.collection_uuid, current_user, "read", db_session
    )

    # get courses in collection
    statement_all = (
        select(Course)
        .join(CollectionCourse)
        .where(
            CollectionCourse.collection_id == collection.id,
            CollectionCourse.org_id == collection.org_id
        )
        .distinct()
    )

    statement_public = (
        select(Course)
        .join(CollectionCourse)
        .where(
            CollectionCourse.collection_id == collection.id,
            CollectionCourse.org_id == collection.org_id,
            Course.public == True
        )
        .distinct()
    )

    if current_user.user_uuid == "user_anonymous":
        statement = statement_public
    else:
        statement = statement_all

    courses = list(db_session.exec(statement).all())

    collection = CollectionRead(**collection.model_dump(), courses=courses)

    return collection


async def create_collection(
    request: Request,
    collection_object: CollectionCreate,
    current_user: PublicUser,
    db_session: Session,
) -> CollectionRead:
    collection = Collection.model_validate(collection_object)

    # SECURITY: Check if user has permission to create collections in this organization
    # Since collections are organization-level resources, we need to check org permissions
    # For now, we'll use the existing RBAC check but with proper organization context
    await courses_rbac_check_for_collections(request, "collection_x", current_user, "create", db_session)

    # Complete the collection object
    collection.collection_uuid = f"collection_{uuid4()}"
    collection.creation_date = str(datetime.now())
    collection.update_date = str(datetime.now())

    # Add collection to database
    db_session.add(collection)
    db_session.commit()
    db_session.refresh(collection)

    # SECURITY: Link courses to collection - ensure user has access to all courses being added
    if collection:
        for course_id in collection_object.courses:
            # Check if user has access to this course
            statement = select(Course).where(Course.id == course_id)
            course = db_session.exec(statement).first()
            
            if course:
                # Verify user has read access to the course before adding it to collection
                try:
                    await courses_rbac_check_for_collections(request, course.course_uuid, current_user, "read", db_session)
                except HTTPException:
                    raise HTTPException(
                        status_code=403,
                        detail=f"You don't have permission to add course {course.name} to this collection"
                    )
                
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
        .join(CollectionCourse)
        .where(CollectionCourse.collection_id == collection.id)
        .distinct()
    )
    courses = list(db_session.exec(statement).all())

    collection = CollectionRead(**collection.model_dump(), courses=courses)

    return CollectionRead.model_validate(collection)


async def update_collection(
    request: Request,
    collection_object: CollectionUpdate,
    collection_uuid: str,
    current_user: PublicUser,
    db_session: Session,
) -> CollectionRead:
    statement = select(Collection).where(Collection.collection_uuid == collection_uuid)
    collection = db_session.exec(statement).first()

    if not collection:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection does not exist"
        )

    # RBAC check
    await courses_rbac_check_for_collections(
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
        .join(CollectionCourse)
        .where(CollectionCourse.collection_id == collection.id)
        .distinct()
    )
    courses = list(db_session.exec(statement).all())

    collection = CollectionRead(**collection.model_dump(), courses=courses)

    return collection


async def delete_collection(
    request: Request,
    collection_uuid: str,
    current_user: PublicUser,
    db_session: Session,
):
    statement = select(Collection).where(Collection.collection_uuid == collection_uuid)
    collection = db_session.exec(statement).first()

    if not collection:
        raise HTTPException(
            status_code=404,
            detail="Collection not found",
        )

    # RBAC check
    await courses_rbac_check_for_collections(
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

    statement_public = select(Collection).where(
        Collection.org_id == org_id, Collection.public == True
    )
    statement_all = (
        select(Collection).where(Collection.org_id == org_id).distinct(Collection.id) # type: ignore
    )

    if current_user.id == 0:
        statement = statement_public
    else:
        statement = statement_all

    collections = db_session.exec(statement).all()

    collections_with_courses = []

    for collection in collections:
        statement_all = (
            select(Course)
            .join(CollectionCourse)
            .where(
                CollectionCourse.collection_id == collection.id,
                CollectionCourse.org_id == collection.org_id
            )
            .distinct()
        )
        statement_public = (
            select(Course)
            .join(CollectionCourse)
            .where(
                CollectionCourse.collection_id == collection.id,
                CollectionCourse.org_id == org_id,
                Course.public == True
            )
            .distinct()
        )
        if current_user.id == 0:
            statement = statement_public
        else:
            # RBAC check
            statement = statement_all

        courses = db_session.exec(statement).all()

        collection = CollectionRead(**collection.model_dump(), courses=list(courses))
        collections_with_courses.append(collection)

    return collections_with_courses
