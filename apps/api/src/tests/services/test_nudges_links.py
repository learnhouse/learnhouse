"""Tests for src/services/nudges/links.py.

The point of this file is that every CTA in a nudge resolves. A broken link in
a lifecycle email fails silently — the recipient just leaves.
"""

import pytest

from src.services.nudges.links import (
    COURSE_SUBPAGES,
    course_editor_url,
    course_migrate_url,
    courses_url,
    dashboard_url,
    members_url,
    onboarding_url,
    org_settings_url,
    public_course_url,
    strip_course_prefix,
    unsubscribe_url,
)
from src.services.nudges.tokens import verify_unsubscribe_token

BASE = "https://acme.learnhouse.io"


def _all_urls():
    return [
        dashboard_url(BASE),
        courses_url(BASE),
        course_migrate_url(BASE),
        onboarding_url(BASE),
        members_url(BASE),
        org_settings_url(BASE),
        course_editor_url(BASE, "course_abc123", "content"),
        course_editor_url(BASE, "course_abc123", "general"),
        public_course_url(BASE, "course_abc123"),
    ]


class TestCoursePrefixTrap:
    def test_prefix_is_stripped(self):
        assert strip_course_prefix("course_abc123") == "abc123"

    def test_only_the_leading_prefix_is_stripped(self):
        # A uuid that happens to contain the substring later must keep it.
        assert strip_course_prefix("course_abccourse_123") == "abccourse_123"

    def test_bare_uuid_passes_through(self):
        assert strip_course_prefix("abc123") == "abc123"

    def test_empty_uuid_does_not_raise(self):
        assert strip_course_prefix("") == ""

    def test_no_built_url_leaks_the_stored_prefix(self):
        """The regression this module exists to prevent."""
        for url in _all_urls():
            assert "/course_" not in url, url

    def test_course_urls_use_the_bare_uuid(self):
        assert course_editor_url(BASE, "course_abc123") == (
            f"{BASE}/dash/courses/course/abc123/content"
        )
        assert public_course_url(BASE, "course_abc123") == f"{BASE}/course/abc123"


class TestRouteShapes:
    def test_every_url_is_absolute(self):
        for url in _all_urls():
            assert url.startswith("https://"), url

    def test_no_url_has_a_double_slash_in_its_path(self):
        for url in _all_urls():
            assert "//" not in url[len("https://") :], url

    @pytest.mark.parametrize("subpage", sorted(COURSE_SUBPAGES))
    def test_every_valid_subpage_builds(self, subpage):
        url = course_editor_url(BASE, "course_abc123", subpage)
        assert url.endswith(f"/{subpage}")

    def test_unknown_subpage_falls_back_to_content(self):
        """An unknown segment renders an empty tab rather than 404ing, which is
        harder to spot than a dead link — so refuse to emit one."""
        url = course_editor_url(BASE, "course_abc123", "does-not-exist")
        assert url.endswith("/content")

    def test_uuid_is_url_quoted(self):
        url = course_editor_url(BASE, "course_a b/c")
        assert " " not in url
        assert url.endswith("/a%20b%2Fc/content")

    def test_settings_subpage_is_quoted(self):
        assert org_settings_url(BASE, "general").endswith("/dash/org/settings/general")


class TestUnsubscribeUrl:
    def test_token_round_trips_from_the_built_url(self):
        url = unsubscribe_url("https://api.learnhouse.io", "user_abc")
        token = url.split("token=", 1)[1]
        assert verify_unsubscribe_token(token) == "user_abc"

    def test_points_at_the_api_endpoint(self):
        url = unsubscribe_url("https://api.learnhouse.io", "user_abc")
        assert url.startswith("https://api.learnhouse.io/api/v1/emails/unsubscribe?token=")

    def test_trailing_slash_on_the_base_is_tolerated(self):
        url = unsubscribe_url("https://api.learnhouse.io/", "user_abc")
        assert "//api/v1" not in url
