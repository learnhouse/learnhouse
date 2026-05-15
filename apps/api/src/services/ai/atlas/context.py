"""Compose the ``current_context`` block injected into the system prompt.

Each turn the pipeline calls ``build_current_context`` with the user's
page context + attached references + (optionally) a course snapshot,
and produces a YAML-ish block the LLM sees as part of its instructions.
This replaces the old, stateful ``focus_*`` MCP tools — the model now
gets the focus implicitly from the prompt every turn.
"""

from __future__ import annotations

from typing import Iterable, Optional

from src.services.ai.atlas.resolver import PageContextDTO, ReferenceDTO
from src.services.ai.atlas.snapshots import CourseSnapshot


def build_current_context(
    page_context: Optional[PageContextDTO],
    references: Iterable[ReferenceDTO],
    snapshot: Optional[CourseSnapshot],
) -> str:
    """Render a YAML-ish block (no heavy dep) for the prompt.

    Output looks like::

        course: { uuid: course_abc, name: "DNS Fundamentals" }
        chapter: { uuid: chapter_def, name: "Introduction" }
        activity: { uuid: activity_ghi, name: "What is DNS?" }
        references:
          - { type: activity, uuid: activity_jkl, name: "Quiz: …" }

    Empty fields are omitted. If nothing is in scope, returns an empty
    string and ``prompts.build_system_prompt`` skips the block entirely.
    """
    lines: list[str] = []
    pc = page_context

    if pc and pc.course_uuid:
        course_name = ""
        if snapshot is not None and snapshot.course_uuid == pc.course_uuid:
            course_name = snapshot.course_name
        lines.append(_kv_line("course", pc.course_uuid, course_name))

    if pc and (pc.chapter_uuid or pc.chapter_id is not None):
        chap_name = ""
        chap_uuid = pc.chapter_uuid or ""
        if snapshot is not None:
            for ch in snapshot.chapters:
                if pc.chapter_uuid and ch.uuid == pc.chapter_uuid:
                    chap_name = ch.name
                    break
                if pc.chapter_id is not None and ch.id == pc.chapter_id:
                    chap_name = ch.name
                    if not chap_uuid:
                        chap_uuid = ch.uuid
                    break
        lines.append(_kv_line("chapter", chap_uuid, chap_name))

    if pc and pc.activity_uuid:
        act_name = ""
        if snapshot is not None:
            for ch in snapshot.chapters:
                for a in ch.activities:
                    if a.uuid == pc.activity_uuid:
                        act_name = a.name
                        break
        lines.append(_kv_line("activity", pc.activity_uuid, act_name))

    ref_list = list(references) if references else []
    if ref_list:
        lines.append("references:")
        for r in ref_list[:5]:  # AtlasMiniContext caps chips at 5; mirror here
            lines.append(
                f"  - {{ type: {r.kind}, uuid: {r.uuid}, name: {_qstr(r.name)} }}"
            )

    return "\n".join(lines)


def _kv_line(label: str, uuid: str, name: str) -> str:
    if name:
        return f"{label}: {{ uuid: {uuid}, name: {_qstr(name)} }}"
    return f"{label}: {{ uuid: {uuid} }}"


def _qstr(s: str) -> str:
    """Lightly quote a name for the YAML-ish block. Escapes quotes only."""
    if s is None:
        return '""'
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'
