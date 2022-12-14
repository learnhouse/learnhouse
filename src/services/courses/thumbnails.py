import os


async def upload_thumbnail(thumbnail_file, name_in_disk):
    contents = thumbnail_file.file.read()
    try:
        with open(f"content/uploads/img/{name_in_disk}", 'wb') as f:
            f.write(contents)
            f.close()

    except Exception as e:
        print(e)
        return {"message": "There was an error uploading the file"}
    finally:
        thumbnail_file.file.close()