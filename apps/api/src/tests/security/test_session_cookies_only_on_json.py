"""No API route may set session cookies on a response the browser follows directly.

The web app's auth route is the only thing that produces a session the web
client recognises: it re-sets the token cookies from the host the browser is
on and adds the readable ``LH_session`` marker the client checks before it
tries to restore a session. An API endpoint that set the token cookies on its
own redirect (the old admin magic-link consume) left users signed in
server-side and anonymous client-side, on a cookie domain guessed from headers
a custom-domain hairpin does not carry. Any sign-in that starts from a link
has to land on a web page that posts the credential to the API instead.

This reads the routers' source so the rule holds for endpoints that do not
exist yet.
"""

import ast
from pathlib import Path

import pytest

ROUTERS_DIR = Path(__file__).resolve().parents[2] / "routers"

SESSION_COOKIE_MARKERS = {
    "set_auth_cookies",
    "JWT_COOKIE_NAME",
    "JWT_REFRESH_COOKIE_NAME",
    "LH_access",
    "LH_refresh",
}


def _functions(tree: ast.AST):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield node


def _symbols(node: ast.AST) -> set[str]:
    """Every name, attribute and string literal used inside ``node``."""
    found: set[str] = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name):
            found.add(sub.id)
        elif isinstance(sub, ast.Attribute):
            found.add(sub.attr)
        elif isinstance(sub, ast.Constant) and isinstance(sub.value, str):
            found.add(sub.value)
    return found


@pytest.mark.parametrize(
    "path", sorted(ROUTERS_DIR.rglob("*.py")), ids=lambda p: str(p.relative_to(ROUTERS_DIR))
)
def test_session_cookies_only_on_json_responses(path: Path):
    tree = ast.parse(path.read_text(), filename=str(path))
    offenders = [
        fn.name
        for fn in _functions(tree)
        if "RedirectResponse" in _symbols(fn) and _symbols(fn) & SESSION_COOKIE_MARKERS
    ]
    assert not offenders, (
        f"{path.name}: {offenders} set session cookies on a redirect. Return the "
        "credential to a web page that posts it to the API (see /auth/magic) so the "
        "web app sets the cookies, including the LH_session marker, from the "
        "browser's own host."
    )


def test_guard_sees_the_routers():
    assert (ROUTERS_DIR / "admin.py").exists()
    assert (ROUTERS_DIR / "auth.py").exists()
