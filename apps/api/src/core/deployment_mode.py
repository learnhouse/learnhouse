"""
Single source of truth for deployment mode detection.

Three modes:
- 'saas': LEARNHOUSE_SAAS=true — plan-based gating, usage limits apply
- 'ee':   EE folder present (and not SaaS) — all features enabled, unlimited
- 'oss':  EE folder absent (and not SaaS) — EE features blocked, unlimited otherwise

Development override:
- LEARNHOUSE_FORCE_EE=1 skips the license check when the EE folder is present.
  Only effective when development_mode=true in config. Never set this in production.
"""

import logging
import os
from typing import Literal
from config.config import get_learnhouse_config
from src.core.ee_hooks import is_ee_available, get_ee_hooks

logger = logging.getLogger(__name__)

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
        # Dev override: bypass license check when explicitly requested.
        # LEARNHOUSE_FORCE_EE=1 is only honoured in development_mode to
        # prevent accidental use in production deployments.
        if (
            os.environ.get('LEARNHOUSE_FORCE_EE') == '1'
            and get_learnhouse_config().general_config.development_mode
        ):
            return 'ee'
        # When EE is present, license + integrity verification gate the mode:
        # invalid / missing / revoked / tampered → degrade to 'oss' so the
        # frontend transparently hides EE features.
        #
        # Fail CLOSED when the hooks module cannot be loaded. is_ee_available()
        # only checks that an `ee` directory exists, so a present-but-broken EE
        # package used to land here and fall through to 'ee' — full Enterprise
        # with the license branch never reached and verify_manifest() never run,
        # since its only caller lives inside the module that failed to import.
        # Any import error in the EE tree silently unlocked every EE feature.
        hooks = get_ee_hooks()
        if hooks is None or not hasattr(hooks, 'is_license_active'):
            logger.error(
                "EE directory is present but its hooks module did not load "
                "(is_license_active unavailable) — refusing to enable EE. "
                "Deployment will run as OSS until the import error is fixed."
            )
            return 'oss'
        return 'ee' if hooks.is_license_active() else 'oss'
    return 'oss'
