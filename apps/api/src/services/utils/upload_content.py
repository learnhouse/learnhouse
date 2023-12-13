import boto3
from botocore.exceptions import ClientError
import os

from config.config import get_learnhouse_config


async def upload_content(
    directory: str, org_uuid: str, file_binary: bytes, file_and_format: str
):
    # Get Learnhouse Config
    learnhouse_config = get_learnhouse_config()

    # Get content delivery method
    content_delivery = learnhouse_config.hosting_config.content_delivery.type

    if content_delivery == "filesystem":
        # create folder for activity
        if not os.path.exists(f"content/{org_uuid}/{directory}"):
            # create folder for activity
            os.makedirs(f"content/{org_uuid}/{directory}")
        # upload file to server
        with open(
            f"content/{org_uuid}/{directory}/{file_and_format}",
            "wb",
        ) as f:
            f.write(file_binary)
            f.close()

    elif content_delivery == "s3api":
        # Upload to server then to s3 (AWS Keys are stored in environment variables and are loaded by boto3)
        # TODO: Improve implementation of this
        print("Uploading to s3...")
        s3 = boto3.client(
            "s3",
            endpoint_url=learnhouse_config.hosting_config.content_delivery.s3api.endpoint_url,
        )

        # Create folder for activity
        if not os.path.exists(f"content/{org_uuid}/{directory}"):
            # create folder for activity
            os.makedirs(f"content/{org_uuid}/{directory}")

        # Upload file to server
        with open(
            f"content/{org_uuid}/{directory}/{file_and_format}",
            "wb",
        ) as f:
            f.write(file_binary)
            f.close()

        print("Uploading to s3 using boto3...")
        try:
            s3.upload_file(
                f"content/{org_uuid}/{directory}/{file_and_format}",
                "learnhouse-media",
                f"content/{org_uuid}/{directory}/{file_and_format}",
            )
        except ClientError as e:
            print(e)

        print("Checking if file exists in s3...")
        try:
            s3.head_object(
                Bucket="learnhouse-media",
                Key=f"content/{org_uuid}/{directory}/{file_and_format}",
            )
            print("File upload successful!")
        except Exception as e:
            print(f"An error occurred: {str(e)}")
