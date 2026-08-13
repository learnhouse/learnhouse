import logging
import os
import sys


async def create_logs_dir():
    if not os.path.exists("logs"):
        os.mkdir("logs")


def _log_level() -> int:
    raw = (os.environ.get("LEARNHOUSE_LOG_LEVEL") or "INFO").strip().upper()
    return getattr(logging, raw, logging.INFO)


def init_logging() -> None:
    """Send application logs to stdout.

    Without this the root logger has no handler, so Python's fallback emits
    WARNING and above only — every ``logger.info`` in the codebase disappears,
    including the ones a background job relies on to show it ran at all.

    Deliberately additive rather than ``basicConfig``: uvicorn installs its own
    handlers on its own loggers, and reconfiguring the root with ``force=True``
    would tear those down and take the access log with them. Attaching one
    stream handler to the root leaves uvicorn alone and lets everything that
    propagates through.

    No file handler. In a container nothing reads ``logs/learnhouse.log`` and
    it grows until the disk complains; stdout is what the platform collects.
    """
    root = logging.getLogger()
    root.setLevel(_log_level())

    already = any(
        isinstance(h, logging.StreamHandler) and getattr(h, "_learnhouse", False)
        for h in root.handlers
    )
    if already:
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s: %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S",
        )
    )
    handler._learnhouse = True  # type: ignore[attr-defined]
    root.addHandler(handler)

    logging.getLogger(__name__).info("Application logging initialised at %s", logging.getLevelName(root.level))
