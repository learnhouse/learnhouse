"""
Single source of truth for deployment mode detection.

Three modes:
- 'saas': LEARNHOUSE_SAAS=true — plan-based gating, usage limits apply
- 'ee':   EE folder present (and not SaaS) — all features enabled, unlimited
- 'oss':  EE folder absent (and not SaaS) — EE features blocked, unlimited otherwise
"""

from typing import Literal
from config.config import get_learnhouse_config
from src.core.ee_hooks import is_ee_available, get_ee_hooks

DeploymentMode = Literal['saas', 'oss', 'ee']

# Features blocked in OSS mode but available in EE and plan-gated in SaaS
EE_ONLY_FEATURES: frozenset[str] = frozenset({
    'sso', 'audit_logs', 'payments', 'analytics_advanced', 'scorm'
})


def get_deployment_mode() -> DeploymentMode:
    """
    Determine the current deployment mode.

    Priority: saas > ee > oss

    IMPORTANT: SaaS deployments always ship with the EE folder present, so
    is_ee_available() returns True in SaaS mode. The saas_mode flag MUST be
    checked first — never reorder these checks.
    """
    if get_learnhouse_config().general_config.saas_mode:
        return 'saas'
    # Only reaches here for self-hosted deployments.
    # EE folder present = self-hosted enterprise; absent = OSS.
    if is_ee_available():
        # When EE is present, license + integrity verification gate the mode:
        # invalid / missing / revoked / tampered → degrade to 'oss' so the
        # frontend transparently hides EE features. EE without is_license_active
        # (older builds) keeps the original behavior.
        hooks = get_ee_hooks()
        if hooks is not None and hasattr(hooks, 'is_license_active'):
            return 'ee' if hooks.is_license_active() else 'oss'
        return 'ee'
    return 'oss'
