
from src.services.utils.upload_content import upload_content


async def upload_video(video_file, activity_uuid, org_uuid, course_uuid):
    contents = video_file.file.read()
    video_format = video_file.filename.split(".")[-1]

    try:
        await upload_content(
            f"courses/{course_uuid}/activities/{activity_uuid}/video",
            org_uuid,
            org_uuid,
            contents,
            f"video.{video_format}",
        )

    except Exception:
        return {"message": "There was an error uploading the file"}
