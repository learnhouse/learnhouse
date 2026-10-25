"""
Command line for the LMS converter.

    python -m src.services.courses.lms_import convert backup.mbz -o course.zip
    python -m src.services.courses.lms_import inspect export.imscc
    python -m src.services.courses.lms_import push backup.mbz --url https://learn.example.com --token lh_... --org-id 1

Also mounted on the API CLI as ``python cli.py lms-import ...`` and installed
as ``learnhouse-lms-import`` in the LearnHouse image.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time
from typing import Annotated, Optional

import typer

from . import ir
from .archive import ArchiveError, extract_archive
from .convert import ConversionError, _unwrap, convert, detect, read_export, source_choices, title_from_filename
from .package import QUIZ_MODES, ConvertOptions

app = typer.Typer(
    help="Convert courses exported from Moodle, Canvas, Blackboard, Brightspace, Open edX or any "
    "IMS Common Cartridge into LearnHouse course packages.",
    no_args_is_help=True,
)

SourceOpt = Annotated[str, typer.Option("--source", "-s", help="auto, " + ", ".join(k for k, _ in source_choices()))]
QuizModeOpt = Annotated[
    str,
    typer.Option("--quiz-mode", help="assignment: graded assignments (default); page: pages with quiz blocks"),
]


def _check_choices(source: str, quiz_mode: str) -> None:
    keys = [k for k, _ in source_choices()]
    if source != "auto" and source not in keys:
        raise typer.BadParameter(f"unknown source '{source}' (choose from auto, {', '.join(keys)})")
    if quiz_mode not in QUIZ_MODES:
        raise typer.BadParameter(f"quiz mode must be one of {', '.join(QUIZ_MODES)}")


@app.command()
def sources():
    """List the supported export formats."""
    for key, label in source_choices():
        typer.echo(f"{key:18} {label}")


@app.command()
def inspect(
    path: Annotated[str, typer.Argument(help="Export archive or extracted folder")],
    source: SourceOpt = "auto",
    as_json: Annotated[bool, typer.Option("--json", help="Machine-readable output")] = False,
):
    """Detect the format and show the course structure without converting."""
    _check_choices(source, "assignment")
    work = tempfile.mkdtemp(prefix="lh-lms-inspect-")
    try:
        try:
            root = _unwrap(extract_archive(path, os.path.join(work, "source")))
        except ArchiveError as e:
            _fail(str(e))
        candidates = detect(root)
        try:
            course = read_export(root, source, work)
        except ConversionError as e:
            _fail(str(e))
        outline = _outline(course)
        if as_json:
            typer.echo(json.dumps({"detected": [c.__dict__ for c in candidates], "course": outline}, indent=2,
                                  ensure_ascii=False))
            return
        typer.echo("Detected: " + (", ".join(f"{c.label} ({c.score})" for c in candidates) or "nothing"))
        typer.echo(f"Course: {outline['title']}")
        for section in outline["sections"]:
            hidden = "" if section["visible"] else " [hidden]"
            typer.echo(f"  ▸ {section['title']}{hidden}")
            for item in section["items"]:
                extra = f" ({item['questions']} questions)" if item.get("questions") else ""
                hidden = "" if item.get("visible", True) else " [hidden]"
                typer.echo(f"      - [{item['kind']}] {item['title']}{extra}{hidden}")
        for w in course.warnings[:50]:
            typer.echo(f"  ! {w}", err=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


@app.command(name="convert")
def convert_cmd(
    path: Annotated[str, typer.Argument(help="Export archive (.mbz, .imscc, .zip, .tar.gz) or extracted folder")],
    output: Annotated[str, typer.Option("--output", "-o", help="Package to write: a .zip file or a directory")],
    source: SourceOpt = "auto",
    quiz_mode: QuizModeOpt = "assignment",
    report: Annotated[Optional[str], typer.Option("--report", help="Write the conversion report as JSON")] = None,
    skip_hidden: Annotated[bool, typer.Option("--skip-hidden", help="Leave out hidden sections and items")] = False,
    unpublished: Annotated[bool, typer.Option("--unpublished", help="Import every activity unpublished")] = False,
    no_transcode: Annotated[
        bool, typer.Option("--no-transcode", help="Never convert unsupported media formats (ffmpeg/Pillow)")
    ] = False,
    keep_due_dates: Annotated[
        bool, typer.Option("--keep-due-dates", help="Keep due dates that have already passed")
    ] = False,
):
    """Convert an export into a LearnHouse course package (importable from the dashboard or with `push`)."""
    _check_choices(source, quiz_mode)
    if os.path.exists(output) and output.lower().endswith(".zip"):
        _fail(f"{output} already exists")
    options = ConvertOptions(quiz_mode=quiz_mode, include_hidden=not skip_hidden, publish=not unpublished,
                             transcode=not no_transcode, keep_past_due_dates=keep_due_dates,
                             fallback_title=title_from_filename(path))
    started = time.monotonic()
    try:
        result = convert(path, output, source=source, options=options)
    except ConversionError as e:
        _fail(str(e))
    for line in result.report.summary_lines():
        typer.echo(line)
    typer.echo(f"Written: {result.zip_path or result.package_dir} ({time.monotonic() - started:.1f}s)")
    _print_problems(result.report)
    if report:
        with open(report, "w", encoding="utf-8") as f:
            json.dump(result.report.to_dict(), f, indent=2, ensure_ascii=False)


@app.command()
def push(
    path: Annotated[str, typer.Argument(help="Export archive to import (converted by the server)")],
    url: Annotated[str, typer.Option("--url", envvar="LEARNHOUSE_URL", help="LearnHouse base URL")],
    token: Annotated[str, typer.Option("--token", envvar="LEARNHOUSE_API_TOKEN", help="API token (lh_...)")],
    org_id: Annotated[int, typer.Option("--org-id", envvar="LEARNHOUSE_ORG_ID", help="Organization id")],
    source: SourceOpt = "auto",
    quiz_mode: QuizModeOpt = "assignment",
    name_prefix: Annotated[Optional[str], typer.Option("--name-prefix")] = None,
    public: Annotated[bool, typer.Option("--public", help="Make the course public")] = False,
    publish: Annotated[bool, typer.Option("--publish", help="Publish the course")] = False,
    timeout: Annotated[int, typer.Option("--timeout", help="Seconds to wait for the conversion")] = 3600,
):
    """Upload an export to a LearnHouse instance and import it (needs a token with course create rights)."""
    import httpx

    _check_choices(source, quiz_mode)
    if not os.path.isfile(path):
        _fail(f"Not a file: {path}")
    api = url.rstrip("/") + "/api/v1/courses"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        _push(api, headers, path, org_id, source, quiz_mode, name_prefix, public, publish, timeout)
    except httpx.HTTPError as e:  # connection refused, DNS, timeouts...
        _fail(f"Request to {url} failed: {e}")
    except (ValueError, KeyError, TypeError) as e:  # a 2xx answer that is not the API's JSON
        _fail(f"Unexpected response from {url}: {e}")


def _push(api: str, headers: dict, path: str, org_id: int, source: str, quiz_mode: str,
          name_prefix: Optional[str], public: bool, publish: bool, timeout: int) -> None:
    import httpx

    with httpx.Client(headers=headers, timeout=httpx.Timeout(60.0, read=600.0)) as client:
        typer.echo(f"Uploading {os.path.basename(path)}…")
        with open(path, "rb") as f:
            r = client.post(f"{api}/import/lms/analyze", params={"org_id": org_id, "source": source,
                                                                  "quiz_mode": quiz_mode},
                            files={"package": (os.path.basename(path), f, "application/octet-stream")})
        _raise_for(r)
        temp_id = r.json()["temp_id"]
        deadline = time.monotonic() + timeout
        status = r.json()
        while status["status"] == "processing":
            if time.monotonic() > deadline:
                _fail("Timed out waiting for the conversion")
            time.sleep(3)
            r = client.get(f"{api}/import/lms/analyze/{temp_id}", params={"org_id": org_id})
            _raise_for(r)
            status = r.json()
        if status["status"] == "failed":
            _fail(status.get("error") or "Conversion failed")
        report = status.get("report") or {}
        typer.echo(f"Converted {status.get('source_label')} export: "
                   + ", ".join(f"{c['name']} ({c['activities_count']} activities)" for c in status["courses"]))
        for w in (report.get("warnings") or [])[:30]:
            typer.echo(f"  ! {w}", err=True)
        r = client.post(f"{api}/import", params={"org_id": org_id}, json={
            "temp_id": temp_id,
            "course_uuids": [c["course_uuid"] for c in status["courses"]],
            "name_prefix": name_prefix,
            "set_private": not public,
            "set_unpublished": not publish,
        })
        _raise_for(r)
        result = r.json()
        for c in result["courses"]:
            if c["success"]:
                typer.echo(f"Imported: {c['name']} → {c['new_uuid']}")
            else:
                typer.echo(f"Failed: {c.get('error')}", err=True)
        if result["failed"]:
            raise typer.Exit(1)


def _raise_for(response) -> None:
    if response.status_code >= 400:
        try:
            data = response.json()
            detail = data.get("detail") if isinstance(data, dict) else data
        except ValueError:
            detail = response.text[:300]
        _fail(f"HTTP {response.status_code}: {detail}")


def _fail(message: str):
    typer.echo(f"Error: {message}", err=True)
    raise typer.Exit(1)


def _print_problems(report) -> None:
    for s in report.skipped[:100]:
        typer.echo(f"  - skipped [{s.kind}] {s.title}: {s.reason}", err=True)
    for w in report.warnings[:100]:
        typer.echo(f"  ! {w}", err=True)
    extra = len(report.warnings) - 100 + report.dropped_warnings
    if extra > 0:
        typer.echo(f"  … {extra} more warnings (use --report)", err=True)


def _outline(course: ir.Course) -> dict:
    def item_info(item) -> dict:
        info = {"kind": type(item).__name__.removesuffix("Item").lower(), "title": item.title,
                "visible": getattr(item, "visible", True)}
        if isinstance(item, ir.Assessment):
            info["questions"] = len(item.questions)
        if isinstance(item, ir.UnsupportedItem):
            info["kind"] = f"unsupported:{item.kind}"
        return info

    return {
        "title": course.title,
        "source": course.source,
        "sections": [{"title": s.title, "visible": s.visible, "items": [item_info(i) for i in s.items]}
                     for s in course.sections],
        "warnings": len(course.warnings),
    }


def main() -> None:  # pragma: no cover - console entry point
    app(prog_name=os.environ.get("LH_LMS_IMPORT_PROG", "learnhouse-lms-import"))


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
