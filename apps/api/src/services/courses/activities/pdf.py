from src.security.rbac.rbac import authorization_verify_based_on_roles
from src.services.courses.activities.uploads.pdfs import upload_pdf
from src.services.users.users import PublicUser
from src.services.courses.activities.activities import ActivityInDB
from fastapi import HTTPException, status, UploadFile, Request
from uuid import uuid4
from datetime import datetime


async def create_documentpdf_activity(
    request: Request,
    name: str,
    coursechapter_id: str,
    current_user: PublicUser,
    pdf_file: UploadFile | None = None,
):
    activities = request.app.db["activities"]
    courses = request.app.db["courses"]
    users = request.app.db["users"]

    # get user
    user = await users.find_one({"user_id": current_user.user_id})

    # generate activity_id
    activity_id = str(f"activity_{uuid4()}")

    # get org_id from course
    coursechapter = await courses.find_one(
        {"chapters_content.coursechapter_id": coursechapter_id}
    )

    org_id = coursechapter["org_id"]

    # check if pdf_file is not None
    if not pdf_file:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Pdf : No pdf file provided"
        )

    if pdf_file.content_type not in ["application/pdf"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Pdf : Wrong pdf format"
        )

    # get pdf format
    if pdf_file.filename:
        pdf_format = pdf_file.filename.split(".")[-1]

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Pdf : No pdf file provided"
        )

    activity_object = ActivityInDB(
        org_id=org_id,
        activity_id=activity_id,
        coursechapter_id=coursechapter_id,
        name=name,
        type="documentpdf",
        course_id=coursechapter["course_id"],
        content={
            "documentpdf": {
                "filename": "documentpdf." + pdf_format,
                "activity_id": activity_id,
            }
        },
        creationDate=str(datetime.now()),
        updateDate=str(datetime.now()),
    )

    await authorization_verify_based_on_roles(
        request,
        current_user.user_id,
        "create",
        user["roles"],
        activity_id,
    )

    # create activity
    activity = ActivityInDB(**activity_object.dict())
    await activities.insert_one(activity.dict())

    # upload pdf
    if pdf_file:
        # get pdffile format
        await upload_pdf(pdf_file, activity_id, org_id, coursechapter["course_id"])

    # todo : choose whether to update the chapter or not
    # update chapter
    await courses.update_one(
        {"chapters_content.coursechapter_id": coursechapter_id},
        {"$addToSet": {"chapters_content.$.activities": activity_id}},
    )

    return activity
