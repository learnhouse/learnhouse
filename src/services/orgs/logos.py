import os
from uuid import uuid4


async def upload_org_logo(logo_file):
    contents = logo_file.file.read()
    name_in_disk = f"{uuid4()}.{logo_file.filename.split('.')[-1]}"

    try:
        if not os.path.exists("content/uploads/logos"):
            os.makedirs("content/uploads/logos")

        with open(f"content/uploads/logos/{name_in_disk}", "wb") as f:
            f.write(contents)
            f.close()

    except Exception:
        return {"message": "There was an error uploading the file"}
    finally:
        logo_file.file.close()

    return name_in_disk
