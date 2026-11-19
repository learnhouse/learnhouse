"""OSS email templates, one module per area. See ``registry.py``.

Templates take RAW values (names, URLs, messages as typed) and leave escaping
to the blocks. Copy comes from ``translations`` through ``th`` (HTML) and
``tt`` (plain text, for subjects).
"""

from __future__ import annotations

ACADEMY_URL = "https://university.learnhouse.io"

SAMPLE_ORG = {
    "org_name": "Northwind Academy",
    "logo_url": None,
    "brand_color": "#2563eb",
    "powered_by": True,
    "sender_name": "Northwind Academy",
}

