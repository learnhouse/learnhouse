
from src.services.utils.upload_content import upload_content


async def upload_video(video_file, activity_id, org_id, course_id):
    contents = video_file.file.read()
    video_format = video_file.filename.split(".")[-1]

    try:
        await upload_content(
            f"courses/{course_id}/activities/{activity_id}/video",
            org_id,
            contents,
            f"video.{video_format}",
        )

    except Exception:
        return {"message": "There was an error uploading the file"}
