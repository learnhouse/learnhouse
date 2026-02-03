from src.services.utils.upload_content import upload_content


async def upload_video(video_file, activity_uuid, org_uuid, course_uuid):
    video_format = video_file.filename.split(".")[-1]

    await upload_content(
        directory=f"courses/{course_uuid}/activities/{activity_uuid}/video",
        type_of_dir='orgs',
        uuid=org_uuid,
        file_obj=video_file.file,
        file_and_format=f"video.{video_format}",
    )
    
    return {"message": "Video uploaded successfully"}
