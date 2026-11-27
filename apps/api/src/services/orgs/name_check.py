"""Throwaway organization names and slugs.

Self-service org creation and renames refuse a name or slug that is clearly a
test: a "test" / "testing" / "demo" / "sample"... word (alone, with digits,
or glued to org/site/school...), a keyboard mash (asdf, qwer, zxcv...), or
gibberish (akakakdaksdj, adfheheudk, adu3ikdakd).

Matching works on words, so real names that merely contain the letters pass:
"Contest Prep Academy", "Latest Skills", "Demolition Training", "Attestation
Hub". Non-Latin names are never called gibberish.

On by default on SaaS only. ``LEARNHOUSE_ORG_NAME_CHECK=1`` turns it on for a
self-hosted install, ``=0`` turns it off. Platform staff creating orgs from the
backoffice don't go through this.
"""

import os
import re
from typing import Optional

from fastapi import HTTPException

REJECT_MESSAGE = (
    "Please give your organization its real name. Names and addresses like "
    "\"test\", \"demo\" or random letters are not accepted."
)

TEST_WORDS = (
    "test", "tests", "testing", "tester", "testorg", "tets", "demo", "demos", "demoorg", "sample", "asdf",
    "qwerty", "azerty", "lorem", "ipsum", "foobar", "untitled", "placeholder", "xxx", "aaa", "zzz", "blah",
)
# "test" in other languages (whole words only).
INTL_TEST_WORDS = frozenset({"prueba", "pruebas", "teste", "testes", "тест", "тесты", "тестовая", "тестовый",
                             "тестування", "テスト", "测试", "測試"})
_TEST_BASES = ("test", "testing", "tests", "demo", "sample")
_GLUE = ("", "org", "orgs", "organization", "organisation", "site", "school", "academy", "account", "app",
         "company", "co", "team", "space", "lms", "course", "courses", "env", "instance", "workspace")
_OWNED = ("my", "the", "a", "new", "your")
_TEST_TOKEN = re.compile(
    r"^(?:" + "|".join(_OWNED) + r")?(?:" + "|".join(_TEST_BASES) + r")(?:" + "|".join(g for g in _GLUE if g)
    + r")?\d*$"
)
_ROWS = ("qwertyuiop", "asdfghjkl", "zxcvbnm", "azertyuiop", "qsdfghjklm", "wxcvbn")
_HOME_ROW = set("asdfghjkl")
_VOWELS = set("aeiouy")
# Consonant pairs that are common across Latin-script languages. Any other
# consonant pair counts as an unpronounceable join.
_OK_PAIRS = set("""
bb bl br bs by ch ck cl cr ct cz dd dg dl dr ds dw dz ff fl fr ft gg gh gl gn gr gs hl hm hn hr ht hy
jj kh kk kl kn kr ks kt kw ll lb lc ld lf lg lk lm ln lp lr ls lt lv lw lz mb mm mn mp ms mt nc nd ng nh nj
nk nl nn ns nt nv nx ny nz ph pl pp pr ps pt rb rc rd rf rg rh rj rk rl rm rn rp rq rr rs rt rv rw rz sb sc
sh sk sl sm sn sp sq ss st sw sz th tl tm tn tr ts tt tw tz vr wh wl wn wr ws xp xt zh zz gy ly my py ry sy
ty vy wy dy fy ky ny cy by hy zy
""".split())


def check_enabled() -> bool:
    raw = os.environ.get("LEARNHOUSE_ORG_NAME_CHECK", "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    from src.core.deployment_mode import get_deployment_mode

    return get_deployment_mode() == "saas"


def _tokens(text: str) -> list[str]:
    # Split camelCase too: "TestOrg" -> "test", "org".
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", text or "")
    return [t for t in re.split(r"[^a-z0-9]+", spaced.lower()) if t]


def _mash(token: str) -> bool:
    """Four keys in a row of one keyboard row (asdf, wert, xcvb...)."""
    letters = re.sub(r"[^a-z]", "", token)
    return any(row[i:i + 4] in letters for row in _ROWS for i in range(len(row) - 3))


def _repeats(token: str) -> bool:
    """A 1-3 letter chunk said three times in a row that makes up much of the
    word (akakak..., hehehe, aaaaaaa), not a double letter in a real word."""
    if len(set(token)) <= 2:
        return True
    m = re.search(r"([a-z]{1,3})\1{2,}", token)
    return m is not None and len(m.group(1)) >= 2 and len(m.group(0)) >= 0.4 * len(token)


def gibberish(token: str) -> bool:
    """Random letters: keyboard mash, home-row smash, unpronounceable joins,
    digits stuck inside letters, or no vowel at all."""
    if not token.isascii() or len(token) < 6:
        return False
    letters = re.sub(r"[^a-z]", "", token)
    if len(letters) < 5:
        # Mostly digits ("4234234234fsdf" is caught below as a slug).
        return False
    if _mash(token) or _repeats(letters):
        return True
    if re.search(r"[a-z]{2,}\d+[a-z]{2,}", token) and len(letters) >= 6:
        joins = sum(1 for a, b in zip(letters, letters[1:])
                    if a not in _VOWELS and b not in _VOWELS and a + b not in _OK_PAIRS)
        if joins:
            return True
    if not (set(letters) & _VOWELS):
        return True
    if len(letters) >= 7 and set(letters) <= _HOME_ROW:
        return True
    pairs = list(zip(letters, letters[1:]))
    bad = sum(1 for a, b in pairs if a not in _VOWELS and b not in _VOWELS and a + b not in _OK_PAIRS)
    return len(letters) >= 7 and bad / len(pairs) >= 0.25 and bad >= 2


def _random_slug(slug: str) -> bool:
    s = re.sub(r"[^a-z0-9]", "", (slug or "").lower())
    return len(s) >= 8 and sum(c.isdigit() for c in s) / len(s) >= 0.7


def reasons(name: Optional[str], slug: Optional[str] = None) -> list[str]:
    """Why this name / slug looks like a throwaway (empty when it doesn't)."""
    out = []
    for label, text in (("name", name), ("address", slug)):
        tokens = _tokens(text or "")
        intl = next((w for w in re.split(r"[\W_]+", (text or "").lower()) if w in INTL_TEST_WORDS), None)
        hit = intl or next((t for t in tokens if t in TEST_WORDS or _TEST_TOKEN.match(t)), None)
        if hit:
            out.append(f"{label} contains “{hit}”")
            continue
        # Slugs are often words glued together (socworx, jdharmon): only the
        # name is judged for random letters; a slug only for a keyboard mash.
        words = [t for t in tokens if len(re.sub(r"[^a-z]", "", t)) >= 4]
        if label == "name":
            if words and all(gibberish(t) for t in words) and any(len(t) >= 6 for t in words):
                out.append("name looks like random letters")
        elif any(_mash(t) or _repeats(re.sub(r"[^a-z]", "", t)) and len(t) >= 6 for t in words):
            out.append("address looks like a keyboard mash")
        elif _random_slug(text or ""):
            out.append("address looks random")
    return out


def reject_throwaway_org_name(name: Optional[str], slug: Optional[str] = None) -> None:
    """400 for a test / demo / random-letters org name or slug."""
    if not check_enabled():
        return
    if reasons(name, slug):
        raise HTTPException(status_code=400, detail=REJECT_MESSAGE)
