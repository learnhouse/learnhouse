"""The landing page document: one versioned JSON tree, validated here.

Every writer (the builder, Atlas and MCP tools, the API, the legacy
converter) goes through ``validate_doc``, so a stored page is always one the
renderer understands. The document::

    {
      "schema": "lh.page", "version": 1,
      "theme":   design tokens (colors, fonts, radius, button style, width),
      "page":    page settings (background, search title/description),
      "symbols": {id: {"name", "node"}}   reusable components,
      "root":    [section, ...]           the page, top to bottom
    }

A node is ``{id, type, name?, props, style?, children?, hidden?, visibility?,
schedule?, animation?, anchor?}``. ``style`` holds responsive overrides:
``{"base": {...}, "tablet": {...}, "mobile": {...}, "hover": {...}}``. Style
values are an allowlist of properties with checked values (lengths, colors,
``$token`` references), never raw CSS, so nothing typed into a style can
escape into the page. Custom HTML/CSS lives in one element type (``html``),
sanitized on save and rendered in a sandboxed frame.

Validation is strict: unknown keys, element types or props are errors with a
path ("root[2].children[0].props.href: ..."), so an agent gets told exactly
what to fix instead of a page that silently renders wrong.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Callable, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from src.services.landing.sanitize import sanitize_css, sanitize_html

SCHEMA = "lh.page"
SCHEMA_VERSION = 1

# Size limits. A page bigger than this is a mistake (or an attack), not a page.
MAX_DOC_CHARS = 400_000
MAX_NODES = 2_000
MAX_DEPTH = 12
MAX_SYMBOLS = 50
MAX_ROOT = 80
MAX_TEXT = 5_000
MAX_MARKDOWN = 20_000
MAX_HTML = 50_000
MAX_CSS = 20_000
MAX_ITEMS = 60

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
ANCHOR_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
LENGTH_RE = re.compile(r"^-?\d{1,5}(\.\d{1,4})?(px|rem|em|%|vh|vw|svh|ch)$")
HEX_RE = re.compile(r"^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
RGB_RE = re.compile(
    r"^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d{1,3}))?\s*\)$"
)
TOKEN_NAMES = ("primary", "secondary", "accent", "background", "surface", "text", "muted", "border", "on-primary")
TOKEN_RE = re.compile(r"^\$(" + "|".join(re.escape(t) for t in TOKEN_NAMES) + r")$")

# Curated icon set (apps/web/components/LandingPages/render/icons.tsx mirrors it).
ICONS = (
    "ArrowRight", "ArrowUpRight", "BookOpen", "GraduationCap", "Certificate", "Users", "UsersThree",
    "ChalkboardTeacher", "Lightning", "Star", "Heart", "Check", "CheckCircle", "Clock", "Calendar", "Globe",
    "Rocket", "Target", "Trophy", "Medal", "ChartLineUp", "ChatCircle", "ChatsCircle", "Play", "PlayCircle",
    "VideoCamera", "Headphones", "Microphone", "Laptop", "DeviceMobile", "Code", "Palette", "PaintBrush",
    "Lightbulb", "Brain", "Sparkle", "ShieldCheck", "Lock", "Gift", "Tag", "CurrencyDollar", "Briefcase",
    "Buildings", "MapPin", "Envelope", "Phone", "Question", "Info", "Leaf", "Sun", "Moon", "Flame",
    "Mountains", "Compass", "Books", "Notebook", "PencilSimple", "Exam", "Student", "Handshake", "HandHeart",
    "Smiley", "Infinity", "Lifebuoy", "Crown", "Seal", "Quotes", "ListChecks", "Path", "Circuitry", "Garage",
    "InstagramLogo", "XLogo", "LinkedinLogo", "YoutubeLogo", "FacebookLogo", "TiktokLogo", "GithubLogo",
    "DiscordLogo",
)
IconName = Literal[ICONS]  # type: ignore[valid-type]

# The fonts the branding page offers (apps/web/lib/fonts.ts).
FONTS = (
    "Albert Sans", "Barlow", "Cabin", "DM Sans", "Exo 2", "Figtree", "Fira Sans",
    "IBM Plex Sans", "Instrument Sans", "Inter", "Josefin Sans", "Karla", "Lato",
    "Lexend", "Libre Franklin", "Manrope", "Montserrat", "Mulish", "Noto Sans",
    "Nunito", "Onest", "Open Sans", "Outfit", "Overpass", "Plus Jakarta Sans",
    "Poppins", "PT Sans", "Quicksand", "Raleway", "Red Hat Display", "Roboto",
    "Rubik", "Source Sans 3", "Sora", "Space Grotesk", "Titillium Web", "Urbanist",
    "Wix Madefor Text", "Work Sans",
    "Archivo", "Bricolage Grotesque", "Syne",
    # Serif and display faces.
    "DM Serif Display", "Playfair Display", "Fraunces", "Lora", "Merriweather",
    "Instrument Serif", "Libre Baskerville", "EB Garamond", "Crimson Pro", "Source Serif 4", "IBM Plex Serif",
    # Monospace.
    "Space Mono", "JetBrains Mono", "IBM Plex Mono",
    # The visitor's own system fonts (nothing to download).
    "System Sans", "System Serif", "System Mono",
)
FontName = Literal[FONTS]  # type: ignore[valid-type]


class DocError(ValueError):
    """The document is not valid. ``errors`` lists ``(path, message)``."""

    def __init__(self, errors: list[tuple[str, str]]):
        self.errors = errors
        shown = "; ".join(f"{p}: {m}" for p, m in errors[:8])
        more = f" (+{len(errors) - 8} more)" if len(errors) > 8 else ""
        super().__init__(f"Invalid page: {shown}{more}")

    def as_detail(self) -> dict:
        return {
            "code": "invalid_page",
            "message": str(self),
            "errors": [{"path": p, "message": m} for p, m in self.errors[:50]],
        }


# ─── value checks ─────────────────────────────────────────────────────────────


def check_length(value: Any, *, allow_auto: bool = False) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError("must be a length")
    if isinstance(value, (int, float)):
        if not -10_000 <= value <= 10_000:
            raise ValueError("length out of range")
        return value
    if isinstance(value, str):
        v = value.strip()
        if allow_auto and v == "auto":
            return v
        if LENGTH_RE.match(v):
            return v
    raise ValueError("must be a number of pixels or a length like '2rem', '50%' or '80vh'")


def check_color(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip()
        if v in ("transparent", "currentColor") or HEX_RE.match(v) or RGB_RE.match(v) or TOKEN_RE.match(v):
            return v
    raise ValueError("must be a hex color (#1a2b3c), rgb()/rgba(), 'transparent' or a token like $primary")


def check_href(value: Any) -> str:
    """An internal path, an anchor, http(s), mailto: or tel:. Anything else
    (javascript:, data:, protocol-relative) is refused."""
    v = (value or "").strip() if isinstance(value, str) else ""
    if not v:
        return ""
    if any(c.isspace() for c in v) and not v.lower().startswith(("mailto:", "tel:")):
        raise ValueError("links cannot contain spaces")
    if v.startswith("#"):
        return v
    if v.startswith("/") and not v.startswith("//"):
        return v
    if re.match(r"^(https?://|mailto:|tel:)", v, re.I):
        return v
    raise ValueError("must be a path (/courses), an anchor (#pricing), an http(s) URL, mailto: or tel:")


def check_src(value: Any) -> str:
    """An image/video address: http(s) or a path on this site."""
    v = (value or "").strip() if isinstance(value, str) else ""
    if not v:
        return ""
    if v.startswith("/") and not v.startswith("//"):
        return v
    if re.match(r"^https?://", v, re.I) and not any(c.isspace() for c in v):
        return v
    raise ValueError("must be an http(s) URL or a path on this site")


def check_iso(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    if isinstance(value, str):
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
            return value
        except ValueError:
            pass
    raise ValueError("must be an ISO date-time like 2026-12-01T09:00")


Length = Any  # validated by check_length
Color = Any  # validated by check_color


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ─── style ────────────────────────────────────────────────────────────────────

_LENGTH_KEYS = (
    "gap", "width", "minWidth", "height", "minHeight", "fontSize", "letterSpacing",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderWidth", "borderRadius",
)
_AUTO_KEYS = ("marginTop", "marginRight", "marginBottom", "marginLeft")
_COLOR_KEYS = ("color", "backgroundColor", "borderColor", "overlayColor")


class Gradient(_Strict):
    from_: Color = Field(alias="from")
    to: Color
    via: Optional[Color] = None
    angle: int = Field(180, ge=0, le=360)
    # "radial" is a soft glow from the top (angle is ignored); omitted = linear.
    type: Optional[Literal["linear", "radial"]] = None
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("from_", "to", "via")
    @classmethod
    def _c(cls, v):
        return check_color(v)


class Style(_Strict):
    display: Optional[Literal["block", "flex", "grid", "none"]] = None
    flexDirection: Optional[Literal["row", "column", "row-reverse", "column-reverse"]] = None
    flexWrap: Optional[Literal["wrap", "nowrap"]] = None
    justifyContent: Optional[
        Literal["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"]
    ] = None
    alignItems: Optional[Literal["flex-start", "center", "flex-end", "stretch", "baseline"]] = None
    gridColumns: Optional[int] = Field(None, ge=1, le=12)
    flexGrow: Optional[int] = Field(None, ge=0, le=12)
    gap: Length = None
    width: Length = None
    maxWidth: Length = None
    minWidth: Length = None
    height: Length = None
    minHeight: Length = None
    paddingTop: Length = None
    paddingRight: Length = None
    paddingBottom: Length = None
    paddingLeft: Length = None
    marginTop: Length = None
    marginRight: Length = None
    marginBottom: Length = None
    marginLeft: Length = None
    fontFamily: Optional[Literal[("heading", "body") + FONTS]] = None  # type: ignore[valid-type]
    fontSize: Length = None
    fontWeight: Optional[Literal["300", "400", "500", "600", "700", "800", "900"]] = None
    lineHeight: Optional[float] = Field(None, ge=0.8, le=3)
    letterSpacing: Length = None
    textAlign: Optional[Literal["start", "center", "end", "justify"]] = None
    textTransform: Optional[Literal["none", "uppercase", "lowercase", "capitalize"]] = None
    fontStyle: Optional[Literal["normal", "italic"]] = None
    textDecoration: Optional[Literal["none", "underline", "line-through"]] = None
    color: Color = None
    backgroundColor: Color = None
    backgroundGradient: Optional[Gradient] = None
    backgroundImage: Optional[str] = None
    backgroundSize: Optional[Literal["cover", "contain", "auto"]] = None
    backgroundPosition: Optional[Literal["center", "top", "bottom", "left", "right"]] = None
    backgroundVideo: Optional[str] = None
    overlayColor: Color = None
    overlayOpacity: Optional[int] = Field(None, ge=0, le=95)
    borderWidth: Length = None
    borderStyle: Optional[Literal["none", "solid", "dashed", "dotted"]] = None
    borderColor: Color = None
    borderRadius: Length = None
    boxShadow: Optional[Literal["none", "sm", "md", "lg", "xl"]] = None
    opacity: Optional[float] = Field(None, ge=0, le=1)
    overflow: Optional[Literal["visible", "hidden"]] = None
    aspectRatio: Optional[Literal["auto", "16/9", "4/3", "3/2", "1/1", "2/3", "3/4", "9/16", "21/9"]] = None
    objectFit: Optional[Literal["cover", "contain"]] = None
    scale: Optional[float] = Field(None, ge=0.8, le=1.2)

    @field_validator(*_LENGTH_KEYS)
    @classmethod
    def _length(cls, v):
        return check_length(v)

    @field_validator("maxWidth", mode="before")
    @classmethod
    def _content_width(cls, v):
        # "content": the theme's content width (theme.width).
        return v if v == "content" else check_length(v)

    @field_validator(*_AUTO_KEYS)
    @classmethod
    def _auto(cls, v):
        return check_length(v, allow_auto=True)

    @field_validator(*_COLOR_KEYS)
    @classmethod
    def _color(cls, v):
        return check_color(v)

    @field_validator("backgroundImage", "backgroundVideo")
    @classmethod
    def _src(cls, v):
        return check_src(v) or None


# Hover may only change colors, shadow, opacity and scale.
HOVER_KEYS = {"color", "backgroundColor", "borderColor", "boxShadow", "opacity", "scale"}


class ResponsiveStyle(_Strict):
    base: Optional[Style] = None
    tablet: Optional[Style] = None
    mobile: Optional[Style] = None
    hover: Optional[Style] = None


class Hidden(_Strict):
    desktop: bool = False
    tablet: bool = False
    mobile: bool = False


class Schedule(_Strict):
    from_: Optional[str] = Field(None, alias="from")
    until: Optional[str] = None
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("from_", "until")
    @classmethod
    def _iso(cls, v):
        return check_iso(v)


class Animation(_Strict):
    type: Literal["none", "fade", "slide-up", "slide-in", "zoom"] = "none"
    delay: int = Field(0, ge=0, le=2000)
    duration: int = Field(600, ge=100, le=2000)


# ─── props per element type ───────────────────────────────────────────────────


def _txt(n: int = MAX_TEXT, default: str = ""):
    return Field(default, max_length=n)


class Link(_Strict):
    label: str = _txt(120)
    href: str = ""

    @field_validator("href")
    @classmethod
    def _h(cls, v):
        return check_href(v)


class SectionProps(_Strict):
    tag: Literal["section", "header", "footer", "div"] = "section"


class ContainerProps(_Strict):
    tag: Literal["div", "article", "aside", "nav"] = "div"
    href: str = ""
    newTab: bool = False

    @field_validator("href")
    @classmethod
    def _h(cls, v):
        return check_href(v)


class ColumnsProps(_Strict):
    ratio: Literal["equal", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2"] = "equal"
    stackAt: Literal["tablet", "mobile", "never"] = "mobile"


class HeadingProps(_Strict):
    text: str = _txt(500)
    level: int = Field(2, ge=1, le=6)


class TextProps(_Strict):
    text: str = _txt()


class RichTextProps(_Strict):
    markdown: str = _txt(MAX_MARKDOWN)


class ImageProps(_Strict):
    src: str = ""
    alt: str = _txt(300)
    href: str = ""
    newTab: bool = False
    caption: str = _txt(300)

    @field_validator("src")
    @classmethod
    def _s(cls, v):
        return check_src(v)

    @field_validator("href")
    @classmethod
    def _h(cls, v):
        return check_href(v)


class VideoProps(_Strict):
    url: str = ""
    poster: str = ""
    autoplay: bool = False
    loop: bool = False
    muted: bool = False
    controls: bool = True

    @field_validator("url", "poster")
    @classmethod
    def _s(cls, v):
        return check_src(v)


class ButtonProps(_Strict):
    label: str = _txt(120)
    href: str = ""
    variant: Literal["primary", "secondary", "outline", "ghost", "link"] = "primary"
    size: Literal["sm", "md", "lg"] = "md"
    icon: Optional[IconName] = None
    iconPosition: Literal["start", "end"] = "end"
    newTab: bool = False
    fullWidth: bool = False

    @field_validator("href")
    @classmethod
    def _h(cls, v):
        return check_href(v)


class IconProps(_Strict):
    name: IconName = "Star"
    size: int = Field(32, ge=12, le=160)
    weight: Literal["regular", "bold", "duotone", "fill", "light"] = "duotone"


class EmptyProps(_Strict):
    pass


class SpacerProps(_Strict):
    size: int = Field(48, ge=0, le=400)


class EmbedProps(_Strict):
    url: str = ""
    title: str = _txt(200)
    height: int = Field(480, ge=100, le=2000)
    aspect: Optional[Literal["16/9", "4/3", "1/1", "9/16"]] = None

    @field_validator("url")
    @classmethod
    def _u(cls, v):
        v = (v or "").strip()
        if v and not v.lower().startswith("https://"):
            raise ValueError("embeds must use an https:// link from a supported provider")
        return v


class ListProps(_Strict):
    items: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    marker: Literal["check", "dot", "number", "none"] = "check"

    @field_validator("items")
    @classmethod
    def _len(cls, v):
        if any(len(x) > 500 for x in v):
            raise ValueError("each item is limited to 500 characters")
        return v


class HtmlProps(_Strict):
    html: str = _txt(MAX_HTML)
    css: str = _txt(MAX_CSS)
    height: int = Field(320, ge=40, le=4000)

    @field_validator("html")
    @classmethod
    def _html(cls, v):
        return sanitize_html(v)

    @field_validator("css")
    @classmethod
    def _css(cls, v):
        return sanitize_css(v)


_ColLayout = Literal["grid", "carousel", "list"]
_CardStyle = Literal["shadow", "border", "flat", "minimal"]


class CoursesProps(_Strict):
    source: Literal["latest", "selected", "all"] = "latest"
    courseUuids: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    limit: int = Field(6, ge=1, le=48)
    layout: _ColLayout = "grid"
    columns: int = Field(3, ge=1, le=6)
    showDescription: bool = True
    cardStyle: _CardStyle = "shadow"
    emptyText: str = _txt(200)


class CourseProps(_Strict):
    courseUuid: str = Field("", max_length=100)
    layout: Literal["split", "card"] = "split"
    buttonLabel: str = _txt(80)
    showDescription: bool = True


class PathsProps(_Strict):
    source: Literal["latest", "selected"] = "latest"
    pathUuids: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    limit: int = Field(3, ge=1, le=24)
    columns: int = Field(3, ge=1, le=4)
    cardStyle: _CardStyle = "shadow"


class CollectionProps(_Strict):
    limit: int = Field(6, ge=1, le=24)
    columns: int = Field(3, ge=1, le=4)
    cardStyle: _CardStyle = "shadow"
    emptyText: str = _txt(200)


class LiveSessionsProps(_Strict):
    limit: int = Field(4, ge=1, le=12)
    layout: Literal["list", "grid"] = "list"
    emptyText: str = _txt(200)


class Person(_Strict):
    name: str = _txt(120)
    role: str = _txt(120)
    bio: str = _txt(600)
    image: str = ""
    username: str = Field("", max_length=64)
    href: str = ""

    @field_validator("image")
    @classmethod
    def _s(cls, v):
        return check_src(v)

    @field_validator("href")
    @classmethod
    def _h(cls, v):
        return check_href(v)


class InstructorsProps(_Strict):
    people: list[Person] = Field(default_factory=list, max_length=MAX_ITEMS)
    columns: int = Field(4, ge=1, le=6)
    layout: Literal["cards", "row"] = "cards"


class Testimonial(_Strict):
    quote: str = _txt(1500)
    author: str = _txt(120)
    role: str = _txt(120)
    image: str = ""
    rating: int = Field(0, ge=0, le=5)

    @field_validator("image")
    @classmethod
    def _s(cls, v):
        return check_src(v)


class TestimonialsProps(_Strict):
    items: list[Testimonial] = Field(default_factory=list, max_length=MAX_ITEMS)
    layout: Literal["grid", "carousel", "single"] = "grid"
    columns: int = Field(3, ge=1, le=4)
    cardStyle: _CardStyle = "shadow"


class PricingPlan(_Strict):
    name: str = _txt(120)
    price: str = _txt(40)
    period: str = _txt(40)
    description: str = _txt(500)
    features: list[str] = Field(default_factory=list, max_length=40)
    highlighted: bool = False
    badge: str = _txt(40)
    button: Link = Field(default_factory=Link)
    offerUuid: str = Field("", max_length=100)


class PricingProps(_Strict):
    plans: list[PricingPlan] = Field(default_factory=list, max_length=8)
    columns: int = Field(3, ge=1, le=4)


class FaqItem(_Strict):
    question: str = _txt(500)
    answer: str = _txt(3000)


class FaqProps(_Strict):
    items: list[FaqItem] = Field(default_factory=list, max_length=MAX_ITEMS)
    layout: Literal["accordion", "list", "two-columns"] = "accordion"


class Stat(_Strict):
    value: str = _txt(40)
    label: str = _txt(120)


class StatsProps(_Strict):
    items: list[Stat] = Field(default_factory=list, max_length=12)
    layout: Literal["row", "cards"] = "row"


class Logo(_Strict):
    src: str = ""
    alt: str = _txt(200)
    href: str = ""

    @field_validator("src")
    @classmethod
    def _s(cls, v):
        return check_src(v)

    @field_validator("href")
    @classmethod
    def _h(cls, v):
        return check_href(v)


class LogosProps(_Strict):
    items: list[Logo] = Field(default_factory=list, max_length=MAX_ITEMS)
    grayscale: bool = True
    size: Literal["sm", "md", "lg"] = "md"


class Feature(_Strict):
    icon: Optional[IconName] = None
    emoji: str = Field("", max_length=8)
    title: str = _txt(200)
    text: str = _txt(1500)


class FeaturesProps(_Strict):
    items: list[Feature] = Field(default_factory=list, max_length=MAX_ITEMS)
    columns: int = Field(3, ge=1, le=4)
    layout: Literal["cards", "plain", "list"] = "cards"
    cardStyle: _CardStyle = "shadow"


class Step(_Strict):
    title: str = _txt(200)
    text: str = _txt(1500)


class StepsProps(_Strict):
    items: list[Step] = Field(default_factory=list, max_length=20)
    layout: Literal["horizontal", "vertical"] = "horizontal"


class GalleryImage(_Strict):
    src: str = ""
    alt: str = _txt(300)

    @field_validator("src")
    @classmethod
    def _s(cls, v):
        return check_src(v)


class GalleryProps(_Strict):
    images: list[GalleryImage] = Field(default_factory=list, max_length=MAX_ITEMS)
    columns: int = Field(3, ge=1, le=6)


class CountdownProps(_Strict):
    target: Optional[str] = None
    doneText: str = _txt(300)

    @field_validator("target")
    @classmethod
    def _iso(cls, v):
        return check_iso(v)


class NewsletterProps(_Strict):
    newsletterSlug: str = Field("", max_length=120)
    placeholder: str = _txt(120)
    buttonLabel: str = _txt(60)
    successText: str = _txt(300)
    layout: Literal["inline", "stacked"] = "inline"


class FormField(_Strict):
    key: str = Field(..., pattern=r"^[a-z][a-z0-9_]{0,39}$")
    label: str = _txt(200)
    type: Literal["text", "email", "textarea", "tel", "select", "checkbox"] = "text"
    required: bool = False
    placeholder: str = _txt(200)
    options: list[str] = Field(default_factory=list, max_length=30)


class FormProps(_Strict):
    fields: list[FormField] = Field(default_factory=list, max_length=12)
    submitLabel: str = _txt(60)
    successText: str = _txt(300)

    @field_validator("fields")
    @classmethod
    def _unique(cls, v):
        keys = [f.key for f in v]
        if len(keys) != len(set(keys)):
            raise ValueError("field keys must be unique")
        return v


class NavbarProps(_Strict):
    variant: Literal["simple", "centered", "split"] = "simple"
    showLogo: bool = True
    logoText: str = _txt(120)
    links: list[Link] = Field(default_factory=list, max_length=12)
    cta: Optional[Link] = None
    sticky: bool = False


class FooterColumn(_Strict):
    title: str = _txt(120)
    links: list[Link] = Field(default_factory=list, max_length=12)


class Social(_Strict):
    network: Literal["instagram", "x", "linkedin", "youtube", "facebook", "tiktok", "github", "discord"]
    href: str = ""

    @field_validator("href")
    @classmethod
    def _h(cls, v):
        return check_href(v)


class FooterProps(_Strict):
    variant: Literal["simple", "columns"] = "simple"
    showLogo: bool = True
    text: str = _txt(1000)
    columns: list[FooterColumn] = Field(default_factory=list, max_length=6)
    social: list[Social] = Field(default_factory=list, max_length=8)
    copyright: str = _txt(200)


class SymbolProps(_Strict):
    symbolId: str = Field(..., pattern=ID_RE.pattern)


# type -> (props model, takes children, category)
ELEMENTS: dict[str, tuple[type[BaseModel], bool, str]] = {
    "section": (SectionProps, True, "layout"),
    "container": (ContainerProps, True, "layout"),
    "columns": (ColumnsProps, True, "layout"),
    "heading": (HeadingProps, False, "basic"),
    "text": (TextProps, False, "basic"),
    "richtext": (RichTextProps, False, "basic"),
    "image": (ImageProps, False, "media"),
    "video": (VideoProps, False, "media"),
    "button": (ButtonProps, False, "basic"),
    "icon": (IconProps, False, "basic"),
    "divider": (EmptyProps, False, "basic"),
    "spacer": (SpacerProps, False, "basic"),
    "embed": (EmbedProps, False, "media"),
    "list": (ListProps, False, "basic"),
    "html": (HtmlProps, False, "advanced"),
    "courses": (CoursesProps, False, "data"),
    "course": (CourseProps, False, "data"),
    "paths": (PathsProps, False, "data"),
    "communities": (CollectionProps, False, "data"),
    "podcasts": (CollectionProps, False, "data"),
    "live_sessions": (LiveSessionsProps, False, "data"),
    "instructors": (InstructorsProps, False, "data"),
    "testimonials": (TestimonialsProps, False, "content"),
    "pricing": (PricingProps, False, "data"),
    "faq": (FaqProps, False, "content"),
    "stats": (StatsProps, False, "content"),
    "logos": (LogosProps, False, "content"),
    "features": (FeaturesProps, False, "content"),
    "steps": (StepsProps, False, "content"),
    "gallery": (GalleryProps, False, "media"),
    "countdown": (CountdownProps, False, "content"),
    "newsletter": (NewsletterProps, False, "forms"),
    "form": (FormProps, False, "forms"),
    "navbar": (NavbarProps, False, "navigation"),
    "footer": (FooterProps, False, "navigation"),
    "symbol": (SymbolProps, False, "layout"),
}
ELEMENT_TYPES = tuple(ELEMENTS)
CONTAINER_TYPES = frozenset(t for t, (_, kids, _) in ELEMENTS.items() if kids)
# Element types only some plans may use (see service.plan_caps).
GATED_TYPES = {"html": "custom_code"}

NODE_KEYS = {"id", "type", "name", "props", "style", "children", "hidden", "visibility", "schedule", "animation", "anchor"}


# ─── theme and page ───────────────────────────────────────────────────────────


class ThemeColors(_Strict):
    primary: str = "brand"
    secondary: str = "#0f172a"
    accent: str = "#f59e0b"
    background: str = "#ffffff"
    surface: str = "#f8fafc"
    text: str = "#0f172a"
    muted: str = "#64748b"
    border: str = "#e2e8f0"

    @field_validator("*")
    @classmethod
    def _c(cls, v):
        if v == "brand":
            return v
        if isinstance(v, str) and (HEX_RE.match(v.strip()) or RGB_RE.match(v.strip())):
            return v.strip()
        raise ValueError("must be 'brand' or a hex / rgb() color")


class ThemeFonts(_Strict):
    heading: Literal[("brand",) + FONTS] = "brand"  # type: ignore[valid-type]
    body: Literal[("brand",) + FONTS] = "brand"  # type: ignore[valid-type]


class DarkColors(_Strict):
    """The page's colors when the visitor uses dark mode. Without it the page
    keeps its own (light or dark) design whatever the visitor picked."""

    primary: Optional[str] = None
    background: str = "#0c0c0f"
    surface: str = "#16161b"
    text: str = "#ededf0"
    muted: str = "#a1a1aa"
    border: str = "#2a2a31"

    @field_validator("*")
    @classmethod
    def _c(cls, v):
        if v is None:
            return v
        if isinstance(v, str) and (HEX_RE.match(v.strip()) or RGB_RE.match(v.strip())):
            return v.strip()
        raise ValueError("must be a hex / rgb() color")


class Theme(_Strict):
    colors: ThemeColors = Field(default_factory=ThemeColors)
    fonts: ThemeFonts = Field(default_factory=ThemeFonts)
    radius: Literal["none", "sm", "md", "lg", "xl", "full"] = "lg"
    buttonStyle: Literal["solid", "soft", "outline", "pill"] = "solid"
    width: Literal["normal", "wide", "full"] = "normal"
    density: Literal["compact", "comfortable", "spacious"] = "comfortable"
    headingWeight: Literal["500", "600", "700", "800"] = "700"
    dark: Optional[DarkColors] = None


class PageSettings(_Strict):
    background: Color = None
    # A page-wide gradient or picture behind every section (over the color).
    backgroundGradient: Optional[Gradient] = None
    backgroundImage: Optional[str] = None
    title: str = _txt(120)
    description: str = _txt(320)
    # The picture shown when the page is shared (Open Graph / social cards).
    image: Optional[str] = None
    # Ask search engines not to list this page.
    noindex: bool = False

    @field_validator("background")
    @classmethod
    def _c(cls, v):
        return check_color(v)

    @field_validator("backgroundImage", "image")
    @classmethod
    def _img(cls, v):
        return check_src(v) or None


# ─── validation ───────────────────────────────────────────────────────────────


def _err_msg(e: ValidationError) -> list[tuple[str, str]]:
    out = []
    for item in e.errors():
        loc = ".".join(str(x) for x in item.get("loc", ()) if x != "__root__")
        msg = item.get("msg", "invalid").replace("Value error, ", "")
        out.append((loc, msg))
    return out


class _Walker:
    def __init__(self, caps: set[str], symbols: set[str]):
        self.caps = caps
        self.symbols = symbols
        self.errors: list[tuple[str, str]] = []
        self.ids: set[str] = set()
        self.count = 0

    def err(self, path: str, msg: str) -> None:
        if len(self.errors) < 200:
            self.errors.append((path, msg))

    def node(self, raw: Any, path: str, depth: int, *, in_symbol: bool = False) -> Optional[dict]:
        if not isinstance(raw, dict):
            self.err(path, "must be an object")
            return None
        self.count += 1
        if self.count > MAX_NODES:
            if self.count == MAX_NODES + 1:
                self.err(path, f"a page is limited to {MAX_NODES} elements")
            return None
        if depth > MAX_DEPTH:
            self.err(path, f"elements nest at most {MAX_DEPTH} levels deep")
            return None
        unknown = set(raw) - NODE_KEYS
        if unknown:
            self.err(path, f"unknown keys: {', '.join(sorted(unknown))}")
        out: dict[str, Any] = {}
        nid = raw.get("id")
        if not isinstance(nid, str) or not ID_RE.match(nid):
            self.err(f"{path}.id", "must be 1-40 letters, digits, '-' or '_'")
        elif nid in self.ids:
            self.err(f"{path}.id", f"duplicate id '{nid}'")
        else:
            self.ids.add(nid)
        out["id"] = nid
        etype = raw.get("type")
        if etype not in ELEMENTS:
            self.err(f"{path}.type", f"unknown element type '{etype}'. Use one of: {', '.join(ELEMENT_TYPES)}")
            return None
        out["type"] = etype
        gate = GATED_TYPES.get(etype)
        if gate and gate not in self.caps:
            self.err(f"{path}.type", "custom code needs the Pro plan or higher")
        model, takes_children, _ = ELEMENTS[etype]
        name = raw.get("name")
        if name is not None:
            if not isinstance(name, str) or len(name) > 80:
                self.err(f"{path}.name", "must be text up to 80 characters")
            elif name:
                out["name"] = name
        props = raw.get("props") or {}
        if not isinstance(props, dict):
            self.err(f"{path}.props", "must be an object")
            props = {}
        try:
            out["props"] = model.model_validate(props).model_dump(mode="json", by_alias=True, exclude_none=True)
        except ValidationError as e:
            for loc, msg in _err_msg(e):
                self.err(f"{path}.props.{loc}" if loc else f"{path}.props", msg)
            out["props"] = {}
        if etype == "symbol":
            sid = props.get("symbolId")
            if in_symbol:
                self.err(f"{path}", "a symbol cannot contain another symbol")
            elif sid not in self.symbols:
                self.err(f"{path}.props.symbolId", f"no symbol '{sid}' in this page")
        style = raw.get("style")
        if style is not None:
            s = self.style(style, f"{path}.style")
            if s:
                out["style"] = s
        for key, model_cls in (("hidden", Hidden), ("schedule", Schedule), ("animation", Animation)):
            value = raw.get(key)
            if value is None:
                continue
            try:
                dumped = model_cls.model_validate(value).model_dump(mode="json", by_alias=True, exclude_none=True)
                if any(dumped.values()):
                    out[key] = dumped
            except ValidationError as e:
                for loc, msg in _err_msg(e):
                    self.err(f"{path}.{key}.{loc}" if loc else f"{path}.{key}", msg)
        vis = raw.get("visibility")
        if vis is not None:
            if vis not in ("everyone", "logged_in", "logged_out"):
                self.err(f"{path}.visibility", "must be everyone, logged_in or logged_out")
            elif vis != "everyone":
                out["visibility"] = vis
        anchor = raw.get("anchor")
        if anchor not in (None, ""):
            if not isinstance(anchor, str) or not ANCHOR_RE.match(anchor):
                self.err(f"{path}.anchor", "lowercase letters, digits, '-' and '_' only (e.g. pricing)")
            else:
                out["anchor"] = anchor
        children = raw.get("children")
        if children is not None:
            if not takes_children:
                if children:
                    self.err(f"{path}.children", f"a {etype} cannot contain other elements")
            elif not isinstance(children, list):
                self.err(f"{path}.children", "must be a list")
            else:
                if etype == "columns" and len(children) > 6:
                    self.err(f"{path}.children", "columns hold at most 6 columns")
                kids = []
                for i, child in enumerate(children):
                    c = self.node(child, f"{path}.children[{i}]", depth + 1, in_symbol=in_symbol)
                    if c is not None:
                        if c.get("type") == "section":
                            self.err(f"{path}.children[{i}].type", "sections only go at the top level of a page")
                        kids.append(c)
                out["children"] = kids
        elif takes_children:
            out["children"] = []
        return out

    def style(self, raw: Any, path: str) -> Optional[dict]:
        if not isinstance(raw, dict):
            self.err(path, "must be an object with base / tablet / mobile / hover")
            return None
        try:
            rs = ResponsiveStyle.model_validate(raw)
        except ValidationError as e:
            for loc, msg in _err_msg(e):
                self.err(f"{path}.{loc}" if loc else path, msg)
            return None
        out = {}
        for bp in ("base", "tablet", "mobile", "hover"):
            s = getattr(rs, bp)
            if s is None:
                continue
            dumped = s.model_dump(mode="json", by_alias=True, exclude_none=True)
            if bp == "hover":
                extra = set(dumped) - HOVER_KEYS
                if extra:
                    self.err(f"{path}.hover", f"hover can only change {', '.join(sorted(HOVER_KEYS))}")
                    dumped = {k: v for k, v in dumped.items() if k in HOVER_KEYS}
            if dumped:
                out[bp] = dumped
        return out or None


def theme_dump(theme: Theme) -> dict:
    """A theme as stored: no ``dark`` key unless the page defines one."""
    out = theme.model_dump(mode="json")
    if out.get("dark") is None:
        out.pop("dark", None)
    else:
        out["dark"] = {k: v for k, v in out["dark"].items() if v is not None}
    return out


def empty_doc() -> dict:
    return {
        "schema": SCHEMA,
        "version": SCHEMA_VERSION,
        "theme": theme_dump(Theme()),
        "page": {},
        "symbols": {},
        "root": [],
    }


def validate_doc(raw: Any, *, caps: Optional[set[str]] = None) -> dict:
    """Return the normalized document, or raise DocError.

    ``caps`` are the plan capabilities of the org ("custom_code"); a gated
    element without its capability is an error."""
    caps = set(caps or ())
    if not isinstance(raw, dict):
        raise DocError([("", "the page must be a JSON object")])
    try:
        size = len(json.dumps(raw, separators=(",", ":"), default=str))
    except (TypeError, ValueError):
        raise DocError([("", "the page is not valid JSON")])
    if size > MAX_DOC_CHARS:
        raise DocError([("", f"the page is {size} characters; the limit is {MAX_DOC_CHARS}")])
    errors: list[tuple[str, str]] = []
    allowed = {"schema", "version", "theme", "page", "symbols", "root"}
    unknown = set(raw) - allowed
    if unknown:
        errors.append(("", f"unknown keys: {', '.join(sorted(unknown))}"))
    if raw.get("schema", SCHEMA) != SCHEMA:
        errors.append(("schema", f"must be '{SCHEMA}'"))
    version = raw.get("version", SCHEMA_VERSION)
    if version != SCHEMA_VERSION:
        errors.append(("version", f"unsupported version {version}; this server reads version {SCHEMA_VERSION}"))
    out = empty_doc()
    try:
        out["theme"] = theme_dump(Theme.model_validate(raw.get("theme") or {}))
    except ValidationError as e:
        errors += [(f"theme.{loc}", msg) for loc, msg in _err_msg(e)]
    try:
        out["page"] = PageSettings.model_validate(raw.get("page") or {}).model_dump(mode="json", by_alias=True, exclude_none=True)
        out["page"] = {k: v for k, v in out["page"].items() if v not in ("", None, False)}
    except ValidationError as e:
        errors += [(f"page.{loc}", msg) for loc, msg in _err_msg(e)]

    symbols_raw = raw.get("symbols")
    symbols_raw = {} if symbols_raw is None else symbols_raw
    if not isinstance(symbols_raw, dict):
        errors.append(("symbols", "must be an object of id -> {name, node}"))
        symbols_raw = {}
    if len(symbols_raw) > MAX_SYMBOLS:
        errors.append(("symbols", f"a page holds at most {MAX_SYMBOLS} symbols"))
    walker = _Walker(caps, {k for k in symbols_raw if isinstance(k, str) and ID_RE.match(k)})
    walker.errors = errors
    symbols: dict[str, Any] = {}
    for sid, sym in list(symbols_raw.items())[:MAX_SYMBOLS]:
        spath = f"symbols.{sid}"
        if not isinstance(sid, str) or not ID_RE.match(sid):
            walker.err(spath, "symbol ids are 1-40 letters, digits, '-' or '_'")
            continue
        if not isinstance(sym, dict) or set(sym) - {"name", "node"}:
            walker.err(spath, "must be {name, node}")
            continue
        name = sym.get("name") or ""
        if not isinstance(name, str) or len(name) > 80:
            walker.err(f"{spath}.name", "must be text up to 80 characters")
            name = ""
        node = walker.node(sym.get("node"), f"{spath}.node", 1, in_symbol=True)
        if node is not None:
            symbols[sid] = {"name": name, "node": node}
    out["symbols"] = symbols

    root = raw.get("root")
    root = [] if root is None else root
    if not isinstance(root, list):
        walker.err("root", "must be a list of sections")
        root = []
    if len(root) > MAX_ROOT:
        walker.err("root", f"a page holds at most {MAX_ROOT} top-level sections")
    nodes = []
    for i, item in enumerate(root[:MAX_ROOT]):
        node = walker.node(item, f"root[{i}]", 1)
        if node is None:
            continue
        if node["type"] not in ("section", "symbol"):
            walker.err(f"root[{i}].type", "the top level of a page holds sections (or symbols); wrap this in a section")
        nodes.append(node)
    out["root"] = nodes
    if walker.errors:
        raise DocError(walker.errors)
    return out


def walk(doc: dict, fn: Callable[[dict, Optional[dict]], None]) -> None:
    """Call ``fn(node, parent)`` for every node of the page and its symbols."""

    def visit(node: dict, parent: Optional[dict]) -> None:
        fn(node, parent)
        for child in node.get("children") or []:
            visit(child, node)

    for node in doc.get("root") or []:
        visit(node, None)
    for sym in (doc.get("symbols") or {}).values():
        if isinstance(sym, dict) and isinstance(sym.get("node"), dict):
            visit(sym["node"], None)


def element_types_used(doc: dict) -> set[str]:
    used: set[str] = set()
    walk(doc, lambda n, _p: used.add(n.get("type")))
    return used


def check_slug(slug: str) -> str:
    slug = (slug or "").strip().lower()
    if slug in ("", "home"):
        return ""
    if not SLUG_RE.match(slug):
        raise ValueError("page addresses use lowercase letters, digits and '-' (e.g. about-us)")
    return slug


def schema_summary() -> dict:
    """What an agent needs to write valid pages: element types with their
    props, style keys, tokens and limits."""
    elements = {}
    for name, (model, kids, category) in ELEMENTS.items():
        schema = model.model_json_schema()
        elements[name] = {
            "category": category,
            "children": kids,
            "props": {k: _short_schema(v, schema) for k, v in (schema.get("properties") or {}).items()},
        }
        if name in GATED_TYPES:
            elements[name]["plan"] = "pro"
    return {
        "schema": SCHEMA,
        "version": SCHEMA_VERSION,
        "elements": elements,
        "style_keys": sorted(Style.model_fields),
        "hover_keys": sorted(HOVER_KEYS),
        "breakpoints": {"base": "all widths", "tablet": "< 1024px", "mobile": "< 640px"},
        "tokens": [f"${t}" for t in TOKEN_NAMES],
        "theme": Theme.model_json_schema().get("properties"),
        "icons": list(ICONS),
        "fonts": list(FONTS),
        "limits": {"nodes": MAX_NODES, "depth": MAX_DEPTH, "chars": MAX_DOC_CHARS, "sections": MAX_ROOT},
        "rules": [
            "The top level holds sections; sections hold containers, columns and elements.",
            "Every node needs a unique id (letters, digits, - or _).",
            "Lengths are numbers (px) or strings like '2rem', '60%', '80vh'.",
            "Colors are hex, rgb(), or theme tokens like $primary / $text / $surface.",
            "style = {base, tablet, mobile, hover}; tablet/mobile override base on smaller screens.",
        ],
    }


def _short_schema(prop: dict, root: dict) -> Any:
    if "$ref" in prop:
        name = prop["$ref"].split("/")[-1]
        sub = (root.get("$defs") or {}).get(name, {})
        return {k: _short_schema(v, root) for k, v in (sub.get("properties") or {}).items()}
    if "anyOf" in prop:
        options = [_short_schema(p, root) for p in prop["anyOf"] if p.get("type") != "null"]
        return options[0] if len(options) == 1 else options
    if prop.get("type") == "array":
        return [_short_schema(prop.get("items") or {}, root)]
    if "enum" in prop:
        return "|".join(str(x) for x in prop["enum"])
    if "const" in prop:
        return prop["const"]
    return prop.get("type", "any")
