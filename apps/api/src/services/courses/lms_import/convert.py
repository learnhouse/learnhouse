"""
End-to-end conversion: LMS export in, LearnHouse course package out.

Used by the CLI (``python cli.py lms-import convert ...``) and by the API's
"Import from another LMS" endpoint, which writes the package straight into the
course importer's temp directory instead of zipping it.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from dataclasses import dataclass
from typing import Optional

from . import ir
from .archive import DEFAULT_LIMITS, ArchiveError, ExtractLimits, extract_archive
from .package import ConvertOptions, PackageWriter, zip_directory
from .report import ConversionReport, error_text
from .sources import SOURCE_MODULES, all_sources, get_source


class ConversionError(Exception):
    """The export cannot be converted (unknown format, unreadable archive...)."""


@dataclass
class Detection:
    key: str
    label: str
    score: int


@dataclass
class ConversionResult:
    course: ir.Course
    report: ConversionReport
    package_dir: str
    zip_path: Optional[str] = None


def detect(root: str) -> list[Detection]:
    """Candidate formats for an extracted export, most likely first."""
    found = []
    for module in all_sources():
        try:
            score = int(module.detect(root) or 0)
        except Exception:
            score = 0
        if score > 0:
            found.append(Detection(module.KEY, module.LABEL, score))
    order = {k: i for i, k in enumerate(SOURCE_MODULES)}
    found.sort(key=lambda d: (-d.score, order.get(d.key, len(order))))
    return found


def source_choices() -> list[tuple[str, str]]:
    return [(m.KEY, m.LABEL) for m in all_sources()]


def read_course(root: str, source: str = "auto") -> ir.Course:
    if source == "auto":
        candidates = detect(root)
        if not candidates:
            raise ConversionError(
                "Unrecognized export. Supported: " + ", ".join(label for _k, label in source_choices())
            )
        source = candidates[0].key
    try:
        module = get_source(source)
    except KeyError:
        raise ConversionError(f"Unknown source '{source}'") from None
    try:
        course = module.read(root)
    except ConversionError:
        raise
    except Exception as e:
        raise ConversionError(f"Could not read the {module.LABEL} export: {error_text(e)}") from e
    course.source = module.KEY
    return course


def read_export(root: str, source: str, work_dir: str, limits: ExtractLimits = DEFAULT_LIMITS) -> ir.Course:
    """Read an extracted export, or a folder of exports combined into one course."""
    root = _unwrap(root)
    nested = _nested_exports(root) if not detect(root) else []
    if nested:
        return _read_bundle(nested, os.path.join(work_dir, "nested"), source, limits)
    return read_course(root, source)


def convert_to_directory(
    input_path: str,
    package_dir: str,
    *,
    source: str = "auto",
    options: Optional[ConvertOptions] = None,
    work_dir: str,
    limits: ExtractLimits = DEFAULT_LIMITS,
) -> ConversionResult:
    """Extract ``input_path`` under ``work_dir`` and write the package to ``package_dir``."""
    if os.path.isdir(package_dir) and os.listdir(package_dir):
        raise ConversionError(f"Output directory is not empty: {package_dir}")
    try:
        root = extract_archive(input_path, os.path.join(work_dir, "source"), limits)
    except ArchiveError as e:
        raise ConversionError(str(e)) from e
    course = read_export(root, source, work_dir, limits)
    options = options or ConvertOptions()
    if options.fallback_title and course.title.strip() in ("", UNTITLED):
        # Readers also name a loose chapter after the (missing) course title
        for section in course.sections:
            if section.title.strip() in ("", UNTITLED):
                section.title = options.fallback_title[:500]
        course.title = options.fallback_title[:500]
    if "_" in course.title and " " not in course.title:  # a file name used as a title
        course.title = course.title.replace("_", " ")
    report = ConversionReport(source=course.source, course_title=course.title)
    PackageWriter(course, package_dir, options, report).write()
    return ConversionResult(course=course, report=report, package_dir=package_dir)


def convert(
    input_path: str,
    output: str,
    *,
    source: str = "auto",
    options: Optional[ConvertOptions] = None,
    work_dir: Optional[str] = None,
    limits: ExtractLimits = DEFAULT_LIMITS,
) -> ConversionResult:
    """Convert ``input_path`` (archive or extracted folder).

    ``output`` ending in ``.zip`` produces a zipped package; anything else is
    used as the package directory.
    """
    own_work = work_dir is None
    work = work_dir or tempfile.mkdtemp(prefix="lh-lms-import-")
    try:
        zip_out = output.lower().endswith(".zip")
        package_dir = os.path.join(work, "package") if zip_out else output
        result = convert_to_directory(input_path, package_dir, source=source, options=options, work_dir=work,
                                      limits=limits)
        if zip_out:
            os.makedirs(os.path.dirname(os.path.abspath(output)) or ".", exist_ok=True)
            result.zip_path = zip_directory(package_dir, output)
        return result
    finally:
        if own_work:
            shutil.rmtree(work, ignore_errors=True)


UNTITLED = "Imported course"

# A wrapper zip of exports (a publisher's test bank: one archive per chapter)
_ARCHIVE_EXTS = (".zip", ".imscc", ".mbz", ".tar.gz", ".tgz")
MAX_NESTED_EXPORTS = 200


def _nested_exports(root: str) -> list[str]:
    """Archives making up a folder that is not an export itself, in name order."""
    found = []
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if name.lower().endswith(_ARCHIVE_EXTS) and not name.startswith("._"):
                found.append(os.path.join(dirpath, name))
    return sorted(found, key=lambda p: os.path.relpath(p, root).lower())[:MAX_NESTED_EXPORTS + 1]


def _read_bundle(archives: list[str], work: str, source: str, limits: ExtractLimits) -> ir.Course:
    """One course from several exports: each becomes one chapter group, in name order."""
    if len(archives) > MAX_NESTED_EXPORTS:
        raise ConversionError(f"The archive holds more than {MAX_NESTED_EXPORTS} exports; import them separately")
    course = ir.Course(title="", source="")
    budget = limits.max_total_bytes
    for n, path in enumerate(archives, start=1):
        dest = os.path.join(work, str(n))
        try:
            extract_archive(path, dest, ExtractLimits(max_entries=limits.max_entries, max_total_bytes=budget,
                                                      max_entry_bytes=limits.max_entry_bytes,
                                                      max_ratio=limits.max_ratio))
            budget -= sum(os.path.getsize(os.path.join(d, f)) for d, _x, fs in os.walk(dest) for f in fs)
            inner = read_course(_unwrap(dest), source)
        except (ArchiveError, ConversionError) as e:
            course.skipped.append((os.path.basename(path), "export", error_text(e)))
            continue
        course.source = course.source or inner.source
        name = inner.title or title_from_filename(path)
        if "_" in name and " " not in name:  # a file name used as a title ("Chapter_01_Bonding")
            name = name.replace("_", " ")
        for section in inner.sections:
            section.title = name if len(inner.sections) == 1 else f"{name} › {section.title}"
            section.id = f"{n}:{section.id}"
            course.sections.append(section)
        course.warnings += [f"{name}: {w}" for w in inner.warnings]
    if not course.sections:
        raise ConversionError("None of the exports inside the archive could be read")
    return course


def title_from_filename(name: str) -> str:
    """A course name from an export's file name ("D2LExport_Calculus_1.zip" -> "D2LExport Calculus 1")."""
    base = os.path.basename((name or "").replace("\\", "/"))
    lower = base.lower()
    for ext in (".tar.gz", ".tgz", ".mbz", ".imscc", ".zip", ".gz", ".tar"):
        if lower.endswith(ext):
            base = base[: -len(ext)]
            break
    return " ".join(base.replace("_", " ").replace("+", " ").split())[:200]


def _unwrap(root: str) -> str:
    """Step into a single top-level folder (archives zipped from a parent dir)."""
    current = root
    for _ in range(3):
        entries = [e for e in os.listdir(current) if not e.startswith((".", "__MACOSX"))]
        if len(entries) == 1 and os.path.isdir(os.path.join(current, entries[0])):
            if detect(current):
                return current
            current = os.path.join(current, entries[0])
        else:
            break
    return current
