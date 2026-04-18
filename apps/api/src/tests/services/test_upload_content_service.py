"""Tests for src/services/utils/upload_content.py."""

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException, UploadFile

from src.services.utils.upload_content import ensure_directory_exists, upload_content, upload_file


class TestUploadContentService:
    def test_ensure_directory_exists(self, tmp_path):
        target = tmp_path / "nested" / "dir"
        ensure_directory_exists(str(target))
        assert target.exists()

    @pytest.mark.asyncio
    async def test_upload_file_validates_and_delegates(self):
        upload = UploadFile(filename="avatar.png", file=BytesIO(b"png"))

        with patch(
            "src.services.utils.upload_content.validate_upload",
            return_value=("image/png", b"content"),
        ), patch(
            "src.security.file_validation.get_safe_filename",
            return_value="safe_name.png",
        ), patch(
            "src.services.utils.upload_content.upload_content",
        ) as upload_content_mock:
            filename = await upload_file(
                upload,
                directory="avatars",
                type_of_dir="users",
                uuid="user_uuid",
                allowed_types=["image"],
                filename_prefix="avatar",
                max_size=1024,
            )

        assert filename == "safe_name.png"
        upload_content_mock.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_upload_content_filesystem_and_format_guard(self, tmp_path):
        fake_config = SimpleNamespace(
            hosting_config=SimpleNamespace(
                content_delivery=SimpleNamespace(type="filesystem")
            )
        )

        with patch(
            "src.services.utils.upload_content.get_learnhouse_config",
            return_value=fake_config,
        ), patch("src.services.utils.upload_content.ensure_directory_exists"):
            with pytest.raises(HTTPException) as exc:
                await upload_content(
                    directory="logos",
                    type_of_dir="orgs",
                    uuid="org_uuid",
                    file_binary=b"bad",
                    file_and_format="logo.exe",
                    allowed_formats=["png"],
                )

        assert exc.value.status_code == 400

        file_path = tmp_path / "content" / "orgs" / "org_uuid" / "logos" / "logo.png"
        file_path.parent.mkdir(parents=True)
        cwd = tmp_path
        with patch(
            "src.services.utils.upload_content.get_learnhouse_config",
            return_value=fake_config,
        ):
            with patch("os.getcwd", return_value=str(cwd)):
                pass
        with patch(
            "src.services.utils.upload_content.get_learnhouse_config",
            return_value=fake_config,
        ):
            import os
            old_cwd = os.getcwd()
            os.chdir(tmp_path)
            try:
                await upload_content(
                    directory="logos",
                    type_of_dir="orgs",
                    uuid="org_uuid",
                    file_binary=b"ok",
                    file_and_format="logo.png",
                    allowed_formats=["png"],
                )
            finally:
                os.chdir(old_cwd)

        assert file_path.read_bytes() == b"ok"

    @pytest.mark.asyncio
    async def test_upload_content_s3_success_and_failure(self, tmp_path):
        fake_config = SimpleNamespace(
            hosting_config=SimpleNamespace(
                content_delivery=SimpleNamespace(
                    type="s3api",
                    s3api=SimpleNamespace(
                        endpoint_url="https://s3.test", bucket_name="bucket"
                    ),
                )
            )
        )
        s3_client = Mock()

        import os
        old_cwd = os.getcwd()
        os.chdir(tmp_path)
        try:
            with patch(
                "src.services.utils.upload_content.get_learnhouse_config",
                return_value=fake_config,
            ), patch(
                "src.services.utils.upload_content.boto3.client",
                return_value=s3_client,
            ):
                await upload_content(
                    directory="logos",
                    type_of_dir="orgs",
                    uuid="org_uuid",
                    file_binary=b"ok",
                    file_and_format="logo.png",
                )
            s3_client.upload_file.assert_called_once()
            s3_client.head_object.assert_called_once()

            s3_client = Mock()
            from botocore.exceptions import ClientError

            s3_client.upload_file.side_effect = ClientError(
                {"Error": {"Code": "500", "Message": "boom"}},
                "upload_file",
            )
            with patch(
                "src.services.utils.upload_content.get_learnhouse_config",
                return_value=fake_config,
            ), patch(
                "src.services.utils.upload_content.boto3.client",
                return_value=s3_client,
            ):
                with pytest.raises(HTTPException) as exc:
                    await upload_content(
                        directory="logos",
                        type_of_dir="orgs",
                        uuid="org_uuid",
                        file_binary=b"ok",
                        file_and_format="logo.png",
                    )
        finally:
            os.chdir(old_cwd)

        assert exc.value.status_code == 500

    @pytest.mark.asyncio
    async def test_upload_content_s3_cleanup_oserror_is_swallowed(self, tmp_path):
        fake_config = SimpleNamespace(
            hosting_config=SimpleNamespace(
                content_delivery=SimpleNamespace(
                    type="s3api",
                    s3api=SimpleNamespace(
                        endpoint_url="http://s3.test",
                        bucket_name="bucket",
                    ),
                )
            )
        )
        s3_client = Mock()

        import os
        old_cwd = os.getcwd()
        os.chdir(tmp_path)
        try:
            with patch(
                "src.services.utils.upload_content.get_learnhouse_config",
                return_value=fake_config,
            ), patch(
                "src.services.utils.upload_content.boto3.client",
                return_value=s3_client,
            ), patch(
                "src.services.utils.upload_content.os.remove",
                side_effect=OSError("cleanup failed"),
            ):
                await upload_content(
                    directory="logos",
                    type_of_dir="orgs",
                    uuid="org_uuid",
                    file_binary=b"ok",
                    file_and_format="logo.png",
                )
            s3_client.upload_file.assert_called_once()
        finally:
            os.chdir(old_cwd)
