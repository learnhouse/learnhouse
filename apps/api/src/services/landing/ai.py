"""AI for the page builder: a whole page from a brief, and copy rewrites.

The model never writes the page tree. It returns section specs (kind,
heading, items...) and a style preset; the same recipes Atlas and the
templates use turn them into nodes, and ``validate_doc`` checks the result.
So a confused model can produce a dull page, never a broken one.

Callers meter these through ``metering.charge`` ("landing_generation",
"landing_copy"); see src/routers/landing.py.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

from src.services.ai.llm import generate, model_for_tier
from src.services.landing import recipes
from src.services.landing.recipes import SectionSpec

PresetName = Literal["brand", "minimal", "warm", "bold", "elegant", "playful", "dark", "fresh"]

_PAGE_PROMPT = """You design landing pages for online academies (course creators,
schools and companies that train people). Given a brief and facts about the
organization, return the page as an ordered list of sections and one style
preset.

Rules:
- 5 to 9 sections. Start with a hero. End with a call to action, newsletter or contact section.
- Use "courses", "featured_course", "paths", "communities", "podcasts" or "live_sessions" to show the
  organization's real content: never invent course names or prices for those.
- Write specific, concrete copy for this organization: no lorem ipsum, no placeholders like [Name].
- Headings under 70 characters; subheadings one or two sentences.
- Testimonials and stats only when the brief gives them; otherwise skip those kinds.
- Links: internal paths (/courses, /signup, /store) or anchors (#pricing, #faq, #contact).
- Write in the language of the brief.
- Return only the structured fields."""

_COPY_PROMPT = """You are a conversion copywriter for online learning. Rewrite the
given text for a landing page as asked. Keep it about the same length unless
asked otherwise, keep facts, no emoji, no quotes around the result, same
language as the text unless told to translate. Return only the new text."""


class PagePlan(BaseModel):
    preset: PresetName = "brand"
    sections: list[SectionSpec] = Field(..., min_length=1, max_length=12)


class CopyRewrite(BaseModel):
    text: str = Field(..., max_length=5000)


def page_prompt(brief: str, ctx: dict, courses: list[dict]) -> str:
    lines = [
        f"Brief: {brief.strip()[:3000]}",
        f"Organization: {ctx.get('org_name', '')}",
    ]
    if ctx.get("org_description"):
        lines.append(f"About: {ctx['org_description']}")
    if courses:
        lines.append("Public courses: " + "; ".join(f"{c['name']} ({c['uuid']})" for c in courses[:12]))
    return "\n".join(lines)


async def plan_page(*, brief: str, ctx: dict, courses: list[dict], model_name: Optional[str]) -> PagePlan:
    plan: PagePlan = await generate(
        model_name=model_name or model_for_tier("standard"),
        user_prompt=page_prompt(brief, ctx, courses),
        system_prompt=_PAGE_PROMPT,
        output_type=PagePlan,
    )
    return plan


def plan_to_doc(plan: PagePlan, ctx: dict) -> dict:
    return recipes.build_page(plan.sections, ctx=ctx, preset=plan.preset)


async def rewrite_copy(*, text: str, instruction: str, context: str, model_name: Optional[str]) -> str:
    prompt = f"Instruction: {instruction.strip()[:500]}\nPage context: {context.strip()[:500]}\nText:\n{text.strip()[:4000]}"
    out: CopyRewrite = await generate(
        model_name=model_name or model_for_tier("standard"),
        user_prompt=prompt,
        system_prompt=_COPY_PROMPT,
        output_type=CopyRewrite,
    )
    return out.text.strip()
