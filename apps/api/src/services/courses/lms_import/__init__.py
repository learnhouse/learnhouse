"""
Convert courses exported from other LMSes into LearnHouse course packages.

Supported sources: Moodle (.mbz backups), Canvas (.imscc), Blackboard Learn
(course export/archive .zip), D2L Brightspace (export .zip), Open edX (OLX
.tar.gz) and generic IMS Common Cartridge 1.0-1.3. The package this produces is
the one the course importer reads (``transfer/import_service.py``).

The converter has no database or web dependency, so it runs the same from the
API endpoint and from the CLI.
"""

from .convert import (
    ConversionError,
    ConversionResult,
    convert,
    convert_to_directory,
    detect,
    read_course,
    source_choices,
)
from .package import ConvertOptions, PackageWriter, zip_directory
from .report import ConversionReport

__all__ = [
    "ConversionError",
    "ConversionReport",
    "ConversionResult",
    "ConvertOptions",
    "PackageWriter",
    "convert",
    "convert_to_directory",
    "detect",
    "read_course",
    "source_choices",
    "zip_directory",
]
