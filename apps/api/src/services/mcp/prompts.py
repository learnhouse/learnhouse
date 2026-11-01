"""Prompts the MCP server offers: ready-made starting points for the jobs
people most often hand an agent in LearnHouse. Each one only frames the work;
the model still uses the tools, so every change goes through the same checks.
"""

from __future__ import annotations

from dataclasses import dataclass

import mcp_types as types


@dataclass(frozen=True)
class PromptArg:
    name: str
    description: str
    required: bool = False


@dataclass(frozen=True)
class PromptDef:
    name: str
    title: str
    description: str
    args: tuple[PromptArg, ...]
    template: str
    # Role right the job needs, as (rights bucket, action); the prompt is only
    # offered to members who have it, on connections that can write if it does.
    needs: tuple[str, str] = ("courses", "read")
    writes: bool = False


PROMPTS: dict[str, PromptDef] = {
    p.name: p
    for p in (
        PromptDef(
            name="draft_course",
            title="Draft a course",
            description="Plan a course with the user, then build it: chapters, pages and a quiz per chapter.",
            needs=("courses", "create"),
            writes=True,
            args=(
                PromptArg("topic", "What the course teaches", required=True),
                PromptArg("audience", "Who it is for, and their level"),
                PromptArg("length", "Rough size, e.g. '4 chapters' or 'a 1 hour course'"),
            ),
            template=(
                "Create a LearnHouse course about: {topic}.\n"
                "Audience: {audience}.\nSize: {length}.\n\n"
                "First call get_context. Then propose an outline (course name, short "
                "description, chapters, and the pages in each) and wait for my approval. "
                "Once I approve, build it with one create_course call, writing each page's "
                "content in Markdown, and end each chapter with a short quiz written as a "
                "```quiz fence (Q: lines with - [x] / - [ ] options) on its last page. Keep "
                "it as a draft and finish with the editor link, so I can review and publish it."
            ),
        ),
        PromptDef(
            name="improve_activity",
            title="Improve a page",
            description="Read one activity and improve it in place with small, targeted edits.",
            needs=("activities", "update"),
            writes=True,
            args=(
                PromptArg("activity", "Activity name or activity_ uuid", required=True),
                PromptArg("goal", "What to improve: clarity, examples, a quiz, translation..."),
            ),
            template=(
                "Improve the LearnHouse activity '{activity}'. Goal: {goal}.\n\n"
                "Find it with search, then read it with get_activity_content. Suggest the "
                "changes as a short list and wait for my go-ahead. Then apply them in one "
                "edit_activity_content call (small, precise edits, not a rewrite of the "
                "whole page), and tell me what changed and how to undo it."
            ),
        ),
        PromptDef(
            name="review_course",
            title="Review a course",
            description="Audit a course's structure and content and report what to fix, without changing anything.",
            needs=("courses", "update"),
            args=(PromptArg("course", "Course name or course_ uuid", required=True),),
            template=(
                "Review the LearnHouse course '{course}'. Find it with search, run "
                "audit_course for its rule-based issues when you have that tool, read its "
                "outline with get_course and a sample of its pages with get_activity_content "
                "(format markdown). Report: gaps in the "
                "outline, pages that are empty or very thin, missing assessments, unclear "
                "titles, unpublished items, and broken ordering. Do not change anything; end "
                "with a prioritized list of fixes I can approve."
            ),
        ),
        PromptDef(
            name="learner_report",
            title="Learner report",
            description="Summarize how learners are doing in the organization or in one course.",
            needs=("courses", "update"),
            args=(PromptArg("course", "Optional course name or course_ uuid"),),
            template=(
                "Give me a short report on learner activity{course_clause}. Use "
                "list_course_learners for who is behind, get_course_stats for completion "
                "per activity and assignment results, run_analytics when analytics are "
                "on (check get_context.features), and list_submissions for assignments. "
                "Highlight trends, drop-off points and the learners who need my attention. "
                "If analytics are off for this organization, say so and report what the "
                "other tools can tell."
            ),
        ),
    )
}


def prompt_allowed(prompt: PromptDef, can_write: bool, role_rights) -> bool:
    """role_rights None means everything (admins, maintainers, API tokens)."""
    if prompt.writes and not can_write:
        return False
    if role_rights is None:
        return True
    from src.security.rbac import AccessAction
    from src.services.mcp.server import _role_allows

    bucket, action = prompt.needs
    return _role_allows(role_rights, bucket, AccessAction(action))


def prompt_listing(allowed=lambda p: True) -> list[types.Prompt]:
    return [
        types.Prompt(
            name=p.name,
            title=p.title,
            description=p.description,
            arguments=[
                types.PromptArgument(name=a.name, description=a.description, required=a.required)
                for a in p.args
            ],
        )
        for p in PROMPTS.values()
        if allowed(p)
    ]


def render_prompt(name: str, arguments: dict[str, str] | None) -> types.GetPromptResult | None:
    prompt = PROMPTS.get(name)
    if prompt is None:
        return None
    arguments = {k: str(v).strip() for k, v in (arguments or {}).items() if v}
    missing = [a.name for a in prompt.args if a.required and not arguments.get(a.name)]
    if missing:
        raise ValueError(f"Missing required argument(s): {', '.join(missing)}")
    values = {a.name: arguments.get(a.name) or "not specified" for a in prompt.args}
    course = arguments.get("course")
    values["course_clause"] = f" in the course '{course}'" if course else " across the organization"
    text = prompt.template.format(**values)
    return types.GetPromptResult(
        description=prompt.description,
        messages=[
            types.PromptMessage(role="user", content=types.TextContent(type="text", text=text))
        ],
    )
