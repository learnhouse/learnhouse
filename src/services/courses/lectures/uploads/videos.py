import os


async def upload_video(video_file,  lecture_id):
    contents = video_file.file.read()
    video_format = video_file.filename.split(".")[-1]
    # create folder
    os.mkdir(f"content/uploads/video/{lecture_id}")

    try:
        with open(f"content/uploads/video/{lecture_id}/video.{video_format}", 'wb') as f:
            f.write(contents)
            f.close()

    except Exception as e:
        return {"message": "There was an error uploading the file"}
    finally:
        video_file.file.close()
