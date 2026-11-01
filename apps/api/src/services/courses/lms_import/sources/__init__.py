"""
Source readers. Each module exposes:

* ``KEY``: short id used on the CLI and in the API (``moodle``, ``canvas``...)
* ``LABEL``: human-readable name
* ``detect(root: str) -> int``: confidence 0-100 that ``root`` (an extracted
  export) is this source's format
* ``read(root: str) -> ir.Course``: parse the export
"""

from __future__ import annotations

from importlib import import_module

# Order matters on ties: specific dialects before the generic Common Cartridge
SOURCE_MODULES = ("moodle", "canvas", "blackboard", "brightspace", "openedx", "common_cartridge")


def get_source(key: str):
    if key not in SOURCE_MODULES:
        raise KeyError(key)
    return import_module(f"{__name__}.{key}")


def all_sources():
    return [get_source(k) for k in SOURCE_MODULES]
