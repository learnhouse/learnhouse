"""Render every registered email template with its sample data.

Dev tool for reviewing the email design: writes one ``.html`` and one
``.txt`` per sample plus an ``index.html`` gallery. Nothing is sent.

    uv run python -m src.services.email.preview --out /tmp/email-gallery
    uv run python -m src.services.email.preview --out /tmp/g --lang fr --lang ar
"""

from __future__ import annotations

import argparse
import html
import re
from pathlib import Path
from typing import Iterable, Optional

from src.services.email.branding import OrgEmailBranding
from src.services.email.pipeline import render_email
from src.services.email.registry import EmailTemplate, Sample, all_templates
from src.services.email.theme import category


def sample_org(sample: Sample) -> Optional[OrgEmailBranding]:
    return OrgEmailBranding(**sample.org) if sample.org else None


def slug(template: EmailTemplate, index: int, lang: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", template.name.lower()).strip("-")
    return f"{base}-{index + 1}-{lang}"


def render_samples(langs: Iterable[str] = ("en",)) -> list[dict]:
    """Every (template, sample, language) rendered; nothing written."""
    out = []
    for tpl in all_templates():
        for i, sample in enumerate(tpl.samples):
            for lang in langs:
                rendered = render_email(tpl.name, sample.values, org=sample_org(sample), lang=lang)
                out.append({"template": tpl, "sample": sample, "lang": lang, "slug": slug(tpl, i, lang),
                            "rendered": rendered})
    return out


def _index(entries: list[dict]) -> str:
    cards = []
    for e in entries:
        tpl, rendered = e["template"], e["rendered"]
        cat = category(rendered.category)
        label = " · ".join(p for p in (e["sample"].label, e["lang"]) if p)
        cards.append(
            f'<a class="card" href="{e["slug"]}.html">'
            f'<span class="chip">{html.escape(cat.label)}</span>'
            f'<strong>{html.escape(tpl.name)}</strong>'
            f'<span class="subject">{html.escape(rendered.subject)}</span>'
            f'<span class="meta">{html.escape(label)}{" · critical" if tpl.critical else ""}</span>'
            f'<iframe loading="lazy" src="{e["slug"]}.html" title="{html.escape(tpl.name)}" tabindex="-1"></iframe>'
            "</a>"
        )
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Email gallery</title>
<style>
  body {{ margin: 0; padding: 32px 16px; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #f8f8f8; color: #171717; }}
  h1 {{ margin: 0 0 4px; font-size: 22px; }} p.lead {{ margin: 0 0 24px; color: #64748b; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }}
  .card {{ display: flex; flex-direction: column; gap: 6px; padding: 14px; border-radius: 14px; background: #fff;
          border: 1px solid #e2e8f0; text-decoration: none; color: inherit; }}
  .card:hover {{ border-color: #a3a3a3; }}
  .chip {{ align-self: flex-start; padding: 2px 8px; border-radius: 999px; background: #f5f5f5; color: #404040;
          font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }}
  .subject {{ font-size: 13px; color: #334155; }} .meta {{ font-size: 12px; color: #94a3b8; }}
  iframe {{ width: 100%; height: 360px; border: 0; border-radius: 10px; pointer-events: none; background: #fff; }}
</style></head>
<body><h1>Email gallery</h1><p class="lead">{len(entries)} renders of {len({e["template"].name for e in entries})} templates. Nothing here is sent.</p>
<div class="grid">{"".join(cards)}</div></body></html>"""


def write_gallery(out_dir: str | Path, langs: Iterable[str] = ("en",)) -> Path:
    """Write every render plus ``index.html`` into ``out_dir``; returns the index."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    entries = render_samples(langs)
    for e in entries:
        (out / f"{e['slug']}.html").write_text(e["rendered"].html, encoding="utf-8")
        (out / f"{e['slug']}.txt").write_text(f"Subject: {e['rendered'].subject}\n\n{e['rendered'].text}", encoding="utf-8")
    index = out / "index.html"
    index.write_text(_index(entries), encoding="utf-8")
    return index


def main(argv: Optional[list[str]] = None) -> Path:
    parser = argparse.ArgumentParser(description="Render every email template to HTML files.")
    parser.add_argument("--out", required=True, help="Directory to write the gallery into")
    parser.add_argument("--lang", action="append", help="Language(s) to render (default: en)")
    args = parser.parse_args(argv)
    index = write_gallery(args.out, args.lang or ["en"])
    print(index)
    return index


if __name__ == "__main__":  # pragma: no cover
    main()
