"""cli: the typer app (sources, inspect, convert, push) with a fake source reader and a mocked HTTP API."""

from __future__ import annotations

import importlib
import json
import os
import zipfile
from types import SimpleNamespace

import httpx
import pytest
from typer.testing import CliRunner

from src.services.courses.lms_import import cli
from src.services.courses.lms_import.ir import (
    Assessment,
    Course,
    HtmlPart,
    Page,
    Question,
    QType,
    RichText,
    Section,
    UnsupportedItem,
    VideoItem,
)

convert_mod = importlib.import_module("src.services.courses.lms_import.convert")
runner = CliRunner()


def sample_course(_root=None) -> Course:
    return Course(title="CLI course", source="x", warnings=["reader warning"], sections=[
        Section(title="Week 1", items=[
            Page(title="Intro", parts=[HtmlPart(RichText("<p>Hi</p>"))]),
            Assessment(title="Quiz", questions=[Question(type=QType.UNSUPPORTED, source_type="hotspot")] * 2),
            UnsupportedItem(title="Forum", kind="forum", reason="no forums"),
            VideoItem(title="Secret", url="https://youtu.be/dQw4w9WgXcQ", visible=False),
        ]),
        Section(title="Hidden week", visible=False, items=[Page(title="Later")]),
    ])


@pytest.fixture
def fake_sources(monkeypatch):
    mod = SimpleNamespace(KEY="fakelms", LABEL="Fake LMS", detect=lambda root: 80, read=sample_course)
    other = SimpleNamespace(KEY="other", LABEL="Other", detect=lambda root: 0, read=sample_course)
    by_key = {"fakelms": mod, "other": other}

    def get_source(key):
        if key not in by_key:
            raise KeyError(key)
        return by_key[key]

    monkeypatch.setattr(convert_mod, "SOURCE_MODULES", ("fakelms", "other"))
    monkeypatch.setattr(convert_mod, "all_sources", lambda: [mod, other])
    monkeypatch.setattr(convert_mod, "get_source", get_source)
    return mod


@pytest.fixture
def export(tmp_path):
    d = tmp_path / "export"
    d.mkdir()
    (d / "course.xml").write_text("<course/>")
    z = tmp_path / "export.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.write(d / "course.xml", "course.xml")
    return SimpleNamespace(dir=str(d), zip=str(z))


# ---------------------------------------------------------------------------
# sources / inspect
# ---------------------------------------------------------------------------


def test_no_args_shows_help():
    result = runner.invoke(cli.app, [])
    assert "convert" in result.output and "push" in result.output


def test_sources(fake_sources):
    result = runner.invoke(cli.app, ["sources"])
    assert result.exit_code == 0
    assert result.output.splitlines() == [f"{'fakelms':18} Fake LMS", f"{'other':18} Other"]


def test_inspect_text(fake_sources, export):
    result = runner.invoke(cli.app, ["inspect", export.zip])
    assert result.exit_code == 0, result.output
    out = result.output
    assert "Detected: Fake LMS (80)" in out
    assert "Course: CLI course" in out
    assert "  ▸ Week 1\n" in out and "  ▸ Hidden week [hidden]" in out
    assert "      - [page] Intro" in out
    assert "      - [assessment] Quiz (2 questions)" in out
    assert "      - [unsupported:forum] Forum" in out
    assert "      - [video] Secret [hidden]" in out
    assert "  ! reader warning" in result.stderr


def test_inspect_json(fake_sources, export):
    result = runner.invoke(cli.app, ["inspect", export.dir, "--json", "--source", "fakelms"])
    assert result.exit_code == 0
    data = json.loads(result.stdout)
    assert data["detected"] == [{"key": "fakelms", "label": "Fake LMS", "score": 80}]
    course = data["course"]
    assert course["title"] == "CLI course" and course["source"] == "fakelms" and course["warnings"] == 1
    assert course["sections"][1] == {"title": "Hidden week", "visible": False,
                                     "items": [{"kind": "page", "title": "Later", "visible": True}]}
    assert course["sections"][0]["items"][1] == {"kind": "assessment", "title": "Quiz", "visible": True,
                                                 "questions": 2}


def test_inspect_nothing_detected(fake_sources, export, monkeypatch):
    fake_sources.detect = lambda root: 0
    result = runner.invoke(cli.app, ["inspect", export.dir])
    assert result.exit_code == 1
    assert "Error: Unrecognized export" in result.stderr


def test_inspect_not_an_archive(fake_sources, tmp_path):
    bad = tmp_path / "notes.txt"
    bad.write_text("hello")
    result = runner.invoke(cli.app, ["inspect", str(bad)])
    assert result.exit_code == 1 and "Error: Unsupported file" in result.stderr


def test_inspect_cleans_up(fake_sources, export, monkeypatch, tmp_path):
    made = []
    real = cli.tempfile.mkdtemp
    monkeypatch.setattr(cli.tempfile, "mkdtemp", lambda **kw: made.append(real(**kw)) or made[-1])
    runner.invoke(cli.app, ["inspect", export.zip])
    assert made and not os.path.exists(made[0])


@pytest.mark.parametrize("args,message", [
    (["--source", "nope"], "unknown source 'nope' (choose from auto, fakelms, other)"),
    (["--quiz-mode", "exam"], "quiz mode must be one of assignment, page"),
])
def test_bad_options(fake_sources, export, tmp_path, args, message):
    result = runner.invoke(cli.app, ["convert", export.dir, "-o", str(tmp_path / "o.zip"), *args])
    assert result.exit_code == 2
    assert message in " ".join(result.output.split())


def test_inspect_bad_source(fake_sources, export):
    result = runner.invoke(cli.app, ["inspect", export.dir, "-s", "nope"])
    assert result.exit_code == 2


# ---------------------------------------------------------------------------
# convert
# ---------------------------------------------------------------------------


def test_convert_zip_with_report(fake_sources, export, tmp_path):
    out = tmp_path / "course.zip"
    report = tmp_path / "report.json"
    result = runner.invoke(cli.app, ["convert", export.zip, "-o", str(out), "--report", str(report)])
    assert result.exit_code == 0, result.output
    assert "Source: fakelms" in result.stdout and "Course: CLI course" in result.stdout
    assert f"Written: {out} (" in result.stdout
    assert "  - skipped [forum] Forum: no forums" in result.stderr
    assert "  ! reader warning" in result.stderr
    data = json.loads(report.read_text())
    assert data["source"] == "fakelms" and data["counts"]["TYPE_DYNAMIC"] == 2 and data["counts"]["TYPE_VIDEO"] == 1
    with zipfile.ZipFile(out) as zf:
        assert "manifest.json" in zf.namelist()


def test_convert_flags(fake_sources, export, tmp_path):
    out = tmp_path / "pkg_dir"
    result = runner.invoke(cli.app, ["convert", export.dir, "-o", str(out), "--skip-hidden", "--unpublished",
                                     "--no-transcode", "--quiz-mode", "page"])
    assert result.exit_code == 0, result.output
    assert f"Written: {out} (" in result.stdout
    acts = []
    for dirpath, _d, files in os.walk(out):
        if "activity.json" in files:
            acts.append(json.load(open(os.path.join(dirpath, "activity.json"))))
    names = sorted(a["name"] for a in acts)
    assert names == ["Intro", "Quiz"]  # hidden items and the hidden section are left out
    assert all(a["published"] is False for a in acts)
    assert {a["activity_type"] for a in acts} == {"TYPE_DYNAMIC"}  # quizzes as pages


def test_convert_refuses_existing_zip(fake_sources, export, tmp_path):
    out = tmp_path / "exists.zip"
    out.write_bytes(b"x")
    result = runner.invoke(cli.app, ["convert", export.dir, "-o", str(out)])
    assert result.exit_code == 1 and f"Error: {out} already exists" in result.stderr


def test_convert_conversion_error(fake_sources, export, tmp_path):
    fake_sources.read = lambda root: (_ for _ in ()).throw(ValueError("bad xml"))
    result = runner.invoke(cli.app, ["convert", export.dir, "-o", str(tmp_path / "o.zip")])
    assert result.exit_code == 1
    assert "Error: Could not read the Fake LMS export: bad xml" in result.stderr


def test_print_problems_truncates():
    report = SimpleNamespace(skipped=[], warnings=[f"w{i}" for i in range(105)], dropped_warnings=7)
    result_lines = []
    orig = cli.typer.echo
    try:
        cli.typer.echo = lambda msg, err=False: result_lines.append(msg)
        cli._print_problems(report)
    finally:
        cli.typer.echo = orig
    assert len(result_lines) == 101
    assert result_lines[-1] == "  … 12 more warnings (use --report)"


# ---------------------------------------------------------------------------
# push
# ---------------------------------------------------------------------------


class Api:
    """Scripted LearnHouse API behind httpx.MockTransport."""

    def __init__(self, statuses, import_result=None, analyze=None, import_status=200):
        self.statuses = list(statuses)
        self.import_result = import_result or {"courses": [{"success": True, "name": "CLI course",
                                                            "new_uuid": "course_new"}], "failed": 0}
        self.analyze = analyze
        self.import_status = import_status
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path.endswith("/import/lms/analyze") and request.method == "POST":
            if self.analyze is not None:
                return self.analyze(request)
            return httpx.Response(200, json=self.statuses.pop(0))
        if "/import/lms/analyze/" in path:
            nxt = self.statuses.pop(0)
            return nxt if isinstance(nxt, httpx.Response) else httpx.Response(200, json=nxt)
        if path.endswith("/import"):
            return httpx.Response(self.import_status, json=self.import_result)
        return httpx.Response(404, json={"detail": "not found"})


READY = {"status": "ready", "temp_id": "tmp1", "source_label": "Fake LMS",
         "courses": [{"course_uuid": "course_a", "name": "CLI course", "activities_count": 3}],
         "report": {"warnings": ["converter warning"]}}


@pytest.fixture
def mock_http(monkeypatch):
    real_client = httpx.Client
    holder = {}
    monkeypatch.setattr(cli.time, "sleep", lambda _s: None)

    def install(api):
        holder["api"] = api

        def factory(**kw):
            holder["kw"] = kw
            return real_client(transport=httpx.MockTransport(api), **kw)

        monkeypatch.setattr(httpx, "Client", factory)
        return holder

    return install


def push_args(export, *extra):
    return ["push", export.zip, "--url", "https://lh.example.com/", "--token", "lh_secret", "--org-id", "7", *extra]


def test_push_processing_then_ready_then_import(fake_sources, export, mock_http):
    api = Api([{"status": "processing", "temp_id": "tmp1"}, {"status": "processing", "temp_id": "tmp1"}, READY])
    holder = mock_http(api)
    result = runner.invoke(cli.app, push_args(export, "--name-prefix", "[Old] ", "--public", "--publish",
                                              "--quiz-mode", "page", "--source", "fakelms"))
    assert result.exit_code == 0, result.output
    assert "Uploading export.zip…" in result.stdout
    assert "Converted Fake LMS export: CLI course (3 activities)" in result.stdout
    assert "Imported: CLI course → course_new" in result.stdout
    assert "  ! converter warning" in result.stderr
    assert holder["kw"]["headers"] == {"Authorization": "Bearer lh_secret"}
    upload, poll1, poll2, imp = api.requests
    assert upload.url.path == "/api/v1/courses/import/lms/analyze"
    assert dict(upload.url.params) == {"org_id": "7", "source": "fakelms", "quiz_mode": "page"}
    assert b'filename="export.zip"' in upload.content
    assert poll1.url.path == "/api/v1/courses/import/lms/analyze/tmp1" and poll1.url.params["org_id"] == "7"
    assert json.loads(imp.content) == {"temp_id": "tmp1", "course_uuids": ["course_a"], "name_prefix": "[Old] ",
                                       "set_private": False, "set_unpublished": False}
    assert imp.url.params["org_id"] == "7"


def test_push_defaults_from_env(fake_sources, export, mock_http, monkeypatch):
    api = Api([READY])
    mock_http(api)
    monkeypatch.setenv("LEARNHOUSE_URL", "https://env.example.com")
    monkeypatch.setenv("LEARNHOUSE_API_TOKEN", "lh_env")
    monkeypatch.setenv("LEARNHOUSE_ORG_ID", "3")
    result = runner.invoke(cli.app, ["push", export.zip])
    assert result.exit_code == 0, result.output
    assert api.requests[0].url.host == "env.example.com"
    body = json.loads(api.requests[-1].content)
    assert body["set_private"] is True and body["set_unpublished"] is True and body["name_prefix"] is None


def test_push_failed_status(fake_sources, export, mock_http):
    mock_http(Api([{"status": "processing", "temp_id": "t"}, {"status": "failed", "error": "Unrecognized export"}]))
    result = runner.invoke(cli.app, push_args(export))
    assert result.exit_code == 1 and "Error: Unrecognized export" in result.stderr
    mock_http(Api([{"status": "failed", "temp_id": "t"}]))
    result = runner.invoke(cli.app, push_args(export))
    assert result.exit_code == 1 and "Error: Conversion failed" in result.stderr


@pytest.mark.parametrize("response,expected", [
    (httpx.Response(403, json={"detail": "Not allowed"}), "Error: HTTP 403: Not allowed"),
    (httpx.Response(413, json=["too", "big"]), "Error: HTTP 413: ['too', 'big']"),
    (httpx.Response(502, text="<html>Bad gateway</html>"), "Error: HTTP 502: <html>Bad gateway</html>"),
])
def test_push_http_errors_on_upload(fake_sources, export, mock_http, response, expected):
    mock_http(Api([], analyze=lambda _r: response))
    result = runner.invoke(cli.app, push_args(export))
    assert result.exit_code == 1 and expected in result.stderr


def test_push_http_error_while_polling(fake_sources, export, mock_http):
    mock_http(Api([{"status": "processing", "temp_id": "t"}, httpx.Response(404, json={"detail": "Unknown temp_id"})]))
    result = runner.invoke(cli.app, push_args(export))
    assert result.exit_code == 1 and "HTTP 404: Unknown temp_id" in result.stderr


def test_push_import_failure(fake_sources, export, mock_http):
    mock_http(Api([READY], import_result={"courses": [{"success": False, "error": "DB down"}], "failed": 1}))
    result = runner.invoke(cli.app, push_args(export))
    assert result.exit_code == 1 and "Failed: DB down" in result.stderr
    mock_http(Api([READY], import_status=500, import_result={"detail": "boom"}))
    result = runner.invoke(cli.app, push_args(export))
    assert result.exit_code == 1 and "HTTP 500: boom" in result.stderr


def test_push_deadline(fake_sources, export, mock_http, monkeypatch):
    mock_http(Api([{"status": "processing", "temp_id": "t"}] * 5))
    clock = iter([0.0, 5.0, 11.0, 20.0])
    monkeypatch.setattr(cli.time, "monotonic", lambda: next(clock))
    result = runner.invoke(cli.app, push_args(export, "--timeout", "10"))
    assert result.exit_code == 1 and "Error: Timed out waiting for the conversion" in result.stderr


def test_push_network_timeout(fake_sources, export, mock_http):
    def slow(request):
        raise httpx.ReadTimeout("timed out", request=request)

    mock_http(Api([], analyze=slow))
    result = runner.invoke(cli.app, push_args(export))
    assert result.exit_code == 1
    assert "Error: Request to https://lh.example.com/ failed: timed out" in result.stderr


def test_push_connection_error(fake_sources, export, mock_http):
    def refused(request):
        raise httpx.ConnectError("connection refused", request=request)

    mock_http(Api([], analyze=refused))
    result = runner.invoke(cli.app, push_args(export))
    assert result.exit_code == 1 and "connection refused" in result.stderr


@pytest.mark.parametrize("response", [
    httpx.Response(200, text="<html>login page</html>"),
    httpx.Response(200, json={"unexpected": True}),
])
def test_push_unexpected_success_body(fake_sources, export, mock_http, response):
    mock_http(Api([], analyze=lambda _r: response))
    result = runner.invoke(cli.app, push_args(export))
    assert result.exit_code == 1 and "Error: Unexpected response from https://lh.example.com/" in result.stderr


def test_push_requires_a_file(fake_sources, export, mock_http):
    mock_http(Api([]))
    result = runner.invoke(cli.app, ["push", export.dir, "--url", "u", "--token", "t", "--org-id", "1"])
    assert result.exit_code == 1 and f"Error: Not a file: {export.dir}" in result.stderr


def test_push_bad_quiz_mode(fake_sources, export):
    result = runner.invoke(cli.app, push_args(export, "--quiz-mode", "x"))
    assert result.exit_code == 2


def test_outline_helper():
    outline = cli._outline(sample_course())
    assert outline["title"] == "CLI course" and outline["warnings"] == 1
    assert [i["kind"] for i in outline["sections"][0]["items"]] == ["page", "assessment", "unsupported:forum",
                                                                     "video"]


def test_converter_imports_without_the_server():
    """The CLI runs where no database or secrets exist: the package must not pull the API in."""
    import subprocess
    import sys

    code = ("import sys, src.services.courses.lms_import.convert, src.services.courses.lms_import.cli; "
            "bad = [m for m in sys.modules if m.startswith(('src.services.courses.transfer', 'src.core', "
            "'src.db', 'config'))]; print(bad); sys.exit(1 if bad else 0)")
    env = {"PATH": os.environ.get("PATH", ""), "PYTHONPATH": os.getcwd(), "PYTHONDONTWRITEBYTECODE": "1"}
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr
