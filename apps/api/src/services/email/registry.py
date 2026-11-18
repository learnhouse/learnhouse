"""Registry of every email template, OSS and EE.

A template is a function ``build(values, lang, brand) -> Email`` registered
under a dotted name (``account.password_reset``, ``platform.org_message``)
with its category and sample data. The pipeline looks templates up here, the
preview gallery renders every sample, and the tests walk the whole list, so a
template that is registered is automatically previewed and tested.

OSS templates live in ``src/services/email/templates``; EE registers its own
from ``ee/services/email_templates`` when the EE package is present.
"""

from __future__ import annotations

import importlib
import logging
from dataclasses import dataclass
from typing import Any, Callable, Optional

from src.services.email.layout import Brand, Email

logger = logging.getLogger(__name__)

Builder = Callable[[dict, str, Brand], Email]


@dataclass(frozen=True)
class Sample:
    """One preview of a template: its context, and optionally an org brand."""

    values: dict
    label: str = ""
    org: Optional[dict] = None
    lang: str = "en"


@dataclass(frozen=True)
class EmailTemplate:
    name: str
    category: str
    build: Builder
    samples: tuple[Sample, ...]
    # Mail the reader is waiting on (reset, verification, invitation): a
    # delivery failure is raised to the caller instead of being logged.
    critical: bool = False
    description: str = ""


_REGISTRY: dict[str, EmailTemplate] = {}
_loaded = False

OSS_TEMPLATE_MODULES = (
    "src.services.email.templates.account",
    "src.services.email.templates.org",
    "src.services.email.templates.learning",
    "src.services.email.templates.billing",
)
EE_TEMPLATE_MODULE = "ee.services.email_templates"


def email_template(
    name: str,
    *,
    category: str,
    samples: tuple[Any, ...] = (),
    critical: bool = False,
    description: str = "",
) -> Callable[[Builder], Builder]:
    """Register ``build`` as template ``name``."""

    def decorator(build: Builder) -> Builder:
        prepared = tuple(s if isinstance(s, Sample) else Sample(values=dict(s)) for s in samples)
        _REGISTRY[name] = EmailTemplate(
            name=name, category=category, build=build, samples=prepared,
            critical=critical, description=description or (build.__doc__ or "").strip().split("\n")[0],
        )
        return build

    return decorator


def load_templates() -> None:
    """Import every template module once (EE only when it is available)."""
    global _loaded
    if _loaded:
        return
    for module in OSS_TEMPLATE_MODULES:
        importlib.import_module(module)
    from src.core.ee_hooks import is_ee_available

    if is_ee_available():
        _load_ee()
    _loaded = True


def _load_ee() -> None:
    try:
        importlib.import_module(EE_TEMPLATE_MODULE)
    except ImportError:
        logger.debug("EE email templates not importable", exc_info=True)


def get_template(name: str) -> EmailTemplate:
    load_templates()
    if name not in _REGISTRY:
        # An EE feature asking for its own template means the EE code is
        # running, whatever the availability probe said (tests pin OSS mode).
        _load_ee()
    try:
        return _REGISTRY[name]
    except KeyError:
        raise ValueError(f"Unknown email template: {name}") from None


def all_templates() -> list[EmailTemplate]:
    load_templates()
    return [_REGISTRY[name] for name in sorted(_REGISTRY)]
