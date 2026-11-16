"""Reference pages the MCP server serves as resources (learnhouse://guide/...):
how to teach well in LearnHouse and the exact build_course spec, so an
assistant can build a strong course without trial and error."""

from __future__ import annotations

import json

COURSE_SPEC_EXAMPLE = {
    "idempotency_key": "photosynthesis-2026-v1",
    "course": {
        "name": "Photosynthesis in 30 minutes",
        "description": "How plants turn light into food, with checks along the way.",
        "objectives": ["Explain what photosynthesis produces", "Name the parts of a leaf involved"],
        "prerequisites": ["Basic cell biology"],
        "tags": ["biology", "plants"],
    },
    "chapters": [
        {
            "key": "intro",
            "name": "Light into sugar",
            "activities": [
                {
                    "key": "why",
                    "name": "Why it matters",
                    "markdown": "## Why it matters\n\nEvery meal starts with a leaf.\n\n> [!TIP]\n> Watch for the word *chloroplast*.",
                    "blocks": [
                        {"type": "embed", "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ"},
                        {"type": "quiz", "questions": [{"text": "What does photosynthesis make?", "options": [
                            {"text": "Sugar and oxygen", "correct": True}, {"text": "Protein", "correct": False}]}]},
                    ],
                },
                {"key": "video", "kind": "youtube", "name": "Watch: inside a leaf", "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ"},
            ],
        },
        {
            "key": "check",
            "name": "Check your understanding",
            "activities": [
                {
                    "key": "exam",
                    "kind": "assignment",
                    "name": "Chapter test",
                    "description": "Answer all questions.",
                    "auto_grading": True,
                    "tasks": [
                        {"type": "quiz", "title": "Leaf parts", "points": 50, "questions": [
                            {"text": "Where is chlorophyll?", "options": [{"text": "Chloroplasts", "correct": True}, {"text": "Roots", "correct": False}]}]},
                        {"type": "short_answer", "title": "Gas", "points": 50, "prompt": "Which gas do plants release?", "accepted_answers": ["oxygen", "O2"]},
                    ],
                }
            ],
        },
    ],
    "settings": {
        "certificate": {"enabled": True, "name": "Photosynthesis basics"},
        "seo": {"title": "Learn photosynthesis", "description": "A short, practical course on photosynthesis."},
    },
}

GUIDES: dict[str, tuple[str, str]] = {
    "pedagogy": (
        "How to build a course that teaches",
        """# Building a course that teaches

**Start from outcomes.** Write 3 to 6 objectives as things a learner can *do* ("explain", "build",
"choose"), then make every chapter serve at least one of them. `score_course` checks the coverage.

**Shape.** 3 to 8 chapters; 2 to 6 activities each; pages of 300 to 1,200 words. One idea per page,
a `##` heading every few paragraphs, short sentences (reading ease 50+), concrete examples first.

**Practice on every page, assessment in every chapter.** Retrieval beats rereading: end each page
with a quick `quiz` or `flashcards`; use `scenario` for decisions, `exercise` for code, and a graded
`assignment` (quiz, short answer, number, code tasks) at the end of a chapter or the course.

**Mix media with purpose.** An `embed` or `video` to show, an `image` with real alt text to explain,
a `callout` for the one thing not to miss, a `toggle` for worked answers and optional depth, a
`conditional` block to give beginners or a group their own path.

**Accessible by default.** Alt text on every image, headings in order (`##` then `###`, never `#`
in a page), header rows in tables, link text that says where it goes.

**Workflow.** Plan the outline with the user, `build_course` with `dry_run: true`, fix what the plan
shows, build for real, run `score_course`, fix the top items, preview a page with `preview_activity`,
and hand over the `editor_url`. Courses stay drafts until the user publishes.
""",
    ),
    "course-spec": (
        "The build_course spec",
        """# The build_course spec

One call builds or updates a whole course. Fields:

- `course`: `name` (required to create), `description`, `about`, `objectives[]`, `prerequisites[]`,
  `tags[]`, `thumbnail_url` (fetched, needs approval).
- `chapters[]`: `key` (your stable id), `name`, `description`, `activities[]`.
- each activity: `key`, `name`, `kind`:
  - `page` (default): `markdown` (fences included) and/or `blocks[]` (typed blocks, see
    learnhouse://blocks; appended after the markdown);
  - `youtube` / `video` / `pdf`: `url`;
  - `assignment`: `description`, `due_date`, `grading_type`, `auto_grading`, `allow_retries`,
    `max_retries`, `show_correct_answers`, `tasks[]` of type quiz, short_answer, number_answer, form,
    file_submission or code.
- `settings`: `certificate` {enabled, name, description, type, pattern, instructor}, `drip`
  {enabled, anchor, start_date, chapters: [{chapter: key or name, mode, delay_days, release_at}]},
  `seo` {title, description, image_alt}, `languages[]` (locale codes), `publish` (needs approval).
- `course_uuid`: update that course (chapters and activities matched by key, then name; nothing is
  deleted, items not in the spec are kept after the ones that are).
- `idempotency_key`: retry safely: the same key and spec resume an interrupted build or replay a
  finished one. A different spec under the same key is refused (use course_uuid to change it).
- `dry_run: true`: validate everything and get the plan as a diff (create, update with a content
  diff, unchanged), nothing written, no approval asked.

The result lists the course, each chapter and activity with its uuid (`ids` maps your keys to
uuids), what failed with the reason, and `resume` instructions when something did. Progress is
reported while it runs when your client sends a progressToken.

Example:

```json
"""
        + json.dumps(COURSE_SPEC_EXAMPLE, indent=2, ensure_ascii=False)
        + "\n```\n",
    ),
    "assessments": (
        "Assessments in LearnHouse",
        """# Assessments

- **Ungraded checks inside pages**: `quiz` (single or select-all), `flashcards`, `scenario`
  (branching), `exercise` (runnable code with tests). Learners retry freely.
- **Graded assignments** (`kind: assignment` in build_course, or create_assignment +
  create_assignment_tasks): tasks of type `quiz` (partial_credit optional), `short_answer`
  (accepted_answers, match_mode), `number_answer` (correct_value, tolerance, unit), `form`
  (fill in the blanks), `file_submission` (graded by hand) and `code` (tests, grading_mode).
  `auto_grading` grades on submit when every task has an answer key; `allow_retries` /
  `max_retries`, `due_date`, `grading_type` (percentage, alphabet, numeric, pass_fail, gpa_scale)
  and `show_correct_answers` set the rules.
- **Completion**: a certificate (`settings.certificate`) is issued when the course is completed.
- Aim for one practice block per page and one graded assignment per chapter or per course.
""",
    ),
    "markdown": (
        "Markdown and fences",
        """# Writing pages in Markdown

Headings (`##`), lists, tables, `> quotes`, `> [!TIP]` callouts (NOTE, TIP, WARNING, CAUTION,
SUCCESS), fenced code, `$$ math $$`, `![alt](https://...)` images (fetched after approval), and
rich blocks as fences: ```quiz, ```flipcards, ```exercise, ```scenario, ```embed, ```button,
```badge, ```preview, ```h5p, ```widget. `describe_activity_blocks` shows each fence's syntax;
typed blocks (learnhouse://blocks) cover everything fences do plus toggles, conditional blocks,
member cards and dividers.
""",
    ),
}
