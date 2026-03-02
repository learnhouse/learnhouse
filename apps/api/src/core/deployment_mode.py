"""
Single source of truth for deployment mode detection.

Three modes:
- 'saas': LEARNHOUSE_SAAS=true — plan-based gating, usage limits apply
- 'ee':   EE folder present (and not SaaS) — all features enabled, unlimited
- 'oss':  EE folder absent (and not SaaS) — EE features blocked, unlimited otherwise
"""

from typing import Literal
from config.config import get_learnhouse_config
from src.core.ee_hooks import is_ee_available

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
        return 'ee'
    return 'oss'
