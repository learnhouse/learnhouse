"""
Synthetic SCORM package corpus.

A reproducible generator for SCORM 1.2 and SCORM 2004 packages — both valid
and adversarial — used by the backend SCORM test suite and by the e2e fixture
dump script (`python -m src.tests.fixtures.scorm_packages <out_dir>`).

Everything here is built in-memory; nothing depends on external authoring tools.
The manifest builders are also exposed on their own so pure-function parser tests
can avoid the zip round-trip.
"""

from __future__ import annotations

import io
import os
import sys
import zipfile

# ---------------------------------------------------------------------------
# A tiny SCO page that actually drives the SCORM JS API so the player and the
# runtime can be exercised headlessly (it walks window.parent/top to find the API).
# ---------------------------------------------------------------------------

_SCO_HTML_12 = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title></head>
<body>
<div id="sco">{title}</div>
<script>
  function findAPI(win) {{
    var tries = 0;
    while (win && !win.API && tries < 10) {{ win = win.parent; tries++; }}
    return win ? win.API : null;
  }}
  var api = findAPI(window) || (window.top && window.top.API);
  if (api) {{
    api.LMSInitialize("");
    api.LMSSetValue("cmi.core.lesson_status", "incomplete");
    api.LMSSetValue("cmi.core.score.raw", "{score}");
    api.LMSSetValue("cmi.suspend_data", "{suspend}");
    api.LMSSetValue("cmi.core.session_time", "00:00:30");
    api.LMSCommit("");
  }}
  window.lhComplete = function () {{
    if (!api) return;
    api.LMSSetValue("cmi.core.lesson_status", "completed");
    api.LMSSetValue("cmi.core.score.raw", "{score}");
    api.LMSCommit("");
    api.LMSFinish("");
  }};
</script>
</body></html>
"""

_SCO_HTML_2004 = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title></head>
<body>
<div id="sco">{title}</div>
<script>
  function findAPI(win) {{
    var tries = 0;
    while (win && !win.API_1484_11 && tries < 10) {{ win = win.parent; tries++; }}
    return win ? win.API_1484_11 : null;
  }}
  var api = findAPI(window) || (window.top && window.top.API_1484_11);
  if (api) {{
    api.Initialize("");
    api.SetValue("cmi.completion_status", "incomplete");
    api.SetValue("cmi.score.scaled", "{scaled}");
    api.SetValue("cmi.suspend_data", "{suspend}");
    api.SetValue("cmi.session_time", "PT30S");
    api.Commit("");
  }}
  window.lhComplete = function () {{
    if (!api) return;
    api.SetValue("cmi.completion_status", "completed");
    api.SetValue("cmi.success_status", "passed");
    api.SetValue("cmi.score.scaled", "{scaled}");
    api.Commit("");
    api.Terminate("");
  }};
</script>
</body></html>
"""


def sco_html(version: str, title: str = "SCO", score: str = "90",
             scaled: str = "0.9", suspend: str = "lesson1") -> str:
    if version == "SCORM_2004":
        return _SCO_HTML_2004.format(title=title, scaled=scaled, suspend=suspend)
    return _SCO_HTML_12.format(title=title, score=score, suspend=suspend)


# ---------------------------------------------------------------------------
# Manifest builders (also used directly by pure-function parser tests)
# ---------------------------------------------------------------------------

def manifest_12_single(title: str = "Single SCO 1.2", href: str = "index.html") -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-1" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>{title}</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>{title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="{href}">
      <file href="{href}"/>
    </resource>
  </resources>
</manifest>
"""


def manifest_12_multi(titles=("Lesson A", "Lesson B", "Lesson C")) -> str:
    items, resources = [], []
    for i, t in enumerate(titles, start=1):
        href = f"lesson{i}/index.html"
        items.append(
            f'<item identifier="ITEM-{i}" identifierref="RES-{i}"><title>{t}</title></item>'
        )
        resources.append(
            f'<resource identifier="RES-{i}" type="webcontent" '
            f'adlcp:scormtype="sco" href="{href}"><file href="{href}"/></resource>'
        )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-M" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Multi SCO 1.2</title>
      {''.join(items)}
    </organization>
  </organizations>
  <resources>
    {''.join(resources)}
  </resources>
</manifest>
"""


def manifest_2004_single(title: str = "Single SCO 2004", href: str = "index.html") -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-2004" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>{title}</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>{title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormType="sco" href="{href}">
      <file href="{href}"/>
    </resource>
  </resources>
</manifest>
"""


def manifest_2004_multi(titles=("Module 1", "Module 2")) -> str:
    items, resources = [], []
    for i, t in enumerate(titles, start=1):
        href = f"mod{i}/start.html"
        items.append(
            f'<item identifier="ITEM-{i}" identifierref="RES-{i}"><title>{t}</title></item>'
        )
        resources.append(
            f'<resource identifier="RES-{i}" type="webcontent" '
            f'adlcp:scormType="sco" href="{href}"><file href="{href}"/></resource>'
        )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-2004M" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 3rd Edition</schemaversion></metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Multi SCO 2004</title>
      {''.join(items)}
    </organization>
  </organizations>
  <resources>{''.join(resources)}</resources>
</manifest>
"""


def manifest_nested_items() -> str:
    """A SCORM 1.2 manifest with a chapter <item> wrapping leaf SCO items."""
    return """<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-NEST" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Nested</title>
      <item identifier="CHAP-1">
        <title>Chapter One</title>
        <item identifier="ITEM-1" identifierref="RES-1"><title>Leaf One</title></item>
        <item identifier="ITEM-2" identifierref="RES-2"><title>Leaf Two</title></item>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="a.html"><file href="a.html"/></resource>
    <resource identifier="RES-2" type="webcontent" adlcp:scormtype="sco" href="b.html"><file href="b.html"/></resource>
  </resources>
</manifest>
"""


def manifest_no_type_resource(href: str = "start.html") -> str:
    """SCORM 1.2 package whose resource omits type= and adlcp:scormtype."""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-NT" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>No Type</title>
      <item identifier="ITEM-1" identifierref="RES-1"><title>Only SCO</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" href="{href}"><file href="{href}"/></resource>
  </resources>
</manifest>
"""


def manifest_unicode() -> str:
    return manifest_12_single(title="Introducción · 日本語 · Café ☕")


def manifest_query_string_href() -> str:
    """Launch path carrying a query string + fragment, as Storyline/Rise emit."""
    return manifest_12_single(title="Query Launch", href="story.html?v=2&lang=en#start")


def manifest_nested_file_entry(href: str = "launch/index.html") -> str:
    """A resource that declares its entry point as the first <file> (no href attr),
    as some authoring-tool exports do."""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-NF" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1"><title>Nested File</title>
      <item identifier="ITEM-1" identifierref="RES-1"><title>Nested File SCO</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco">
      <file href="{href}"/>
    </resource>
  </resources>
</manifest>
"""


def manifest_xxe() -> bytes:
    """Manifest with an XXE external-entity payload; defusedxml must reject/neutralize."""
    return (
        b'<?xml version="1.0"?>\n'
        b'<!DOCTYPE manifest [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n'
        b'<manifest identifier="X" version="1.0" '
        b'xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">'
        b'<organizations default="O"><organization identifier="O">'
        b'<title>&xxe;</title>'
        b'<item identifier="I" identifierref="R"><title>x</title></item>'
        b'</organization></organizations>'
        b'<resources><resource identifier="R" type="webcontent" href="index.html">'
        b'<file href="index.html"/></resource></resources></manifest>'
    )


# ---------------------------------------------------------------------------
# Zip builders
# ---------------------------------------------------------------------------

def make_zip(files: dict[str, bytes | str]) -> bytes:
    """Build a zip from an arcname -> content mapping."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            if isinstance(content, str):
                content = content.encode("utf-8")
            zf.writestr(name, content)
    return buf.getvalue()


def zip_with_symlink(target: str = "/etc/passwd") -> bytes:
    """A zip containing a symlink entry pointing outside the tree."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("imsmanifest.xml", manifest_12_single())
        zf.writestr("index.html", sco_html("SCORM_12"))
        info = zipfile.ZipInfo("evil_link")
        # Mark as symlink: file type bits 0xA000 in the high 16 of external_attr.
        info.external_attr = (0xA1FF & 0xFFFF) << 16
        info.create_system = 3  # unix
        zf.writestr(info, target)
    return buf.getvalue()


# Valid packages -------------------------------------------------------------

def valid_12_single() -> bytes:
    return make_zip({
        "imsmanifest.xml": manifest_12_single(),
        "index.html": sco_html("SCORM_12", title="Single SCO 1.2"),
    })


def valid_12_multi() -> bytes:
    files = {"imsmanifest.xml": manifest_12_multi()}
    for i, t in enumerate(("Lesson A", "Lesson B", "Lesson C"), start=1):
        files[f"lesson{i}/index.html"] = sco_html("SCORM_12", title=t)
    return make_zip(files)


def valid_2004_single() -> bytes:
    return make_zip({
        "imsmanifest.xml": manifest_2004_single(),
        "index.html": sco_html("SCORM_2004", title="Single SCO 2004"),
    })


def valid_2004_multi() -> bytes:
    files = {"imsmanifest.xml": manifest_2004_multi()}
    for i, t in enumerate(("Module 1", "Module 2"), start=1):
        files[f"mod{i}/start.html"] = sco_html("SCORM_2004", title=t)
    return make_zip(files)


def valid_unicode() -> bytes:
    return make_zip({
        "imsmanifest.xml": manifest_unicode(),
        "index.html": sco_html("SCORM_12", title="Unicode"),
    })


def valid_query_string() -> bytes:
    return make_zip({
        "imsmanifest.xml": manifest_query_string_href(),
        "story.html": sco_html("SCORM_12", title="Query Launch"),
    })


def valid_no_type_resource() -> bytes:
    return make_zip({
        "imsmanifest.xml": manifest_no_type_resource(),
        "start.html": sco_html("SCORM_12", title="No Type"),
    })


def valid_nested() -> bytes:
    return make_zip({
        "imsmanifest.xml": manifest_nested_items(),
        "a.html": sco_html("SCORM_12", title="Leaf One"),
        "b.html": sco_html("SCORM_12", title="Leaf Two"),
    })


def valid_rise_style() -> bytes:
    """Articulate Rise-style: single SCO with a "./scormcontent/index.html" href."""
    return make_zip({
        "imsmanifest.xml": manifest_12_single(href="./scormcontent/index.html"),
        "scormcontent/index.html": sco_html("SCORM_12", title="Rise Course"),
    })


def valid_nested_file() -> bytes:
    """Resource whose entry point is its first <file>, not an href attribute."""
    return make_zip({
        "imsmanifest.xml": manifest_nested_file_entry(),
        "launch/index.html": sco_html("SCORM_12", title="Nested File SCO"),
    })


# Adversarial packages -------------------------------------------------------

def adv_missing_manifest() -> bytes:
    return make_zip({"index.html": "<html></html>"})


def adv_malformed_manifest() -> bytes:
    return make_zip({
        "imsmanifest.xml": "<manifest><organizations><not-closed>",
        "index.html": "<html></html>",
    })


def adv_xxe() -> bytes:
    return make_zip({
        "imsmanifest.xml": manifest_xxe(),
        "index.html": "<html></html>",
    })


def adv_no_scos() -> bytes:
    manifest = """<?xml version="1.0"?>
<manifest identifier="M" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <organizations default="O"><organization identifier="O"><title>Empty</title></organization></organizations>
  <resources></resources>
</manifest>"""
    return make_zip({"imsmanifest.xml": manifest})


def adv_path_traversal() -> bytes:
    return make_zip({
        "imsmanifest.xml": manifest_12_single(),
        "index.html": sco_html("SCORM_12"),
        "../../../../tmp/lh_scorm_pwned.txt": "owned",
    })


def adv_empty_zip() -> bytes:
    return make_zip({})


def adv_not_a_zip() -> bytes:
    return b"this is definitely not a zip file" + b"\x00" * 16


def adv_oversized_suspend_marker() -> str:
    """Returns a >64KB suspend_data string for runtime tests."""
    return "S" * (70 * 1024)


# ---------------------------------------------------------------------------
# Registry + dump entrypoint
# ---------------------------------------------------------------------------

VALID_PACKAGES = {
    "valid_12_single": valid_12_single,
    "valid_12_multi": valid_12_multi,
    "valid_2004_single": valid_2004_single,
    "valid_2004_multi": valid_2004_multi,
    "valid_unicode": valid_unicode,
    "valid_query_string": valid_query_string,
    "valid_no_type_resource": valid_no_type_resource,
    "valid_nested": valid_nested,
    "valid_rise_style": valid_rise_style,
    "valid_nested_file": valid_nested_file,
}

ADVERSARIAL_PACKAGES = {
    "adv_missing_manifest": adv_missing_manifest,
    "adv_malformed_manifest": adv_malformed_manifest,
    "adv_xxe": adv_xxe,
    "adv_no_scos": adv_no_scos,
    "adv_path_traversal": adv_path_traversal,
    "adv_empty_zip": adv_empty_zip,
    "adv_symlink": zip_with_symlink,
}


def dump_all(out_dir: str) -> list[str]:
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for name, fn in {**VALID_PACKAGES, **ADVERSARIAL_PACKAGES}.items():
        path = os.path.join(out_dir, f"{name}.zip")
        with open(path, "wb") as f:
            f.write(fn())
        written.append(path)
    # not-a-zip needs a .zip extension to test extension-vs-content mismatch
    bad = os.path.join(out_dir, "adv_not_a_zip.zip")
    with open(bad, "wb") as f:
        f.write(adv_not_a_zip())
    written.append(bad)
    return written


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "scorm_fixtures"
    for p in dump_all(out):
        print(p)
