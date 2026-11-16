"""AI suggestions for a resource's search title and meta description."""

from pydantic import BaseModel, Field

from src.services.ai.llm import generate, model_for_tier

_SYSTEM_PROMPT = """You write search engine snippets for online learning content.
Given a resource (course, learning path, podcast, community or library folder),
return a search title and a meta description that make a searcher click.

Rules:
- Title: 30 to 60 characters, starts with the main topic, no clickbait, no
  quotes, no trailing site name (it is added automatically).
- Description: 120 to 155 characters, says who it is for and what they get,
  active voice, one or two sentences, no emoji, no quotes.
- Write in the same language as the resource name and description.
- Return only the structured fields."""


class SeoSuggestion(BaseModel):
    title: str = Field(max_length=120)
    description: str = Field(max_length=320)


def build_prompt(resource_type: str, name: str, description: str, extra: str, org_name: str) -> str:
    parts = [
        f"Resource type: {resource_type}",
        f"Name: {name.strip()}",
        f"Organization: {org_name.strip()}",
    ]
    if description.strip():
        parts.append(f"Description: {description.strip()[:1500]}")
    if extra.strip():
        parts.append(f"More context: {extra.strip()[:1500]}")
    return "\n".join(parts)


async def suggest_snippet(
    *, resource_type: str, name: str, description: str, extra: str, org_name: str, model_name: str | None
) -> SeoSuggestion:
    suggestion: SeoSuggestion = await generate(
        model_name=model_name or model_for_tier("standard"),
        user_prompt=build_prompt(resource_type, name, description, extra, org_name),
        system_prompt=_SYSTEM_PROMPT,
        output_type=SeoSuggestion,
    )
    return SeoSuggestion(title=suggestion.title.strip()[:120], description=suggestion.description.strip()[:320])
