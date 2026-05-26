"""System prompt + per-turn focus block.

Focus is stateless: the frontend sends `page_context` on every turn (what
course/chapter/activity the user is currently viewing or has chipped),
and the API hydrates a course snapshot. There is NO `focus_*` tool — the
LLM never sets focus; it only reads CURRENT FOCUS from this prompt.
"""

from typing import Any

BASE_SYSTEM_PROMPT = """\
You are Atlas, LearnHouse's course-building assistant. You take action on
the user's behalf via tools.

# ACTION-FIRST RULE

Default to ACTION, not questions. If CURRENT FOCUS resolves the user's
reference, just act. Only ask when ALL of these are true:
  1. The user's request requires a target you cannot identify, AND
  2. CURRENT FOCUS is empty for that target type, AND
  3. There is no plausible single match in the course tree.

Phrases like "this", "it", "the focused one", "this course/chapter/activity",
"the current one", "here" → resolve them to whatever is in CURRENT FOCUS.
Never ask which course/chapter/activity if CURRENT FOCUS has one.

# FOCUS IS DATA, NOT AN ACTION

Focus comes from CURRENT FOCUS below — set by the user's UI navigation
and chip selections. You DO NOT set focus. NEVER reply with
"I've set your focus to X" or "I'm focused on X" — that's a lie because
you don't have a focus tool. Just act on the focused target silently.

# WHAT YOU CAN DO

Course / chapter / activity CRUD via these tools:
  reads        list_courses, get_course, get_chapter, get_activity, search_org
  writes       propose_create_course, propose_update_course,
               propose_create_chapter, propose_update_chapter,
               propose_create_activity, propose_update_activity
  destructive  propose_delete_course, propose_delete_chapter, propose_delete_activity
  macro        propose_course_structure (whole-tree create under an existing course)

Activity kinds you can create: dynamic (markdown lesson) and video (YouTube URL).
If the user asks for quiz/assignment/pdf/scorm, say you can't create those yet
and offer to open the activity editor.

# BULK / INFERENCE PATTERNS

- "Fill this course" / "create lesson content" / "write the lessons":
  walk the focused course's draft activities, propose update_activity for
  each dynamic activity with body_markdown matching its name/topic.
  Skip non-dynamic activities. Surface one preview per activity.
- "Fill this chapter": same, scoped to the focused chapter's activities.
- "Fill this activity": propose_update_activity with body_markdown
  matching the activity's name (and any context from its parent chapter).
- "Publish everything": call propose_update_* for every draft, setting
  published=true.
- "Add chapters about X": one propose_create_chapter per chapter.

When you propose changes in bulk, BRIEFLY say what you're proposing then
emit the tool calls. The frontend renders each preview card individually.

# APPROVAL MODEL

`propose_*` tools NEVER mutate — they return a preview the user must click
to apply. Describe each proposal in one short line. Never say "done" or
"created" unless the system emitted an `applied` event.

Destructive proposals require typing a confirmation phrase. Mention this
in your reply when proposing a delete.

# STYLE

- Be brief. Echo the user's language. No throat-clearing.
- Never invent UUIDs. Use CURRENT FOCUS data or call a read tool first.
- Markdown for activity content: write directly in the tool's body_markdown
  argument; the server converts to Tiptap before previewing.
"""


def render_focus_block(
    *,
    page_context: dict[str, Any] | None,
    course_snapshot: dict[str, Any] | None,
    references: list[dict[str, Any]] | None = None,
    inline_activity_limit: int = 200,
) -> str:
    """Build the CURRENT FOCUS block appended to the system prompt per turn."""
    lines: list[str] = ["CURRENT FOCUS"]

    pc = page_context or {}
    course_uuid = pc.get("course_uuid")
    course_name = pc.get("course_name")
    chapter_id = pc.get("chapter_id")
    chapter_name = pc.get("chapter_name")
    activity_uuid = pc.get("activity_uuid")
    activity_name = pc.get("activity_name")

    has_anything = bool(course_uuid or chapter_id or activity_uuid or references)
    if not has_anything and not course_snapshot:
        lines.append("  (none — no specific course/chapter/activity open)")
        lines.append(
            "  HINT: if the user references 'this/it/the focused one' "
            "you must ask which one."
        )
        return "\n".join(lines)

    # Course header — prefer snapshot data (real counts) over page_context name.
    if course_snapshot:
        chapters = course_snapshot.get("chapters") or []
        total_activities = sum(c.get("activity_count", 0) for c in chapters)
        published = course_snapshot.get("published")
        published_str = "published" if published else "unpublished"
        name = course_snapshot.get("name") or course_name or "?"
        lines.append(
            f"  course:   \"{name}\" "
            f"({course_uuid or '?'}) — {len(chapters)} chapters, "
            f"{total_activities} activities, {published_str}"
        )

        if total_activities <= inline_activity_limit:
            for ch in chapters:
                ch_id = ch.get("chapter_id", "?")
                ch_name = ch.get("name", "?")
                is_focused_chapter = chapter_id is not None and ch_id == chapter_id
                marker = "  ← focused" if is_focused_chapter else ""
                lines.append(
                    f"    - chapter \"{ch_name}\" (id={ch_id}){marker}"
                )
                for a in ch.get("activities") or []:
                    a_uuid = a.get("activity_uuid", "?")
                    a_name = a.get("name", "?")
                    a_sub = a.get("activity_sub_type", "?")
                    is_focused_activity = a_uuid == activity_uuid
                    a_marker = "  ← focused" if is_focused_activity else ""
                    lines.append(
                        f"        · activity \"{a_name}\" "
                        f"({a_uuid}, {a_sub}){a_marker}"
                    )
        else:
            for ch in chapters:
                ch_id = ch.get("chapter_id", "?")
                is_focused_chapter = chapter_id is not None and ch_id == chapter_id
                marker = "  ← focused" if is_focused_chapter else ""
                lines.append(
                    f"    - chapter \"{ch.get('name','?')}\" "
                    f"(id={ch_id}, {ch.get('activity_count', 0)} activities){marker}"
                )
            lines.append(
                f"  (activity list elided — total {total_activities} > "
                f"{inline_activity_limit}; call get_chapter to drill in)"
            )
    elif course_uuid:
        lines.append(f"  course:   \"{course_name or '?'}\" ({course_uuid})")

    # Even without a full snapshot, surface the chip-level focus targets.
    if not course_snapshot:
        if chapter_id is not None:
            lines.append(
                f"  chapter:  \"{chapter_name or '?'}\" (id={chapter_id})"
            )
        if activity_uuid:
            lines.append(
                f"  activity: \"{activity_name or '?'}\" ({activity_uuid})"
            )

    if references:
        lines.append("USER REFERENCES (chips the user attached to this message):")
        for ref in references:
            kind = ref.get("type", "?")
            name = ref.get("name", "?")
            uuid = ref.get("uuid", "?")
            lines.append(f"  - {kind} \"{name}\" ({uuid})")

    # Inference reminders so the LLM doesn't ask redundant questions.
    target_summary = []
    if activity_uuid:
        target_summary.append(f'"this/it/the activity" = activity {activity_uuid}')
    if chapter_id is not None:
        target_summary.append(f'"this/it/the chapter" = chapter id={chapter_id}')
    if course_uuid:
        target_summary.append(f'"this/it/the course" = course {course_uuid}')
    if target_summary:
        lines.append("RESOLVE PRONOUNS USING:")
        for s in target_summary:
            lines.append(f"  - {s}")

    return "\n".join(lines)
