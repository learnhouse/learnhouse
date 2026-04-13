"""Tests for src/services/courses/transfer/storage_utils.py."""

from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from botocore.exceptions import ClientError, NoCredentialsError

import src.services.courses.transfer.storage_utils as storage_utils


def _make_config(
    *,
    content_delivery: str = "filesystem",
    bucket_name: str | None = "learnhouse-media",
    endpoint_url: str = "https://s3.test",
):
    return SimpleNamespace(
        hosting_config=SimpleNamespace(
            content_delivery=SimpleNamespace(
                type=content_delivery,
                s3api=SimpleNamespace(
                    bucket_name=bucket_name,
                    endpoint_url=endpoint_url,
                ),
            )
        )
    )


def _client_error(code: str, operation: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": "boom"}}, operation)


@pytest.fixture(autouse=True)
def reset_storage_utils_state():
    storage_utils.get_content_delivery_type.cache_clear()
    storage_utils.get_s3_bucket_name.cache_clear()
    storage_utils.is_s3_enabled.cache_clear()
    storage_utils._s3_client = None
    yield
    storage_utils.get_content_delivery_type.cache_clear()
    storage_utils.get_s3_bucket_name.cache_clear()
    storage_utils.is_s3_enabled.cache_clear()
    storage_utils._s3_client = None


class TestStorageClientHelpers:
    def test_cached_config_helpers_cover_delivery_bucket_and_s3_flag(self):
        with patch.object(
            storage_utils,
            "get_learnhouse_config",
            return_value=_make_config(content_delivery="filesystem"),
        ):
            assert storage_utils.get_content_delivery_type() == "filesystem"

        storage_utils.get_content_delivery_type.cache_clear()

        with patch.object(
            storage_utils,
            "get_learnhouse_config",
            return_value=_make_config(content_delivery="s3api"),
        ):
            assert storage_utils.get_content_delivery_type() == "s3api"

        storage_utils.get_s3_bucket_name.cache_clear()
        with patch.object(
            storage_utils,
            "get_learnhouse_config",
            return_value=_make_config(bucket_name=None, content_delivery="s3api"),
        ):
            assert storage_utils.get_s3_bucket_name() == "learnhouse-media"

        storage_utils.get_s3_bucket_name.cache_clear()
        with patch.object(
            storage_utils,
            "get_learnhouse_config",
            return_value=_make_config(bucket_name="custom-bucket", content_delivery="s3api"),
        ):
            assert storage_utils.get_s3_bucket_name() == "custom-bucket"

        storage_utils.is_s3_enabled.cache_clear()
        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="filesystem",
        ):
            assert storage_utils.is_s3_enabled() is False

        storage_utils.is_s3_enabled.cache_clear()
        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="s3api",
        ):
            assert storage_utils.is_s3_enabled() is True

    def test_get_storage_client_returns_none_for_filesystem_and_reuses_s3_client(self):
        mock_client = Mock()
        fake_config = _make_config(content_delivery="s3api", endpoint_url="https://s3.test")

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="filesystem",
        ), patch.object(storage_utils.boto3, "client") as boto_client:
            assert storage_utils.get_storage_client() is None
            boto_client.assert_not_called()

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="s3api",
        ), patch.object(
            storage_utils,
            "get_learnhouse_config",
            return_value=fake_config,
        ), patch.object(
            storage_utils.boto3,
            "client",
            return_value=mock_client,
        ) as boto_client:
            assert storage_utils.get_storage_client() is mock_client
            assert storage_utils.get_storage_client() is mock_client

        boto_client.assert_called_once_with(
            "s3",
            endpoint_url="https://s3.test",
        )


class TestFileReadAndExistenceHelpers:
    def test_read_file_content_covers_filesystem_and_s3_fallbacks(self, tmp_path):
        local_file = tmp_path / "content.txt"
        local_file.write_bytes(b"local-bytes")

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="filesystem",
        ):
            assert storage_utils.read_file_content(str(local_file)) == b"local-bytes"
            assert storage_utils.read_file_content(str(tmp_path / "missing.txt")) is None

        body = Mock()
        body.read.return_value = b"s3-bytes"
        s3_client = Mock()
        s3_client.get_object.return_value = {"Body": body}

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="s3api",
        ), patch.object(
            storage_utils,
            "get_storage_client",
            return_value=s3_client,
        ), patch.object(
            storage_utils,
            "get_s3_bucket_name",
            return_value="bucket",
        ), patch.object(storage_utils.logger, "error"):
            assert storage_utils.read_file_content("content.txt") == b"s3-bytes"

            s3_client.get_object.side_effect = _client_error("NoSuchKey", "get_object")
            assert storage_utils.read_file_content("missing.txt") is None

            s3_client.get_object.side_effect = _client_error("500", "get_object")
            assert storage_utils.read_file_content("broken.txt") is None

            s3_client.get_object.side_effect = NoCredentialsError()
            assert storage_utils.read_file_content("nocreds.txt") is None

            s3_client.get_object.side_effect = RuntimeError("boom")
            assert storage_utils.read_file_content("boom.txt") is None

    def test_file_exists_covers_filesystem_and_s3_branches(self, tmp_path):
        local_file = tmp_path / "exists.txt"
        local_file.write_text("ok")

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="filesystem",
        ):
            assert storage_utils.file_exists(str(local_file)) is True
            assert storage_utils.file_exists(str(tmp_path / "missing.txt")) is False

        s3_client = Mock()
        s3_client.head_object.return_value = {}

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="s3api",
        ), patch.object(
            storage_utils,
            "get_storage_client",
            return_value=s3_client,
        ), patch.object(
            storage_utils,
            "get_s3_bucket_name",
            return_value="bucket",
        ):
            assert storage_utils.file_exists("content/exists.txt") is True

            s3_client.head_object.side_effect = _client_error("404", "head_object")
            assert storage_utils.file_exists("content/missing.txt") is False

            s3_client.head_object.side_effect = RuntimeError("boom")
            assert storage_utils.file_exists("content/broken.txt") is False


class TestDirectoryHelpers:
    def test_list_directory_filters_direct_files_and_handles_s3_errors(self, tmp_path):
        content_dir = tmp_path / "content"
        nested_dir = content_dir / "nested"
        nested_dir.mkdir(parents=True)
        (content_dir / "a.txt").write_text("a")
        (content_dir / "b.md").write_text("b")
        (nested_dir / "c.txt").write_text("c")

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="filesystem",
        ):
            assert set(storage_utils.list_directory(str(content_dir))) == {"a.txt", "b.md"}
            assert storage_utils.list_directory(str(tmp_path / "missing")) == []

        s3_client = Mock()
        paginator = Mock()
        paginator.paginate.return_value = [
            {
                "Contents": [
                    {"Key": "content/a.txt"},
                    {"Key": "content/b.md"},
                    {"Key": "content/nested/c.txt"},
                    {"Key": "content/nested/"},
                ]
            }
        ]
        s3_client.get_paginator.return_value = paginator

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="s3api",
        ), patch.object(
            storage_utils,
            "get_storage_client",
            return_value=s3_client,
        ), patch.object(
            storage_utils,
            "get_s3_bucket_name",
            return_value="bucket",
        ):
            assert storage_utils.list_directory("content") == ["a.txt", "b.md"]

            s3_client.get_paginator.side_effect = _client_error(
                "AccessDenied",
                "list_objects_v2",
            )
            assert storage_utils.list_directory("content") == []

            s3_client.get_paginator.side_effect = RuntimeError("boom")
            assert storage_utils.list_directory("content") == []

    def test_walk_directory_covers_filesystem_s3_and_empty_error_paths(self, tmp_path):
        base_dir = tmp_path / "transfer"
        nested_dir = base_dir / "nested"
        deeper_dir = nested_dir / "deeper"
        deeper_dir.mkdir(parents=True)
        (base_dir / "root.txt").write_text("root")
        (nested_dir / "child.md").write_text("child")
        (deeper_dir / "deep.pdf").write_text("deep")

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="filesystem",
        ):
            walked = list(storage_utils.walk_directory(str(base_dir)))

        assert walked == [
            (str(base_dir), ["nested"], ["root.txt"]),
            (str(nested_dir), ["deeper"], ["child.md"]),
            (str(deeper_dir), [], ["deep.pdf"]),
        ]

        s3_client = Mock()
        paginator = Mock()
        paginator.paginate.return_value = [
            {
                "Contents": [
                    {"Key": "content/transfer/root.txt"},
                    {"Key": "content/transfer/nested/child.md"},
                    {"Key": "content/transfer/nested/deeper/deep.pdf"},
                    {"Key": "content/transfer/side.txt"},
                ]
            }
        ]
        s3_client.get_paginator.return_value = paginator

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="s3api",
        ), patch.object(
            storage_utils,
            "get_storage_client",
            return_value=s3_client,
        ), patch.object(
            storage_utils,
            "get_s3_bucket_name",
            return_value="bucket",
        ):
            walked = list(storage_utils.walk_directory("content/transfer"))

        assert walked == [
            ("content/transfer", ["nested"], ["root.txt", "side.txt"]),
            ("content/transfer/nested", ["deeper"], ["child.md"]),
            ("content/transfer/nested/deeper", [], ["deep.pdf"]),
        ]

        s3_client.get_paginator.side_effect = _client_error("500", "list_objects_v2")
        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="s3api",
        ), patch.object(
            storage_utils,
            "get_storage_client",
            return_value=s3_client,
        ):
            assert list(storage_utils.walk_directory("content/transfer")) == []

        s3_client.get_paginator.side_effect = RuntimeError("boom")
        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="s3api",
        ), patch.object(
            storage_utils,
            "get_storage_client",
            return_value=s3_client,
        ), patch.object(storage_utils.logger, "error"):
            assert list(storage_utils.walk_directory("content/transfer")) == []


class TestUploadAndDeleteHelpers:
    def test_mime_type_for_key_handles_known_and_unknown_extensions(self):
        assert storage_utils._mime_type_for_key("video.mp4") == "video/mp4"
        assert storage_utils._mime_type_for_key("archive.bin") == "application/octet-stream"

    def test_upload_to_s3_covers_success_and_failure_fallbacks(self):
        s3_client = Mock()

        with patch.object(
            storage_utils,
            "get_storage_client",
            return_value=None,
        ):
            assert storage_utils.upload_to_s3("content/file.txt", b"bytes") is False

        with patch.object(
            storage_utils,
            "get_storage_client",
            return_value=s3_client,
        ), patch.object(
            storage_utils,
            "get_s3_bucket_name",
            return_value="bucket",
        ), patch.object(storage_utils.logger, "error"):
            assert storage_utils.upload_to_s3("content/file.txt", b"bytes") is True
            s3_client.put_object.assert_called_once_with(
                Bucket="bucket",
                Key="content/file.txt",
                Body=b"bytes",
            )

            s3_client.put_object.side_effect = _client_error("500", "put_object")
            assert storage_utils.upload_to_s3("content/fail.txt", b"bytes") is False

            s3_client.put_object.side_effect = RuntimeError("boom")
            assert storage_utils.upload_to_s3("content/error.txt", b"bytes") is False

    def test_upload_file_to_s3_sets_content_type_and_handles_failure(self, tmp_path):
        local_file = tmp_path / "video.mp4"
        local_file.write_bytes(b"video")

        s3_client = Mock()

        with patch.object(
            storage_utils,
            "get_storage_client",
            return_value=s3_client,
        ), patch.object(
            storage_utils,
            "get_s3_bucket_name",
            return_value="bucket",
        ), patch.object(storage_utils.logger, "error"):
            assert storage_utils.upload_file_to_s3("content/video.mp4", str(local_file)) is True
            s3_client.upload_file.assert_called_once_with(
                Filename=str(local_file),
                Bucket="bucket",
                Key="content/video.mp4",
                ExtraArgs={"ContentType": "video/mp4"},
            )

            s3_client.upload_file.side_effect = _client_error("500", "upload_file")
            assert storage_utils.upload_file_to_s3("content/fail.pdf", str(local_file)) is False

            s3_client.upload_file.side_effect = RuntimeError("boom")
            assert storage_utils.upload_file_to_s3("content/error.pdf", str(local_file)) is False

        with patch.object(
            storage_utils,
            "get_storage_client",
            return_value=None,
        ):
            assert storage_utils.upload_file_to_s3("content/missing.pdf", str(local_file)) is False

    def test_delete_storage_directory_covers_filesystem_and_s3_paths(self, tmp_path):
        local_dir = tmp_path / "transfer"
        local_dir.mkdir()
        (local_dir / "root.txt").write_text("root")

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="filesystem",
        ):
            assert storage_utils.delete_storage_directory(str(local_dir)) is True

        assert not local_dir.exists()

        s3_dir = tmp_path / "s3-transfer"
        s3_dir.mkdir()
        (s3_dir / "nested.txt").write_text("nested")

        s3_client = Mock()
        paginator = Mock()
        paginator.paginate.return_value = [
            {
                "Contents": [
                    {"Key": f"{s3_dir}/nested.txt"},
                    {"Key": f"{s3_dir}/more.txt"},
                ]
            }
        ]
        s3_client.get_paginator.return_value = paginator

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="s3api",
        ), patch.object(
            storage_utils,
            "get_storage_client",
            return_value=s3_client,
        ), patch.object(
            storage_utils,
            "get_s3_bucket_name",
            return_value="bucket",
        ):
            assert storage_utils.delete_storage_directory(str(s3_dir)) is True

        assert not s3_dir.exists()
        s3_client.delete_objects.assert_called_once_with(
            Bucket="bucket",
            Delete={
                "Objects": [
                    {"Key": f"{s3_dir}/nested.txt"},
                    {"Key": f"{s3_dir}/more.txt"},
                ]
            },
        )

        failing_dir = tmp_path / "broken-transfer"
        failing_dir.mkdir()
        (failing_dir / "root.txt").write_text("root")
        s3_client.get_paginator.side_effect = RuntimeError("boom")

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="s3api",
        ), patch.object(
            storage_utils,
            "get_storage_client",
            return_value=s3_client,
        ), patch.object(
            storage_utils,
            "get_s3_bucket_name",
            return_value="bucket",
        ), patch.object(storage_utils.logger, "error"):
            assert storage_utils.delete_storage_directory(str(failing_dir)) is False

        assert not failing_dir.exists()

    def test_delete_storage_file_covers_filesystem_s3_success_and_failure(self, tmp_path):
        local_file = tmp_path / "file.txt"
        local_file.write_text("file")

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="filesystem",
        ):
            assert storage_utils.delete_storage_file(str(local_file)) is True

        assert not local_file.exists()

        s3_file = tmp_path / "s3-file.txt"
        s3_file.write_text("file")

        s3_client = Mock()
        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="s3api",
        ), patch.object(
            storage_utils,
            "get_storage_client",
            return_value=s3_client,
        ), patch.object(
            storage_utils,
            "get_s3_bucket_name",
            return_value="bucket",
        ):
            assert storage_utils.delete_storage_file(str(s3_file)) is True

        assert not s3_file.exists()
        s3_client.delete_object.assert_called_once_with(
            Bucket="bucket",
            Key=str(s3_file),
        )

        failing_file = tmp_path / "fail-file.txt"
        failing_file.write_text("file")
        s3_client.delete_object.side_effect = RuntimeError("boom")

        with patch.object(
            storage_utils,
            "get_content_delivery_type",
            return_value="s3api",
        ), patch.object(
            storage_utils,
            "get_storage_client",
            return_value=s3_client,
        ), patch.object(
            storage_utils,
            "get_s3_bucket_name",
            return_value="bucket",
        ), patch.object(storage_utils.logger, "error"):
            assert storage_utils.delete_storage_file(str(failing_file)) is False

        assert failing_file.exists()

    def test_upload_directory_to_s3_covers_disabled_missing_and_partial_failures(self, tmp_path):
        local_dir = tmp_path / "course"
        nested_dir = local_dir / "nested"
        nested_dir.mkdir(parents=True)
        (local_dir / "root.txt").write_text("root")
        (nested_dir / "child.md").write_text("child")

        with patch.object(
            storage_utils,
            "is_s3_enabled",
            return_value=False,
        ):
            assert storage_utils.upload_directory_to_s3(str(local_dir), "content/course") is True

        missing_dir = tmp_path / "missing-course"
        with patch.object(
            storage_utils,
            "is_s3_enabled",
            return_value=True,
        ), patch.object(storage_utils, "upload_file_to_s3") as upload_mock:
            assert storage_utils.upload_directory_to_s3(str(missing_dir), "content/course") is True
            upload_mock.assert_not_called()

        upload_mock = Mock(side_effect=[True, False])
        with patch.object(
            storage_utils,
            "is_s3_enabled",
            return_value=True,
        ), patch.object(
            storage_utils,
            "upload_file_to_s3",
            upload_mock,
        ):
            assert storage_utils.upload_directory_to_s3(str(local_dir), "content/course") is False

        assert upload_mock.call_count == 2
        uploaded_paths = {call.args[0] for call in upload_mock.call_args_list}
        assert uploaded_paths == {
            "content/course/root.txt",
            "content/course/nested/child.md",
        }
