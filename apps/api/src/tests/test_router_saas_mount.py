"""The internal cloud plan-state router is mounted ONLY in SaaS mode.

`src/router.py` decides this via `_mount_saas_only_routers`, which checks
`get_deployment_mode()`. We exercise both branches directly (no module reload).
"""

from unittest.mock import patch

from fastapi import APIRouter

from src.router import _mount_saas_only_routers


def test_cloud_internal_router_mounted_in_saas():
    router = APIRouter()
    with patch("src.router.get_deployment_mode", return_value="saas"):
        _mount_saas_only_routers(router)
    # SaaS mounts exactly the internal cloud plan endpoint.
    assert len(router.routes) == 1


def test_cloud_internal_router_absent_in_oss_and_ee():
    for mode in ("oss", "ee"):
        router = APIRouter()
        with patch("src.router.get_deployment_mode", return_value=mode):
            _mount_saas_only_routers(router)
        assert len(router.routes) == 0, f"cloud_internal must be absent in {mode}"
