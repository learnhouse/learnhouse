"""Course tag storage helpers."""


def normalize_course_tags(raw: str) -> str:
    """Store AI-planner tags in the same pipe-separated form TagInput uses.

    The planning prompt historically asked for comma-separated tags, so
    finalize wrote ``"a, b, c"`` and the editor rendered one chip.
    Split on commas *or* pipes, strip empties, rejoin with ``|``.
    """
    if not raw:
        return ""
    parts = []
    for chunk in raw.replace("|", ",").split(","):
        tag = chunk.strip()
        if tag:
            parts.append(tag)
    return "|".join(parts)
