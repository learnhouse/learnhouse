import os


async def upload_pdf(pdf_file,  activity_id):
    contents = pdf_file.file.read()
    pdf_format = pdf_file.filename.split(".")[-1]

    if not os.path.exists("content/uploads/documents/documentpdf"):
        # create folder
        os.makedirs("content/uploads/documents/documentpdf")

    # create folder
    os.mkdir(f"content/uploads/documents/documentpdf/{activity_id}")

    try:
        with open(f"content/uploads/documents/documentpdf/{activity_id}/documentpdf.{pdf_format}", 'wb') as f:
            f.write(contents)
            f.close()

    except Exception as e:
        return {"message": "There was an error uploading the file"}
    finally:
        pdf_file.file.close()
