"""Landing pages built with the visual page builder.

One row per page of an organization: the home page (slug "") and, on plans
that allow it, extra pages (/p/about). Each keeps an autosaved ``draft``, the
``published`` document visitors see, and a history of versions (publishes,
restores, Atlas edits, variants, checkpoints). Contact form entries sent from
published pages are stored per page.

The home page is always a builder page. Classic landing configs are
converted once by ``src/services/landing/migrate_legacy.py``, which keeps the
old config in ``landing_legacy_backup`` for a rollback.
"""

from typing import Optional

from sqlalchemy import JSON, BigInteger, Column, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlmodel import Field, SQLModel


class LandingPage(SQLModel, table=True):
    __tablename__ = "landing_page"
    __table_args__ = (
        UniqueConstraint("org_id", "slug", name="uq_landing_page_org_slug"),
        Index("ix_landing_page_page_uuid", "page_uuid"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    page_uuid: str = Field(sa_column=Column(String(100), nullable=False))
    org_id: int = Field(sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False))
    # "" is the home page; extra pages use a URL slug ("about").
    slug: str = Field(default="", sa_column=Column(String(64), nullable=False, server_default=""))
    title: str = Field(default="", sa_column=Column(String(120), nullable=False, server_default=""))
    draft: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    # Bumped on every draft save; a save based on an older revision is refused
    # (two tabs, two admins) instead of silently overwriting.
    draft_revision: int = Field(default=1, sa_column=Column(Integer, nullable=False, server_default="1"))
    draft_updated_at: str = ""
    draft_updated_by: Optional[int] = Field(default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True))
    published: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    published_version: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default="0"))
    published_at: Optional[str] = None
    published_by: Optional[int] = Field(default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True))
    # Opens the draft on the public page for whoever has the link.
    preview_token: str = Field(default="", sa_column=Column(String(64), nullable=False, server_default=""))
    # Changes an agent (Atlas, an API token) made to the draft that a person
    # has not reviewed yet: {"by", "at", "base_version_uuid", "changes": [...]}.
    review: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    creation_date: str = ""
    update_date: str = ""


class LandingPageVersion(SQLModel, table=True):
    __tablename__ = "landing_page_version"
    __table_args__ = (Index("ix_landing_page_version_page_id", "page_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    version_uuid: str = Field(sa_column=Column(String(100), nullable=False))
    page_id: int = Field(sa_column=Column(Integer, ForeignKey("landing_page.id", ondelete="CASCADE"), nullable=False))
    org_id: int = Field(sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False))
    # publish | checkpoint | atlas | restore | variant | convert | template
    kind: str = Field(sa_column=Column(String(20), nullable=False))
    label: str = Field(default="", sa_column=Column(String(120), nullable=False, server_default=""))
    # The published version number for kind="publish".
    number: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default="0"))
    doc: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_by: Optional[int] = Field(default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True))
    creation_date: str = ""


class LandingFormSubmission(SQLModel, table=True):
    __tablename__ = "landing_form_submission"
    __table_args__ = (Index("ix_landing_form_submission_org_id", "org_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    submission_uuid: str = Field(sa_column=Column(String(100), nullable=False))
    org_id: int = Field(sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False))
    page_id: Optional[int] = Field(default=None, sa_column=Column(Integer, ForeignKey("landing_page.id", ondelete="CASCADE"), nullable=True))
    form_id: str = Field(default="", sa_column=Column(String(40), nullable=False, server_default=""))
    data: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    creation_date: str = ""


class LandingLegacyBackup(SQLModel, table=True):
    """The classic landing config an org had before the one-time conversion
    to the page builder (src/services/landing/migrate_legacy.py). One row per
    org: it records what happened and keeps the old config for a rollback."""

    __tablename__ = "landing_legacy_backup"
    __table_args__ = (UniqueConstraint("org_id", name="uq_landing_legacy_backup_org"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False))
    # The org config's landing object as it was (None: the org had none).
    legacy: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    # running | converted | default | skipped | failed | rolled_back
    status: str = Field(default="running", sa_column=Column(String(20), nullable=False, server_default="running"))
    page_uuid: str = Field(default="", sa_column=Column(String(100), nullable=False, server_default=""))
    attempts: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default="0"))
    error: str = Field(default="", sa_column=Column(String(1000), nullable=False, server_default=""))
    creation_date: str = ""
    update_date: str = ""


class LandingSavedSection(SQLModel, table=True):
    """A section an admin saved to reuse on any page of the organization
    (the builder's "Saved" library). ``node`` is one top-level section, with
    the symbols it uses copied alongside so it renders the same anywhere."""

    __tablename__ = "landing_saved_section"
    __table_args__ = (Index("ix_landing_saved_section_org_id", "org_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    section_uuid: str = Field(sa_column=Column(String(100), nullable=False))
    org_id: int = Field(sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False))
    name: str = Field(default="", sa_column=Column(String(80), nullable=False, server_default=""))
    node: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    symbols: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_by: Optional[int] = Field(default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True))
    creation_date: str = ""
    update_date: str = ""
