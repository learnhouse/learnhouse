from fastapi import HTTPException, status


async def check_element_type(element_id):
    """
    Check if the element is a course, a user, a house or a collection, by checking its prefix
    """
    print("element_id", element_id)
    if element_id.startswith("course_"):
        return "courses"
    elif element_id.startswith("user_"):
        return "users"
    elif element_id.startswith("house_"):
        return "houses"
    elif element_id.startswith("org_"):
        return "organizations"
    elif element_id.startswith("chapter_"):
        return "coursechapters"
    elif element_id.startswith("collection_"):
        return "collections"
    elif element_id.startswith("activity_"):
        return "activities"
    elif element_id.startswith("role_"):
        return "roles"
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User rights : Issue verifying element nature",
        )


async def get_singular_form_of_element(element_id):
    element_type = await check_element_type(element_id)

    if element_type == "activities":
        return "activity"
    else:
        singular_form_element = element_type[:-1]
        return singular_form_element


async def get_id_identifier_of_element(element_id):
    singular_form_element = await get_singular_form_of_element(element_id)

    if singular_form_element == "ogranizations":
        return "org_id"
    else:
        return str(singular_form_element) + "_id"
