from src.services.og_activity.registry import register
from src.services.og_activity.types.dynamic_page import DynamicPageModule
from src.services.og_activity.types.document import DocumentModule


def register_builtin_types() -> None:
    """Idempotently register the built-in activity type modules."""
    register(DynamicPageModule())
    register(DocumentModule())


# Register on import so the app (and any importer) has the built-ins available.
register_builtin_types()
