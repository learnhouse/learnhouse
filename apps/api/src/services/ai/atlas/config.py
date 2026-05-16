"""Atlas runtime constants. The user-facing config (model name, MCP URL,
session TTL) lives on `AIConfig.atlas` in `config/config.py`; the values
here are tuning knobs that don't change between deployments."""

# Pending edit store
PENDING_TTL_SECONDS = 15 * 60                    # 15 minutes while in proposed state
PENDING_POST_APPLY_TTL_SECONDS = 24 * 60 * 60    # 24 hours after apply (for undo)
MAX_PENDINGS_PER_SESSION = 20

# Chat history (Redis-backed; matches the existing ai services pattern)
CHAT_HISTORY_TTL_SECONDS = 25 * 24 * 60 * 60
CHAT_HISTORY_MAX_MESSAGES = 20

# Snapshot cache (process-local LRU)
SNAPSHOT_CACHE_SIZE = 64

# Activity content fallback when the snapshot is too large to inline.
INLINE_ACTIVITY_LIMIT = 200
