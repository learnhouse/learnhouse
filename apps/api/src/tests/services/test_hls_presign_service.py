"""Unit tests for generate_presigned_get_url in storage_utils."""

from unittest.mock import Mock

import src.services.courses.transfer.storage_utils as storage_utils


def test_presign_returns_none_when_s3_disabled(monkeypatch):
    monkeypatch.setattr(storage_utils, "is_s3_enabled", lambda: False)
    assert storage_utils.generate_presigned_get_url("content/x.ts") is None


def test_presign_returns_none_without_client(monkeypatch):
    monkeypatch.setattr(storage_utils, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(storage_utils, "get_storage_client", lambda: None)
    assert storage_utils.generate_presigned_get_url("content/x.ts") is None


def test_presign_returns_signed_url(monkeypatch):
    client = Mock()
    client.generate_presigned_url.return_value = "https://r2/x.ts?X-Amz-Signature=sig"
    monkeypatch.setattr(storage_utils, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(storage_utils, "get_storage_client", lambda: client)
    monkeypatch.setattr(storage_utils, "get_s3_bucket_name", lambda: "bucket")

    url = storage_utils.generate_presigned_get_url("content/x.ts", expires_in=123)
    assert url == "https://r2/x.ts?X-Amz-Signature=sig"
    client.generate_presigned_url.assert_called_once_with(
        "get_object",
        Params={"Bucket": "bucket", "Key": "content/x.ts"},
        ExpiresIn=123,
    )


def test_presign_swallows_errors(monkeypatch):
    client = Mock()
    client.generate_presigned_url.side_effect = RuntimeError("boom")
    monkeypatch.setattr(storage_utils, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(storage_utils, "get_storage_client", lambda: client)
    monkeypatch.setattr(storage_utils, "get_s3_bucket_name", lambda: "bucket")
    assert storage_utils.generate_presigned_get_url("content/x.ts") is None
