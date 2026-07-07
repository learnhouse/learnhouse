"""Pending-action runtime constants.

Tuning knobs that don't change between deployments; user-facing agent
config (model, MCP enablement) lives on `AIConfig` in `config/config.py`.
"""

# Pending action store
PENDING_TTL_SECONDS = 15 * 60                    # 15 minutes while proposed
PENDING_POST_APPLY_TTL_SECONDS = 24 * 60 * 60    # 24 hours after apply (undo)
MAX_PENDINGS_PER_SCOPE = 20
