"""Human-readable URL slugs.

Slugs are ASCII only (``[a-z0-9-]``): non-ASCII path segments are
percent-encoded in links and logs, and route params do not reliably decode
them. Latin accents are folded with NFKD; Cyrillic, Greek, Arabic, Persian and
Hebrew are transliterated from the tables below. Scripts with no practical
letter-by-letter romanization (CJK, Thai, ...) are dropped, and a title with
nothing left falls back to a short stable id chosen by the caller.

The web app has a mirror of this module (``apps/web/lib/seo/slugify.ts``) for
the live preview; both are tested against the same fixtures.
"""

import re
import unicodedata

SLUG_MAX_LENGTH = 80

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
UUID_LIKE_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)

# Path segments the app routes under a resource, or words that read as
# actions/placeholders. A resource with one of these as its slug would be
# unreachable or confusing.
RESERVED_SLUGS = frozenset(
    {
        "activity", "activities", "admin", "api", "create", "dash", "edit",
        "embed", "end", "feed", "index", "new", "none", "null", "og",
        "preview", "robots", "settings", "sitemap", "undefined", "updates",
    }
)

_LATIN = {
    "ß": "ss", "æ": "ae", "ø": "o", "œ": "oe", "đ": "d", "ð": "d", "ł": "l",
    "þ": "th", "ı": "i", "ħ": "h", "ŋ": "ng", "ĸ": "k", "ſ": "s", "ŧ": "t",
}

_CYRILLIC = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    # Ukrainian, Belarusian, Serbian, Macedonian
    "є": "ye", "і": "i", "ї": "yi", "ґ": "g", "ў": "u", "ђ": "dj", "ј": "j",
    "љ": "lj", "њ": "nj", "ћ": "c", "џ": "dz", "ѓ": "gj", "ќ": "kj", "ѕ": "dz",
}

_GREEK = {
    "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i",
    "θ": "th", "ι": "i", "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "x",
    "ο": "o", "π": "p", "ρ": "r", "σ": "s", "ς": "s", "τ": "t", "υ": "y",
    "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o",
}

_ARABIC = {
    "ا": "a", "أ": "a", "إ": "i", "آ": "a", "ب": "b", "ت": "t", "ث": "th",
    "ج": "j", "ح": "h", "خ": "kh", "د": "d", "ذ": "dh", "ر": "r", "ز": "z",
    "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a",
    "غ": "gh", "ف": "f", "ق": "q", "ك": "k", "ل": "l", "م": "m", "ن": "n",
    "ه": "h", "و": "w", "ي": "y", "ى": "a", "ة": "h", "ء": "", "ئ": "y",
    "ؤ": "w",
    # Persian / Urdu
    "پ": "p", "چ": "ch", "ژ": "zh", "گ": "g", "ک": "k", "ی": "y",
}

_HEBREW = {
    "א": "a", "ב": "b", "ג": "g", "ד": "d", "ה": "h", "ו": "v", "ז": "z",
    "ח": "ch", "ט": "t", "י": "y", "כ": "k", "ך": "k", "ל": "l", "מ": "m",
    "ם": "m", "נ": "n", "ן": "n", "ס": "s", "ע": "", "פ": "p", "ף": "f",
    "צ": "ts", "ץ": "ts", "ק": "k", "ר": "r", "ש": "sh", "ת": "t",
}

_TABLE = {**_LATIN, **_CYRILLIC, **_GREEK, **_ARABIC, **_HEBREW}

# Removed without leaving a separator, so "don't" reads "dont" not "don-t".
_JOINERS = {"'", "’", "‘", "`", "´"}


def transliterate(text: str) -> str:
    """Lowercase ASCII approximation of ``text``; unknown letters are dropped."""
    out = []
    for char in text.lower():
        if char in _JOINERS:
            continue
        mapped = _TABLE.get(char)
        if mapped is not None:
            out.append(mapped)
            continue
        # NFKD splits accented Latin (é -> e + U+0301) and compatibility forms
        # (ﬁ -> fi, full-width Ａ -> A); keep only the ASCII part.
        for part in unicodedata.normalize("NFKD", char):
            mapped = _TABLE.get(part)
            if mapped is not None:
                out.append(mapped)
            elif part.isascii():
                out.append(part.lower())
            elif not unicodedata.combining(part):
                out.append(" ")
    return "".join(out)


def slugify(text: str | None, max_length: int = SLUG_MAX_LENGTH) -> str:
    """Slug for ``text``, or ``""`` when nothing transliterable is left."""
    if not text:
        return ""
    slug = re.sub(r"[^a-z0-9]+", "-", transliterate(text)).strip("-")
    if len(slug) > max_length:
        cut = slug[:max_length]
        # Prefer ending on a whole word when one fits in the second half.
        if "-" in cut[max_length // 2 :]:
            cut = cut[: cut.rindex("-")]
        slug = cut.strip("-")
    return slug


def slug_error(slug: str) -> str | None:
    """Why ``slug`` can't be used as typed, or None when its format is fine."""
    if not slug:
        return "empty"
    if len(slug) > SLUG_MAX_LENGTH:
        return "too_long"
    if not SLUG_RE.match(slug):
        return "invalid_characters"
    if UUID_LIKE_RE.match(slug):
        return "looks_like_id"
    if slug in RESERVED_SLUGS:
        return "reserved"
    return None


def base_slug(name: str | None, fallback_id: str) -> str:
    """The slug to start from for a resource called ``name``.

    ``fallback_id`` (usually the resource uuid) supplies a short stable suffix
    when the name has no transliterable letters, e.g. a title written only in
    Chinese.
    """
    slug = slugify(name)
    if not slug or slug_error(slug):
        tail = re.sub(r"[^a-z0-9]", "", (fallback_id or "").lower().split("_")[-1])[:8]
        slug = f"{slug}-{tail}" if slug and tail else (slug or tail or "item")
    return slug


def numbered(slug: str, n: int) -> str:
    """``slug`` with a ``-n`` suffix, shortened to stay within the limit."""
    if n <= 1:
        return slug
    suffix = f"-{n}"
    return f"{slug[: SLUG_MAX_LENGTH - len(suffix)].rstrip('-')}{suffix}"


def first_free(slug: str, taken: set[str]) -> str:
    """``slug`` or the lowest numbered variant not in ``taken``."""
    n = 1
    while numbered(slug, n) in taken:
        n += 1
    return numbered(slug, n)
