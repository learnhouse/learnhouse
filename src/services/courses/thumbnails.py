import os


async def upload_thumbnail(thumbnail_file, name_in_disk):
    contents = thumbnail_file.file.read()
    try:
        if not os.path.exists("content/uploads/img"):
            os.makedirs("content/uploads/img")
        
        with open(f"content/uploads/img/{name_in_disk}", 'wb') as f:
            f.write(contents)
            f.close()

    except Exception:
        return {"message": "There was an error uploading the file"}
    finally:
        thumbnail_file.file.close()