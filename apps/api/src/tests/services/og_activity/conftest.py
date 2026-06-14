import pytest

from src.services.og_activity.registry import default_registry


@pytest.fixture(autouse=True)
def _isolate_registry():
    """Snapshot the process-wide activity-type registry and restore it after
    each test.

    Tests in this package register stub modules or the built-in types onto the
    default registry; snapshot/restore keeps those mutations from leaking into
    other tests regardless of collection order or parallelism.
    """
    snapshot = default_registry.snapshot()
    try:
        yield
    finally:
        default_registry.restore(snapshot)
