"""SEO tables and the per-resource SEO settings schema."""

from typing import List, Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field as PydanticField, field_validator
from sqlalchemy import BigInteger, Column, ForeignKey, Index, String, UniqueConstraint
from sqlmodel import Field, SQLModel

# Resource kinds that have public URLs with slugs. The key is the URL segment
# used by the public pages (/course/{slug}, /path/{slug}, ...).
SLUG_RESOURCE_TYPES = ("course", "path", "podcast", "community", "folder")
SlugResourceType = Literal["course", "path", "podcast", "community", "folder"]


class ResourceSlugRedirect(SQLModel, table=True):
    """A slug a resource used before. Requests for it redirect permanently to
    the resource's current slug, so renaming a URL never breaks old links."""

    __tablename__ = "resource_slug_redirect"
    __table_args__ = (
        UniqueConstraint("org_id", "resource_type", "slug", name="uq_slug_redirect_org_type_slug"),
        Index("ix_slug_redirect_resource_uuid", "resource_uuid"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    resource_type: str = Field(sa_column=Column(String(32), nullable=False))
    resource_uuid: str = Field(sa_column=Column(String(100), nullable=False))
    slug: str = Field(sa_column=Column(String(100), nullable=False))
    creation_date: str = ""


def _http_url(value: Optional[str], field: str) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(f"{field} must be an absolute http(s) URL")
    return value


class SeoFaqItem(BaseModel):
    question: str = PydanticField(min_length=1, max_length=300)
    answer: str = PydanticField(min_length=1, max_length=2000)

    @field_validator("question", "answer")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class ResourceSEO(BaseModel):
    """SEO settings stored in a resource's ``seo`` JSONB.

    Every field is optional: empty values fall back to defaults derived from
    the resource (name, description, thumbnail) and the org's SEO config.
    Course and podcast rows written before this schema used the same keys, so
    existing data validates unchanged.
    """

    model_config = ConfigDict(extra="ignore")

    # Search result
    title: Optional[str] = PydanticField(default=None, max_length=120)
    description: Optional[str] = PydanticField(default=None, max_length=320)
    keywords: Optional[str] = PydanticField(default=None, max_length=500)
    canonical_url: Optional[str] = PydanticField(default=None, max_length=2048)
    # Social
    og_title: Optional[str] = PydanticField(default=None, max_length=120)
    og_description: Optional[str] = PydanticField(default=None, max_length=320)
    # Absolute URL, or the file name of an image uploaded through the SEO
    # image endpoint (served from the org's seo media folder).
    og_image: Optional[str] = PydanticField(default=None, max_length=2048)
    og_type: Optional[Literal["website", "article", "video.other", "music.playlist", "profile"]] = None
    twitter_card: Optional[Literal["summary", "summary_large_image"]] = None
    twitter_title: Optional[str] = PydanticField(default=None, max_length=120)
    twitter_description: Optional[str] = PydanticField(default=None, max_length=320)
    # Indexing
    robots_noindex: bool = False
    robots_nofollow: bool = False
    enable_jsonld: bool = True
    # Accessibility + image search: alt text for the resource thumbnail.
    image_alt: Optional[str] = PydanticField(default=None, max_length=250)
    # Rich results (Course / FAQ structured data)
    faq: List[SeoFaqItem] = PydanticField(default_factory=list, max_length=20)
    educational_level: Optional[Literal["beginner", "intermediate", "advanced"]] = None
    in_language: Optional[str] = PydanticField(default=None, max_length=16, pattern=r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
    workload_minutes: Optional[int] = PydanticField(default=None, ge=1, le=100000)
    prerequisites: Optional[str] = PydanticField(default=None, max_length=1000)
    audience: Optional[str] = PydanticField(default=None, max_length=300)

    @field_validator("canonical_url")
    @classmethod
    def _canonical(cls, value: Optional[str]) -> Optional[str]:
        return _http_url(value, "canonical_url")

    @field_validator("og_image")
    @classmethod
    def _og_image(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip()
        if "/" not in value and "\\" not in value and not value.startswith("."):
            return value  # uploaded file name
        return _http_url(value, "og_image")

    @field_validator(
        "title", "description", "keywords", "og_title", "og_description",
        "twitter_title", "twitter_description", "image_alt", "prerequisites", "audience",
    )
    @classmethod
    def _blank_to_none(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None


def clean_seo(data: Optional[dict]) -> dict:
    """Validate a ``seo`` dict and return what to store (unknown keys dropped)."""
    return ResourceSEO.model_validate(data or {}).model_dump(mode="json", exclude_defaults=True)


class SlugUpdate(BaseModel):
    slug: str = PydanticField(max_length=200)


class SeoSettingsUpdate(BaseModel):
    """Body of ``PUT /seo/{type}/{uuid}``: SEO settings and, optionally, a new slug."""

    seo: Optional[ResourceSEO] = None
    slug: Optional[str] = PydanticField(default=None, max_length=200)
