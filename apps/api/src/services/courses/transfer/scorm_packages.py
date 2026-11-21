"""SCORM packages shared by a course's SCO activities.

A SCORM import extracts each package once per course, under
``<course>/scorm/<package_uuid>/extracted``, and every SCO activity made from
it names the package in ``content["scorm_package_uuid"]``. The activity's own
folder holds none of the package, so anything that copies a course or an
activity (clone, export and import, copying an activity to another course)
has to take the package folder along, or the copy opens a SCORM player with
nothing to play.
"""

import re
from typing import Optional

# Package ids are minted as f"scorm_package_{uuid4()}". The id comes from
# activity content, which course editors can write, so it is checked before
# it becomes a path segment (the EE SCORM routes apply the same pattern).
_PACKAGE_UUID = re.compile(
    r"^scorm_package_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def scorm_package_uuid(activity_type, content) -> Optional[str]:
    """The shared package a SCORM activity plays, or None (other activity
    types, legacy per-activity packages, or an id that isn't one of ours)."""
    if str(getattr(activity_type, "value", activity_type)) != "TYPE_SCORM":
        return None
    value = content.get("scorm_package_uuid") if isinstance(content, dict) else None
    return value if isinstance(value, str) and _PACKAGE_UUID.match(value) else None


def scorm_package_dir(course_path: str, package_uuid: str) -> str:
    """Extracted content of a shared package under a course's storage path."""
    return f"{course_path.rstrip('/')}/scorm/{package_uuid}/extracted"
