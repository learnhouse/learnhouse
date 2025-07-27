from fastapi import HTTPException, status


async def check_element_type(element_uuid):
    """
    Check if the element is a course, a user, a house or a collection, by checking its prefix
    """
    if element_uuid.startswith("course_") or element_uuid.startswith("courseupdate_"):
        return "courses"
    elif element_uuid.startswith("user_"):
        return "users"
    elif element_uuid.startswith("usergroup_"):
        return "usergroups"
    elif element_uuid.startswith("house_"):
        return "houses"
    elif element_uuid.startswith("org_"):
        return "organizations"
    elif element_uuid.startswith("chapter_"):
        return "coursechapters"
    elif element_uuid.startswith("collection_"):
        return "collections"
    elif element_uuid.startswith("activity_"):
        return "activities"
    elif element_uuid.startswith("role_"):
        return "roles"
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User rights : Issue verifying element nature",
        )


async def get_singular_form_of_element(element_uuid):
    element_type = await check_element_type(element_uuid)

    if element_type == "activities":
        return "activity"
    else:
        singular_form_element = element_type[:-1]
        return singular_form_element


async def get_id_identifier_of_element(element_uuid):
    singular_form_element = await get_singular_form_of_element(element_uuid)

    if singular_form_element == "organization":
        return "org_id"
    else:
        return str(singular_form_element) + "_id"
