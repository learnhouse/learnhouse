from src.services.utils.upload_content import upload_content


async def upload_submission_file(
    file,
    name_in_disk,
    activity_uuid,
    org_uuid,
    course_uuid,
    assignment_uuid,
    assignment_task_uuid,
):
    contents = file.file.read()
    file.filename.split(".")[-1]

    await upload_content(
        f"courses/{course_uuid}/activities/{activity_uuid}/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/subs",
        "orgs",
        org_uuid,
        contents,
        f"{name_in_disk}",
        ["pdf", "docx", "mp4", "jpg", "jpeg", "png", "pptx", "zip"],
    )
