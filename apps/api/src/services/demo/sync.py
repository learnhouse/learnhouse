"""Bring the demo organization into line with the bundle.

One function, ``sync_demo``, does both jobs the demo needs: it builds the
organization the first time, and it puts it back afterwards. There is
deliberately no separate "provision" and "refresh" implementation — two code
paths that must produce identical results are two code paths that eventually
do not, and the property this whole design rests on is that running the sync
twice in a row changes nothing.

That property is why the module is written the way it is:

* Rows are matched to bundle entries through the ``DemoEntity`` registry, so a
  second run finds and updates rather than duplicating.
* Fields are compared before assignment (``_apply``), so an unchanged row emits
  no UPDATE at all rather than an UPDATE that happens to write the same values.
* Timestamps are derived from ``content_epoch``, which rolls once a day, not
  from ``now``. Recomputing from the clock would change every backdated row on
  every tick.
* Media is uploaded only when the row does not already reference a file.

Anything inside the demo org without a registry entry was created by a visitor
and is deleted as drift.
"""

import logging
import secrets
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from functools import lru_cache
from typing import Any, NamedTuple, Optional
from uuid import UUID, uuid4, uuid5

from sqlalchemy import delete, func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.ai.generations import AIGeneration
from src.db.api_tokens import APIToken
from src.db.boards import Board
from src.db.communities.communities import Community
from src.db.communities.discussion_comment_votes import DiscussionCommentVote
from src.db.communities.discussion_comments import DiscussionComment
from src.db.communities.discussion_reactions import DiscussionReaction
from src.db.communities.discussion_votes import DiscussionVote
from src.db.communities.discussions import Discussion
from src.db.courses.activity_versions import ActivityVersion
from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentUserSubmission,
)
from src.db.courses.blocks import Block
from src.db.courses.certifications import CertificateUser, Certifications
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.course_updates import CourseUpdate
from src.db.courses.courses import Course, ThumbnailType
from src.db.demo_entities import DemoEntity, DemoEntityKind
from src.db.demo_state import DEMO_STATE_ID, DemoState, DemoStateEnum
from src.db.folders.folder_content import FolderContent
from src.db.folders.folders import Folder
from src.db.organization_config import OrganizationConfig
from src.db.media.media import Media
from src.db.media.media_share_token import MediaShareToken
from src.db.organizations import Organization
from src.db.playground_reactions import PlaygroundReaction
from src.db.playgrounds import Playground
from src.db.roles import Role
from src.db.podcasts.episodes import PodcastEpisode
from src.db.podcasts.podcasts import Podcast
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.db.user_activity import UserActivityDay
from src.db.user_audit_events import UserAuditEvent
from src.db.user_organizations import UserOrganization
from src.db.webhooks import WebhookEndpoint
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import User
from src.security.security import security_hash_password
from src.services.demo import flags
from src.services.demo.bundle_loader import Bundle, get_bundle
from src.services.demo.progress import (
    HISTORY_DAYS,
    StudentPlan,
    activity_days,
    completed_activity_count,
    epoch_for,
    grade_for,
    plan_students,
    step_timestamp,
    submission_status_for,
    submission_template_for,
)
from src.services.demo.registry import Registry

logger = logging.getLogger(__name__)

# Role 4 is the read-only learner role installed by services/setup/setup.py.
# Every fake student sits here. Instructors (role 3) would count against
# admin_seats, whose limit cannot be raised by config overrides, and the demo's
# own Plan & Usage page would then read "limit reached".
LEARNER_ROLE_ID = 4


class _Sweep(NamedTuple):
    """One entry in the drift table: a model, its uuid column, its registry kind.

    Named rather than a bare 3-tuple so the loop reads as what it is. It also
    keeps CodeQL honest: unpacking anonymous tuples let its taint analysis
    conflate the elements, and it reported the sweep's `kind` — a constant like
    "course" — as a password being written to the log.
    """

    model: Any
    uuid_column: Any
    kind: str


@dataclass
class SyncStats:
    created: int = 0
    updated: int = 0
    drift_deleted: int = 0
    steps: list[str] = field(default_factory=list)
    epoch: str = ""
    provisioned: bool = False

    def as_dict(self) -> dict:
        return {
            "created": self.created,
            "updated": self.updated,
            "drift_deleted": self.drift_deleted,
            "epoch": self.epoch,
            "provisioned": self.provisioned,
        }


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    # Timestamps are stored as str(datetime.now()) throughout this codebase;
    # services/nudges/snapshot.py parses them back in exactly that format.
    return str(datetime.now())


def _apply(instance: Any, **fields: Any) -> bool:
    """Assign only the fields that differ. Returns True if anything changed.

    The comparison is the point. Assigning an equal value still marks the
    attribute dirty in SQLAlchemy and emits an UPDATE on flush, which would
    turn every no-op refresh into several hundred pointless writes.
    """
    changed = False
    for name, value in fields.items():
        if getattr(instance, name) != value:
            setattr(instance, name, value)
            changed = True
    return changed


@lru_cache(maxsize=1)
def _unusable_password_hash() -> str:
    """A valid Argon2 hash of a secret that is generated and then discarded.

    Not an empty string: pwdlib raises UnknownHashError when it cannot identify
    a stored hash, and authenticate_user does not guard that call — so an empty
    password would turn a login attempt against a demo student into a 500
    rather than a clean 401.

    One hash is shared by all forty students. No plaintext for it exists
    anywhere, so sharing leaks nothing, and it saves forty Argon2 runs on every
    provision.
    """
    return security_hash_password(secrets.token_urlsafe(64))


def _prefixed(prefix: str) -> str:
    return f"{prefix}_{uuid4()}"


def _days_ago(epoch: str, days: float, hour: int = 10) -> str:
    anchor = datetime.combine(date.fromisoformat(epoch), datetime.min.time())
    return str((anchor - timedelta(days=days)).replace(hour=hour))


# ---------------------------------------------------------------------------
# organization configuration
# ---------------------------------------------------------------------------

def _demo_org_config() -> dict:
    """Config for the demo org: the pro plan, with the rest forced on.

    The demo exists to show the product, so it runs on `pro` — the tier that
    enables boards, playgrounds, communities, podcasts, collaboration,
    certifications, roles, versioning, webhooks, the API and analytics. Anything
    a prospect cannot see is a feature they will not buy.

    `overrides` then force on what even pro withholds (audit logs, SCORM, SSO
    are enterprise) and lift the seat and AI ceilings, because
    resolve_feature computes `available = plan_enabled or force_enabled` and
    adds `extra_limit` on top of the plan's number.

    **Running on a paid plan is safe only because the demo is excluded from the
    money paths, and those exclusions are load-bearing:**

    * `_enforce_free_org_cap` filters demo orgs out of the caller's admin orgs
      entirely, so a paid demo cannot mark a visitor "a customer, not
      free-tier" and permanently exempt them from the three-org cap on their
      own real organizations. That filter is what makes this line safe to
      change; without it, pro here would quietly hand every visitor unlimited
      free organizations.
    * `get_active_user_summary` returns a zeroed summary reporting plan
      "demo", which is not in the frontend's BILLABLE_PLANS — two independent
      barriers between synthetic activity and a Stripe invoice.
    * The billing routes and the plan-write endpoint refuse demo orgs, so a
      visitor cannot buy a subscription for a shared sandbox.

    Analytics is enabled because it is part of pro and a prospect should see
    the page exists; it is backed by Tinybird, which the demo does not write
    to, so it will look sparse unless the deployment has Tinybird configured.
    That is a known and deliberate limitation rather than an oversight.
    """
    return {
        "config_version": "2.0",
        "active": True,
        "plan": "pro",
        "admin_toggles": {
            "members": {"signup_mode": "inviteOnly"},
        },
        "overrides": {
            # Pro already gives unlimited courses/assignments and 500 members;
            # these keep headroom as visitors accumulate.
            "members": {"extra_limit": 500},
            # Enterprise tiers the demo can show safely.
            #
            # audit_logs, scorm and sso are deliberately NOT here. Every
            # visitor is an admin of this org, and those three surfaces are
            # served by Enterprise routers that know nothing about the demo:
            # they have no is_demo guard, and none of their tables is in the
            # drift sweep. The audit one is the sharp case — the sync sweeps
            # UserAuditEvent and the audit router hides other visitors
            # precisely so one prospect cannot read another's identity, and
            # force-enabling the Enterprise audit surface would hand it back.
            # A prospect missing three settings pages is a cheaper loss.
            "analytics_advanced": {"force_enabled": True},
            "custom_domains": {"force_enabled": True},
            # Belt and braces: these are all enabled by pro, but stating them
            # means a future change to the plan table cannot quietly remove a
            # feature from the demo.
            "usergroups": {"force_enabled": True},
            "collaboration": {"force_enabled": True},
            "certifications": {"force_enabled": True},
            "versioning": {"force_enabled": True},
            "roles": {"force_enabled": True},
            "communities": {"force_enabled": True},
            "boards": {"force_enabled": True},
            "playgrounds": {"force_enabled": True},
            "podcasts": {"force_enabled": True},
            "webhooks": {"force_enabled": True},
            # Only where the storefront can actually be seeded AND swept.
            # Turning the feature on while the sweep is off is worse than
            # having no storefront: every visitor is an admin, so one of them
            # can point the demo's payments config at their own account and
            # publish an offer against a bundle course, and nothing would ever
            # take it down. The next prospect would meet a real checkout.
            "payments": {"force_enabled": _store_unsupported_reason() is None},
            "api": {"force_enabled": True},
            "seo": {"force_enabled": True},
            "analytics": {"force_enabled": True},
        },
        "customization": {},
    }


# ---------------------------------------------------------------------------
# the sync
# ---------------------------------------------------------------------------

async def sync_demo(
    db_session: AsyncSession,
    *,
    today: Optional[date] = None,
) -> SyncStats:
    """Create or refresh the shared demo organization.

    Safe to call repeatedly. On a settled demo it reads a few hundred rows and
    writes none.

    A failure is recorded on the state row before being re-raised, so
    `demo-status` reports the truth. Without that the row keeps its last
    successful values and an operator looking at a demo that has been broken
    for hours sees state READY and no error.
    """
    # Read before the run so the failure handler can tell "nobody else has
    # touched the state row" from "another replica finished a good sync while
    # mine was failing". Without it the loser of that race marks a demo that is
    # currently healthy as FAILED.
    started_from = await _state_token(db_session)

    try:
        return await _sync_demo_inner(db_session, today=today)
    except Exception as exc:
        await _record_sync_failure(db_session, exc, started_from=started_from)
        raise


async def _state_token(db_session: AsyncSession) -> Optional[str]:
    """The state row's last write, as a value that changes on every sync."""
    try:
        return (
            await db_session.execute(
                select(DemoState.update_date).where(DemoState.id == DEMO_STATE_ID)
            )
        ).scalars().first()
    except Exception:  # pragma: no cover - defensive
        return None


async def _record_sync_failure(
    db_session: AsyncSession, exc: Exception, *, started_from: Optional[str] = None
) -> None:
    """Persist a failed run on the state row, in its own transaction.

    The sync's own transaction is being rolled back, so the failure has to be
    written after that — otherwise it would be discarded along with the partial
    work it is describing. Never raises: losing the error record must not
    replace the original exception with a less useful one.
    """
    try:
        await db_session.rollback()
        state = await _load_state(db_session)

        # The rollback means this row is re-read now, not as it was when the
        # run started — so another replica's successful run may already have
        # committed READY over it. Marking a demo that is currently healthy as
        # FAILED would be worse than losing the error: the status endpoint
        # reports it and the entry point hides the demo on that basis. The
        # error is recorded either way; only the state is withheld.
        # `started_from is None` means there was no state row when this run
        # began — the first provision. That is precisely the run where the race
        # is most likely, not least: several replicas reach the INSERT on a
        # unique slug together, one wins and writes READY, and the losers would
        # each stamp FAILED over it. So a row that is READY now is treated as
        # somebody else's success whether or not one existed at the start.
        overtaken = state.state == DemoStateEnum.READY and (
            started_from is None or state.update_date != started_from
        )

        state.last_error = f"{type(exc).__name__}: {exc}"[:1000]
        if overtaken:
            logger.warning(
                "Demo sync failed, but another run has since succeeded; "
                "recording the error without marking the demo failed"
            )
        else:
            state.state = DemoStateEnum.FAILED
        state.update_date = _now()
        db_session.add(state)
        await db_session.commit()
    except Exception:  # pragma: no cover - best effort
        logger.exception("Could not record the demo sync failure")


async def _sync_demo_inner(
    db_session: AsyncSession,
    *,
    today: Optional[date] = None,
) -> SyncStats:
    bundle = get_bundle()
    stats = SyncStats()

    state = await _load_state(db_session)
    reprovision = state.bundle_version != bundle.manifest.bundle_version

    epoch = _resolve_epoch(state, today=today)
    stats.epoch = epoch

    org, created_org = await _sync_org(db_session, bundle, stats)
    stats.provisioned = created_org or reprovision

    registry = await Registry.load(org.id, db_session)

    await _sync_branding(db_session, bundle, org, registry, stats)
    students = plan_students(bundle, epoch)
    users_by_key = await _sync_students(db_session, bundle, org, registry, students, stats)
    await _sync_cohorts(db_session, bundle, org, registry, students, users_by_key, stats)
    courses_by_key = await _sync_courses(db_session, bundle, org, registry, epoch, stats)
    await _sync_sections(db_session, bundle, org, registry, courses_by_key, stats)
    await _sync_assignments(db_session, bundle, org, registry, epoch, stats)
    await _sync_certifications(db_session, bundle, org, registry, courses_by_key, stats)
    await _sync_course_updates(db_session, bundle, org, registry, epoch, courses_by_key, stats)
    await _sync_engagement(db_session, bundle, org, registry, epoch, users_by_key, stats)
    # The storefront is the one part of the demo whose code lives in another
    # repository on its own release cadence, so it can break on a version skew
    # that nothing here or in CI would catch. A failure there must cost the
    # storefront, not the entire demo: six courses, forty learners and the
    # grading inbox are the sales asset, and a demo that refuses to exist
    # because one optional feature drifted is the worse outcome.
    #
    # Deliberately narrow — the surrounding phases stay fatal, because a
    # failure in any of them means the demo is wrong rather than incomplete.
    # Inside a savepoint, not a bare try: a statement that fails mid-step
    # aborts the surrounding transaction on Postgres, so catching the exception
    # without rolling back to a savepoint would leave every later phase failing
    # on "current transaction is aborted".
    try:
        async with db_session.begin_nested():
            await _sync_store(
                db_session, bundle, org, registry, epoch, users_by_key, stats
            )
    except Exception as exc:
        stats.steps.append("store:failed")
        logger.exception(
            "Demo store step failed; continuing without a storefront: %s", exc
        )

    await db_session.flush()

    # Anything the bundle no longer declares stops being bundle-owned here, so
    # the drift pass below removes the row itself. Must run before that pass,
    # not after: a registry entry is what shields a row from being treated as
    # visitor drift.
    forgotten = await registry.prune_removed_from_bundle(db_session)
    if forgotten:
        logger.info("Demo: forgot %s entry(ies) dropped from the bundle", forgotten)

    await _delete_drift(db_session, org, registry, stats)
    await _sync_progress(
        db_session, bundle, org, registry, epoch, students, users_by_key, stats
    )

    await _assert_single_tenant(db_session, org)
    await _finalize(db_session, state, org, bundle, epoch, stats)

    await db_session.commit()
    return stats


async def _load_state(db_session: AsyncSession) -> DemoState:
    state = (
        await db_session.execute(select(DemoState).where(DemoState.id == DEMO_STATE_ID))
    ).scalars().first()
    if state is None:
        state = DemoState(
            id=DEMO_STATE_ID,
            state=DemoStateEnum.PROVISIONING,
            creation_date=_now(),
            update_date=_now(),
        )
        db_session.add(state)
    return state


def _resolve_epoch(state: DemoState, today: Optional[date] = None) -> str:
    """The date anchor for all generated timestamps.

    Rolls once a day. Hourly refreshes reuse the stored value and therefore
    recompute identical timestamps; if this returned today's date unconditionally
    it would still only change daily, but reading it from state keeps the roll
    explicit and testable.
    """
    current = today or datetime.utcnow().date()
    if not state.content_epoch:
        return epoch_for(current)
    stored = date.fromisoformat(state.content_epoch)
    if stored < current:
        return epoch_for(current)
    return state.content_epoch


# --- organization -----------------------------------------------------------

async def _sync_org(
    db_session: AsyncSession, bundle: Bundle, stats: SyncStats
) -> tuple[Organization, bool]:
    stats.steps.append("org")
    slug = flags.demo_slug()
    spec = bundle.manifest.org

    org = (
        await db_session.execute(select(Organization).where(Organization.slug == slug))
    ).scalars().first()

    created = False
    if org is None:
        org = Organization(
            name=spec.name,
            description=spec.description,
            about=spec.about,
            email=spec.email,
            slug=slug,
            org_uuid=_prefixed("org"),
            is_demo=True,
            explore=False,
            creation_date=_now(),
            update_date=_now(),
        )
        db_session.add(org)
        await db_session.flush()
        created = True
        stats.created += 1
    else:
        if not org.is_demo:
            # Refusing rather than taking it over: the slug may belong to a real
            # organization on this install, and converting someone's org into
            # the demo would delete its content as drift on the next tick.
            raise RuntimeError(
                f"organization {slug!r} already exists and is not a demo org; "
                f"set LEARNHOUSE_DEMO_SLUG to something else"
            )
        # update_date is deliberately not part of the comparison — it is always
        # "now" and would make every field look changed, which is the exact
        # failure _apply exists to prevent.
        if _apply(
            org,
            name=spec.name,
            description=spec.description,
            about=spec.about,
            email=spec.email,
            explore=False,
            # Reset to empty every refresh. OrgScripts injects each entry as a
            # real <script> element for every visitor to the org, so anything
            # left here is code running in a stranger's browser. update_org
            # refuses to set it on a demo org; this repairs anything that got
            # in another way, and means the window is one tick rather than
            # forever.
            scripts={},
            # Same treatment: previews are visitor-uploadable images and video
            # shown on the org's public landing page. The bundle sets none, so
            # anything here arrived from a visitor.
            previews={},
        ):
            org.update_date = _now()
            db_session.add(org)
            stats.updated += 1

    config = (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )
    ).scalars().first()
    desired = _demo_org_config()
    if config is None:
        db_session.add(
            OrganizationConfig(
                org_id=org.id,
                config=desired,
                creation_date=_now(),
                update_date=_now(),
            )
        )
        stats.created += 1
    elif config.config != desired:
        config.config = desired
        config.update_date = _now()
        db_session.add(config)
        stats.updated += 1

    return org, created


# --- media ------------------------------------------------------------------

#: Fixed namespace for derived upload filenames. Never change it — every stored
#: logo, thumbnail and avatar reference is computed from it.
_UPLOAD_NAMESPACE = UUID("2b7c1f52-9a44-5c6e-8d31-70e5a4c9b18f")


def _upload_name(*, uuid: str, directory: str, name: str, version: str = "") -> str:
    """The filename a bundle asset always lands on, derived rather than drawn.

    A random name would be unknowable to a later refresh, which is what let a
    visitor's replacement image stick: the sync could only ask "is this column
    empty?", and an overwritten column is not empty. Deriving the name makes
    the correct value computable, so the column can be reverted like any other
    bundle-managed field.

    The bundle version is part of the key, which is how new artwork reaches an
    existing demo. Every media write is guarded by "does the column already
    name this file?", so without the version a redrawn logo shipped under the
    same bundle filename would be computed to the same name, match, and never
    upload. Bumping bundle_version changes every derived name, so each asset is
    written once more and every reference moves with it.
    """
    key = f"{uuid}:{directory}:{name}:{version}"
    return f"{uuid5(_UPLOAD_NAMESPACE, key)}_{name}"


async def _upload(
    *,
    directory: str,
    type_of_dir: str,
    uuid: str,
    source_path: str,
    name: str,
    version: str = "",
    allowed_formats: Optional[list[str]] = None,
) -> str:
    """Copy a bundle image into org/user storage through the normal funnel.

    Uses upload_content rather than upload_file because there is no UploadFile
    here — just bytes on disk — and the same funnel handles both the filesystem
    and S3 backends.
    """
    from src.services.utils.upload_content import upload_content

    with open(source_path, "rb") as handle:
        payload = handle.read()

    filename = _upload_name(
        uuid=uuid, directory=directory, name=name, version=version
    )
    await upload_content(
        directory=directory,
        type_of_dir=type_of_dir,  # type: ignore[arg-type]
        uuid=uuid,
        file_binary=payload,
        file_and_format=filename,
        allowed_formats=allowed_formats or ["webp", "png", "jpg", "jpeg"],
    )
    return filename


async def _sync_branding(
    db_session: AsyncSession,
    bundle: Bundle,
    org: Organization,
    registry: Registry,
    stats: SyncStats,
) -> None:
    """Put the org logo and banner back to the bundle's, uploading when needed.

    The column is compared against the filename the bundle asset derives, not
    merely checked for emptiness. Emptiness was the wrong question: a visitor
    who uploads their own logo through the org settings leaves a non-empty
    column, so the demo kept their branding permanently — the one piece of the
    org every prospect sees first.

    The upload itself still happens only when the column does not already name
    the derived file, so a settled demo writes nothing and S3 gains no orphans.
    """
    stats.steps.append("branding")
    changed = False

    for column, directory, source, name in (
        ("logo_image", "logos", bundle.manifest.org.logo, "logo.webp"),
        ("thumbnail_image", "thumbnails", bundle.manifest.org.thumbnail, "thumbnail.webp"),
    ):
        expected = _upload_name(
            uuid=org.org_uuid,
            directory=directory,
            name=name,
            version=bundle.manifest.bundle_version,
        )
        if getattr(org, column) == expected:
            continue
        setattr(
            org,
            column,
            await _upload(
                directory=directory,
                type_of_dir="orgs",
                uuid=org.org_uuid,
                source_path=bundle.media_path(source),
                name=name,
                version=bundle.manifest.bundle_version,
            ),
        )
        changed = True

    if changed:
        org.update_date = _now()
        db_session.add(org)
        stats.updated += 1


# --- students ---------------------------------------------------------------

async def _sync_students(
    db_session: AsyncSession,
    bundle: Bundle,
    org: Organization,
    registry: Registry,
    students: list[StudentPlan],
    stats: SyncStats,
) -> dict[str, User]:
    stats.steps.append("students")
    users: dict[str, User] = {}

    for plan in students:
        entry = registry.get(DemoEntityKind.USER, plan.bundle_key)
        user: Optional[User] = None
        if entry is not None:
            user = (
                await db_session.execute(select(User).where(User.id == entry.entity_id))
            ).scalars().first()

        if user is None:
            user = User(
                username=plan.username,
                first_name=plan.first_name,
                last_name=plan.last_name,
                email=plan.email,
                password=_unusable_password_hash(),
                user_uuid=entry.entity_uuid if entry else _prefixed("user"),
                email_verified=True,
                email_verified_at=_now(),
                signup_method=flags.DEMO_SIGNUP_METHOD,
                creation_date=_days_ago(stats.epoch, plan.joined_days_ago),
                update_date=_now(),
            )
            db_session.add(user)
            await db_session.flush()
            stats.created += 1

        else:
            if _apply(
                user,
                first_name=plan.first_name,
                last_name=plan.last_name,
                email=plan.email,
                username=plan.username,
                signup_method=flags.DEMO_SIGNUP_METHOD,
            ):
                user.update_date = _now()
                db_session.add(user)
                stats.updated += 1

        # Avatars are reconciled for every student, not only on the run that
        # creates one. Writing them on the create branch alone meant a photo a
        # visitor swapped through the admin UI was permanent, and new bundle
        # artwork never reached an existing demo.
        if plan.avatar:
            expected_avatar = _upload_name(
                uuid=user.user_uuid,
                directory="avatars",
                name="avatar.webp",
                version=bundle.manifest.bundle_version,
            )
            if user.avatar_image != expected_avatar:
                user.avatar_image = await _upload(
                    directory="avatars",
                    type_of_dir="users",
                    uuid=user.user_uuid,
                    source_path=bundle.media_path("avatars", plan.avatar),
                    name="avatar.webp",
                    version=bundle.manifest.bundle_version,
                )
                db_session.add(user)
                stats.updated += 1
        elif user.avatar_image:
            # The bundle gives this persona no picture on purpose — a real org
            # is full of people who never uploaded one.
            user.avatar_image = ""
            db_session.add(user)
            stats.updated += 1

        registry.register(
            db_session,
            kind=DemoEntityKind.USER,
            bundle_key=plan.bundle_key,
            entity_id=user.id,  # type: ignore[arg-type]
            entity_uuid=user.user_uuid,
            org_id=org.id,  # type: ignore[arg-type]
        )
        users[plan.bundle_key] = user

        membership = (
            await db_session.execute(
                select(UserOrganization).where(
                    UserOrganization.user_id == user.id,
                    UserOrganization.org_id == org.id,
                )
            )
        ).scalars().first()
        if membership is None:
            db_session.add(
                UserOrganization(
                    user_id=user.id,
                    org_id=org.id,
                    role_id=LEARNER_ROLE_ID,
                    creation_date=_days_ago(stats.epoch, plan.joined_days_ago),
                    update_date=_now(),
                )
            )
            stats.created += 1

    return users


# --- cohorts ----------------------------------------------------------------

async def _sync_cohorts(
    db_session: AsyncSession,
    bundle: Bundle,
    org: Organization,
    registry: Registry,
    students: list[StudentPlan],
    users: dict[str, User],
    stats: SyncStats,
) -> None:
    stats.steps.append("cohorts")

    for cohort in bundle.manifest.cohorts:
        entry = registry.get(DemoEntityKind.USERGROUP, cohort.slug)
        group: Optional[UserGroup] = None
        if entry is not None:
            group = (
                await db_session.execute(
                    select(UserGroup).where(UserGroup.id == entry.entity_id)
                )
            ).scalars().first()

        if group is None:
            group = UserGroup(
                name=cohort.name,
                description=cohort.description,
                org_id=org.id,
                usergroup_uuid=entry.entity_uuid if entry else _prefixed("usergroup"),
                creation_date=_now(),
                update_date=_now(),
            )
            db_session.add(group)
            await db_session.flush()
            stats.created += 1
        elif _apply(group, name=cohort.name, description=cohort.description):
            group.update_date = _now()
            db_session.add(group)
            stats.updated += 1

        registry.register(
            db_session,
            kind=DemoEntityKind.USERGROUP,
            bundle_key=cohort.slug,
            entity_id=group.id,  # type: ignore[arg-type]
            entity_uuid=group.usergroup_uuid,
            org_id=org.id,  # type: ignore[arg-type]
        )

        wanted_user_ids = {
            users[plan.bundle_key].id
            for plan in students
            if plan.cohort_key == cohort.slug and plan.bundle_key in users
        }
        existing = (
            await db_session.execute(
                select(UserGroupUser).where(UserGroupUser.usergroup_id == group.id)
            )
        ).scalars().all()
        existing_ids = {row.user_id for row in existing}

        for user_id in wanted_user_ids - existing_ids:
            db_session.add(
                UserGroupUser(
                    usergroup_id=group.id,
                    user_id=user_id,
                    org_id=org.id,
                    creation_date=_now(),
                    update_date=_now(),
                )
            )
            stats.created += 1

        stale = [row for row in existing if row.user_id not in wanted_user_ids]
        if stale:
            await db_session.execute(
                delete(UserGroupUser).where(
                    UserGroupUser.id.in_([row.id for row in stale])
                )
            )
            stats.updated += len(stale)


# --- courses ----------------------------------------------------------------

async def _sync_courses(
    db_session: AsyncSession,
    bundle: Bundle,
    org: Organization,
    registry: Registry,
    epoch: str,
    stats: SyncStats,
) -> dict[str, Course]:
    stats.steps.append("courses")
    courses: dict[str, Course] = {}

    for course_spec in bundle.courses:
        entry = registry.get(DemoEntityKind.COURSE, course_spec.slug)
        course: Optional[Course] = None
        if entry is not None:
            course = (
                await db_session.execute(
                    select(Course).where(Course.id == entry.entity_id)
                )
            ).scalars().first()

        if course is None:
            course = Course(
                name=course_spec.name,
                description=course_spec.description,
                about=course_spec.about,
                learnings=course_spec.learnings,
                tags=course_spec.tags,
                thumbnail_type=ThumbnailType.IMAGE,
                thumbnail_image="",
                thumbnail_video="",
                public=course_spec.public,
                published=course_spec.published,
                open_to_contributors=False,
                org_id=org.id,
                # Reuse the registered uuid when a visitor deleted the course:
                # its thumbnail is still on disk under that path, so it does not
                # need re-uploading.
                course_uuid=entry.entity_uuid if entry else _prefixed("course"),
                creation_date=_days_ago(epoch, HISTORY_DAYS + 30),
                update_date=_now(),
            )
            db_session.add(course)
            await db_session.flush()
            stats.created += 1
        elif _apply(
            course,
            name=course_spec.name,
            description=course_spec.description,
            about=course_spec.about,
            learnings=course_spec.learnings,
            tags=course_spec.tags,
            public=course_spec.public,
            published=course_spec.published,
            # Reverted alongside the image below. Uploading a video thumbnail
            # switches thumbnail_type to VIDEO, and the catalogue then renders
            # thumbnail_video — so restoring only thumbnail_image left the
            # visitor's video playing on the course card.
            thumbnail_type=ThumbnailType.IMAGE,
            thumbnail_video="",
        ):
            course.update_date = _now()
            db_session.add(course)
            stats.updated += 1

        # Compared against the derived name rather than checked for emptiness,
        # so a thumbnail a visitor swaps through the course settings is put
        # back on the next refresh instead of becoming permanent.
        thumbnail_dir = f"courses/{course.course_uuid}/thumbnails"
        expected_thumbnail = _upload_name(
            uuid=org.org_uuid,
            directory=thumbnail_dir,
            name="thumbnail.webp",
            version=bundle.manifest.bundle_version,
        )
        if course.thumbnail_image != expected_thumbnail:
            course.thumbnail_image = await _upload(
                directory=thumbnail_dir,
                type_of_dir="orgs",
                uuid=org.org_uuid,
                source_path=bundle.media_path("courses", course_spec.thumbnail),
                name="thumbnail.webp",
                version=bundle.manifest.bundle_version,
            )
            db_session.add(course)
            stats.updated += 1

        registry.register(
            db_session,
            kind=DemoEntityKind.COURSE,
            bundle_key=course_spec.slug,
            entity_id=course.id,  # type: ignore[arg-type]
            entity_uuid=course.course_uuid,
            org_id=org.id,  # type: ignore[arg-type]
        )
        courses[course_spec.slug] = course

        await _sync_resource_author(db_session, course, org, stats)
        await _sync_chapters(db_session, course_spec, course, org, registry, epoch, stats)

    return courses


async def _sync_resource_author(
    db_session: AsyncSession, course: Course, org: Organization, stats: SyncStats
) -> None:
    await _sync_resource_author_for(db_session, course.course_uuid, org, stats)


async def _sync_resource_author_for(
    db_session: AsyncSession, resource_uuid: str, org: Organization, stats: SyncStats
) -> None:
    """Attribute a resource to one of the seeded demo people.

    Courses and podcasts without an author render with an empty byline.

    Deliberately a demo student rather than "the org's first admin": the sync
    never creates an admin, so the first admin is the first *visitor* — and
    attributing every course and podcast to them publishes a real person's name
    and email as the author of content they have never seen. The byline belongs
    to a fictional person because the content is fictional.
    """
    admin_id = (
        await db_session.execute(
            select(UserOrganization.user_id)
            .join(User, User.id == UserOrganization.user_id)
            .where(
                UserOrganization.org_id == org.id,
                User.signup_method == flags.DEMO_SIGNUP_METHOD,
            )
            .order_by(UserOrganization.id)
            .limit(1)
        )
    ).scalars().first()
    if admin_id is None:
        return

    rows = (
        await db_session.execute(
            select(ResourceAuthor).where(
                ResourceAuthor.resource_uuid == resource_uuid
            )
        )
    ).scalars().all()

    existing = next((row for row in rows if row.user_id == admin_id), None)
    if existing is None:
        db_session.add(
            ResourceAuthor(
                resource_uuid=resource_uuid,
                user_id=admin_id,
                authorship=ResourceAuthorshipEnum.CREATOR,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=_now(),
                update_date=_now(),
            )
        )
        stats.created += 1

    # Authorship on bundle content is the bundle's to decide. Adding a
    # contributor is an ordinary admin action and every visitor is an admin, so
    # without this a visitor could put their own name — or, since the
    # contributor endpoint resolves usernames globally with no org scoping, any
    # username on the platform — permanently on a demo course's byline.
    intruders = [row.id for row in rows if row.user_id != admin_id and row.id]
    if intruders:
        await db_session.execute(
            delete(ResourceAuthor).where(ResourceAuthor.id.in_(intruders))
        )
        stats.drift_deleted += len(intruders)


async def _sync_chapters(
    db_session: AsyncSession,
    course_spec: Any,
    course: Course,
    org: Organization,
    registry: Registry,
    epoch: str,
    stats: SyncStats,
) -> None:
    for order, chapter_spec in enumerate(course_spec.chapters):
        entry = registry.get(DemoEntityKind.CHAPTER, chapter_spec.slug)
        chapter: Optional[Chapter] = None
        if entry is not None:
            chapter = (
                await db_session.execute(
                    select(Chapter).where(Chapter.id == entry.entity_id)
                )
            ).scalars().first()

        if chapter is None:
            chapter = Chapter(
                name=chapter_spec.name,
                description=chapter_spec.description,
                thumbnail_image="",
                org_id=org.id,
                course_id=course.id,
                chapter_uuid=entry.entity_uuid if entry else _prefixed("chapter"),
                creation_date=_days_ago(epoch, HISTORY_DAYS + 28),
                update_date=_now(),
            )
            db_session.add(chapter)
            await db_session.flush()
            stats.created += 1
        elif _apply(
            chapter, name=chapter_spec.name, description=chapter_spec.description
        ):
            chapter.update_date = _now()
            db_session.add(chapter)
            stats.updated += 1

        registry.register(
            db_session,
            kind=DemoEntityKind.CHAPTER,
            bundle_key=chapter_spec.slug,
            entity_id=chapter.id,  # type: ignore[arg-type]
            entity_uuid=chapter.chapter_uuid,
            org_id=org.id,  # type: ignore[arg-type]
        )

        link = (
            await db_session.execute(
                select(CourseChapter).where(
                    CourseChapter.course_id == course.id,
                    CourseChapter.chapter_id == chapter.id,
                )
            )
        ).scalars().first()
        if link is None:
            db_session.add(
                CourseChapter(
                    course_id=course.id,
                    chapter_id=chapter.id,
                    org_id=org.id,
                    order=order,
                    creation_date=_now(),
                    update_date=_now(),
                )
            )
            stats.created += 1
        elif _apply(link, order=order):
            link.update_date = _now()
            db_session.add(link)
            stats.updated += 1

        await _sync_activities(
            db_session, chapter_spec, chapter, course, org, registry, epoch, stats
        )


_ACTIVITY_TYPES = {
    "document": (ActivityTypeEnum.TYPE_DYNAMIC, ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE),
    "video": (ActivityTypeEnum.TYPE_VIDEO, ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE),
    "assignment": (
        ActivityTypeEnum.TYPE_ASSIGNMENT,
        ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
    ),
}


async def _sync_activities(
    db_session: AsyncSession,
    chapter_spec: Any,
    chapter: Chapter,
    course: Course,
    org: Organization,
    registry: Registry,
    epoch: str,
    stats: SyncStats,
) -> None:
    for order, activity_spec in enumerate(chapter_spec.activities):
        activity_type, activity_sub_type = _ACTIVITY_TYPES[activity_spec.kind]
        content = activity_spec.compiled_content()
        if activity_spec.kind == "video":
            content = {"youtube_id": activity_spec.youtube_id}

        entry = registry.get(DemoEntityKind.ACTIVITY, activity_spec.slug)
        activity: Optional[Activity] = None
        if entry is not None:
            activity = (
                await db_session.execute(
                    select(Activity).where(Activity.id == entry.entity_id)
                )
            ).scalars().first()

        if activity is None:
            activity = Activity(
                name=activity_spec.name,
                activity_type=activity_type,
                activity_sub_type=activity_sub_type,
                content=content,
                published=activity_spec.published,
                org_id=org.id,
                course_id=course.id,
                activity_uuid=entry.entity_uuid if entry else _prefixed("activity"),
                creation_date=_days_ago(epoch, HISTORY_DAYS + 25),
                update_date=_now(),
            )
            db_session.add(activity)
            await db_session.flush()
            stats.created += 1
        elif _apply(
            activity,
            name=activity_spec.name,
            content=content,
            published=activity_spec.published,
            activity_type=activity_type,
            activity_sub_type=activity_sub_type,
        ):
            activity.update_date = _now()
            db_session.add(activity)
            stats.updated += 1

        registry.register(
            db_session,
            kind=DemoEntityKind.ACTIVITY,
            bundle_key=activity_spec.slug,
            entity_id=activity.id,  # type: ignore[arg-type]
            entity_uuid=activity.activity_uuid,
            org_id=org.id,  # type: ignore[arg-type]
        )

        link = (
            await db_session.execute(
                select(ChapterActivity).where(
                    ChapterActivity.chapter_id == chapter.id,
                    ChapterActivity.activity_id == activity.id,
                )
            )
        ).scalars().first()
        if link is None:
            db_session.add(
                ChapterActivity(
                    chapter_id=chapter.id,
                    activity_id=activity.id,
                    course_id=course.id,
                    org_id=org.id,
                    order=order,
                    creation_date=_now(),
                    update_date=_now(),
                )
            )
            stats.created += 1
        elif _apply(link, order=order):
            link.update_date = _now()
            db_session.add(link)
            stats.updated += 1


# --- sections (folders) -----------------------------------------------------

async def _sync_sections(
    db_session: AsyncSession,
    bundle: Bundle,
    org: Organization,
    registry: Registry,
    courses: dict[str, Course],
    stats: SyncStats,
) -> None:
    stats.steps.append("sections")

    for order, section in enumerate(bundle.manifest.sections):
        entry = registry.get(DemoEntityKind.FOLDER, section.slug)
        folder: Optional[Folder] = None
        if entry is not None:
            folder = (
                await db_session.execute(
                    select(Folder).where(Folder.id == entry.entity_id)
                )
            ).scalars().first()

        if folder is None:
            folder = Folder(
                name=section.name,
                org_id=org.id,
                folder_uuid=entry.entity_uuid if entry else _prefixed("folder"),
                color=section.color,
                order=order,
                creation_date=_now(),
                update_date=_now(),
            )
            db_session.add(folder)
            await db_session.flush()
            stats.created += 1
        elif _apply(folder, name=section.name, color=section.color, order=order):
            folder.update_date = _now()
            db_session.add(folder)
            stats.updated += 1

        registry.register(
            db_session,
            kind=DemoEntityKind.FOLDER,
            bundle_key=section.slug,
            entity_id=folder.id,  # type: ignore[arg-type]
            entity_uuid=folder.folder_uuid,
            org_id=org.id,  # type: ignore[arg-type]
        )

        wanted = [
            courses[course.slug].course_uuid
            for course in bundle.courses
            if course.section == section.slug and course.slug in courses
        ]
        existing = (
            await db_session.execute(
                select(FolderContent).where(FolderContent.folder_id == folder.id)
            )
        ).scalars().all()
        existing_by_uuid = {row.resource_uuid: row for row in existing}

        for position, resource_uuid in enumerate(wanted):
            row = existing_by_uuid.pop(resource_uuid, None)
            if row is None:
                db_session.add(
                    FolderContent(
                        folder_id=folder.id,
                        resource_uuid=resource_uuid,
                        org_id=org.id,
                        position=position,
                        creation_date=_now(),
                        update_date=_now(),
                    )
                )
                stats.created += 1
            elif _apply(row, position=position):
                row.update_date = _now()
                db_session.add(row)
                stats.updated += 1

        if existing_by_uuid:
            await db_session.execute(
                delete(FolderContent).where(
                    FolderContent.id.in_([row.id for row in existing_by_uuid.values()])
                )
            )
            stats.updated += len(existing_by_uuid)


# --- assignments ------------------------------------------------------------

async def _sync_assignments(
    db_session: AsyncSession,
    bundle: Bundle,
    org: Organization,
    registry: Registry,
    epoch: str,
    stats: SyncStats,
) -> None:
    stats.steps.append("assignments")

    for course_key, sidecar in bundle.assignments.items():
        activity_entry = registry.get(
            DemoEntityKind.ACTIVITY, sidecar["activity_key"]
        )
        course_entry = registry.get(DemoEntityKind.COURSE, course_key)
        if activity_entry is None or course_entry is None:
            continue

        activity = (
            await db_session.execute(
                select(Activity).where(Activity.id == activity_entry.entity_id)
            )
        ).scalars().first()
        if activity is None:
            continue

        chapter_link = (
            await db_session.execute(
                select(ChapterActivity).where(ChapterActivity.activity_id == activity.id)
            )
        ).scalars().first()
        if chapter_link is None:
            continue

        due_date = _days_ago(epoch, -float(sidecar.get("due_in_days", 7)))

        entry = registry.get(DemoEntityKind.ASSIGNMENT, course_key)
        assignment: Optional[Assignment] = None
        if entry is not None:
            assignment = (
                await db_session.execute(
                    select(Assignment).where(Assignment.id == entry.entity_id)
                )
            ).scalars().first()

        fields = dict(
            title=sidecar["title"],
            description=sidecar["description"],
            due_date=due_date,
            published=sidecar.get("published", True),
            grading_type=sidecar.get("grading_type", "PERCENTAGE"),
            auto_grading=sidecar.get("auto_grading", True),
            show_correct_answers=sidecar.get("show_correct_answers", True),
            allow_retries=sidecar.get("allow_retries", True),
            max_retries=sidecar.get("max_retries", 2),
            pass_threshold_percentage=sidecar.get("pass_threshold_percentage", 60),
        )

        if assignment is None:
            assignment = Assignment(
                assignment_uuid=entry.entity_uuid if entry else _prefixed("assignment"),
                org_id=org.id,
                course_id=activity.course_id,
                chapter_id=chapter_link.chapter_id,
                activity_id=activity.id,
                creation_date=_days_ago(epoch, HISTORY_DAYS),
                update_date=_now(),
                **fields,
            )
            db_session.add(assignment)
            await db_session.flush()
            stats.created += 1
        elif _apply(assignment, **fields):
            assignment.update_date = _now()
            db_session.add(assignment)
            stats.updated += 1

        registry.register(
            db_session,
            kind=DemoEntityKind.ASSIGNMENT,
            bundle_key=course_key,
            entity_id=assignment.id,  # type: ignore[arg-type]
            entity_uuid=assignment.assignment_uuid,
            org_id=org.id,  # type: ignore[arg-type]
        )

        for task_spec in sidecar["tasks"]:
            await _sync_assignment_task(
                db_session, task_spec, assignment, activity, chapter_link, org,
                registry, epoch, stats,
            )


async def _sync_assignment_task(
    db_session: AsyncSession,
    task_spec: dict,
    assignment: Assignment,
    activity: Activity,
    chapter_link: ChapterActivity,
    org: Organization,
    registry: Registry,
    epoch: str,
    stats: SyncStats,
) -> None:
    entry = registry.get(DemoEntityKind.ASSIGNMENT_TASK, task_spec["slug"])
    task: Optional[AssignmentTask] = None
    if entry is not None:
        task = (
            await db_session.execute(
                select(AssignmentTask).where(AssignmentTask.id == entry.entity_id)
            )
        ).scalars().first()

    fields = dict(
        title=task_spec["title"],
        description=task_spec.get("description", ""),
        hint=task_spec.get("hint", ""),
        assignment_type=task_spec["type"],
        contents=task_spec["contents"],
        max_grade_value=task_spec["max_grade_value"],
    )

    if task is None:
        task = AssignmentTask(
            assignment_task_uuid=(
                entry.entity_uuid if entry else _prefixed("assignmenttask")
            ),
            reference_file="",
            assignment_id=assignment.id,
            org_id=org.id,
            course_id=activity.course_id,
            chapter_id=chapter_link.chapter_id,
            activity_id=activity.id,
            creation_date=_days_ago(epoch, HISTORY_DAYS),
            update_date=_now(),
            **fields,
        )
        db_session.add(task)
        await db_session.flush()
        stats.created += 1
    elif _apply(task, **fields):
        task.update_date = _now()
        db_session.add(task)
        stats.updated += 1

    registry.register(
        db_session,
        kind=DemoEntityKind.ASSIGNMENT_TASK,
        bundle_key=task_spec["slug"],
        entity_id=task.id,  # type: ignore[arg-type]
        entity_uuid=task.assignment_task_uuid,
        org_id=org.id,  # type: ignore[arg-type]
    )


# --- certifications ---------------------------------------------------------

async def _sync_certifications(
    db_session: AsyncSession,
    bundle: Bundle,
    org: Organization,
    registry: Registry,
    courses: dict[str, Course],
    stats: SyncStats,
) -> None:
    stats.steps.append("certifications")

    for course_spec in bundle.courses:
        if not course_spec.certification:
            continue
        course = courses.get(course_spec.slug)
        if course is None:
            continue

        entry = registry.get(DemoEntityKind.CERTIFICATION, course_spec.slug)
        certification: Optional[Certifications] = None
        if entry is not None:
            certification = (
                await db_session.execute(
                    select(Certifications).where(Certifications.id == entry.entity_id)
                )
            ).scalars().first()

        # The certificate is rendered entirely from these five keys — the
        # editor reads config.certification_name / _description /
        # certification_type / certificate_pattern / certificate_instructor.
        # A config of {"title": ...} left every certificate falling back to
        # defaults, including a placeholder instructor signature.
        desired_config = {
            "certification_name": course_spec.certification_name or course_spec.name,
            "certification_description": (
                course_spec.certification_description
                or f"Awarded in recognition of completing {course_spec.name} at "
                f"{bundle.manifest.org.name}."
            ),
            "certification_type": course_spec.certification_type,
            # Varied per course on purpose: two prospects clicking two
            # certificates should see two visibly different designs.
            "certificate_pattern": course_spec.certificate_pattern,
            "certificate_instructor": bundle.manifest.org.name,
        }

        if certification is None:
            certification = Certifications(
                certification_uuid=(
                    entry.entity_uuid if entry else _prefixed("certification")
                ),
                course_id=course.id,
                config=desired_config,
                creation_date=_now(),
                update_date=_now(),
            )
            db_session.add(certification)
            await db_session.flush()
            stats.created += 1
        elif _apply(certification, config=desired_config):
            # Without this the config is only ever written at insert, so an
            # already-seeded demo would keep a stale certificate design.
            certification.update_date = _now()
            db_session.add(certification)
            stats.updated += 1

        registry.register(
            db_session,
            kind=DemoEntityKind.CERTIFICATION,
            bundle_key=course_spec.slug,
            entity_id=certification.id,  # type: ignore[arg-type]
            entity_uuid=certification.certification_uuid,
            org_id=org.id,  # type: ignore[arg-type]
        )


# --- course updates ---------------------------------------------------------

async def _sync_course_updates(
    db_session: AsyncSession,
    bundle: Bundle,
    org: Organization,
    registry: Registry,
    epoch: str,
    courses: dict[str, Course],
    stats: SyncStats,
) -> None:
    stats.steps.append("updates")

    for course_spec in bundle.courses:
        course = courses.get(course_spec.slug)
        if course is None:
            continue
        for index, update in enumerate(course_spec.updates):
            bundle_key = f"{course_spec.slug}-update-{index}"
            entry = registry.get(DemoEntityKind.COURSE_UPDATE, bundle_key)
            row: Optional[CourseUpdate] = None
            if entry is not None:
                row = (
                    await db_session.execute(
                        select(CourseUpdate).where(CourseUpdate.id == entry.entity_id)
                    )
                ).scalars().first()

            if row is None:
                row = CourseUpdate(
                    courseupdate_uuid=(
                        entry.entity_uuid if entry else _prefixed("courseupdate")
                    ),
                    title=update["title"],
                    content=update["content"],
                    course_id=course.id,
                    org_id=org.id,
                    creation_date=_days_ago(epoch, float(update.get("days_ago", 7))),
                    update_date=_now(),
                )
                db_session.add(row)
                await db_session.flush()
                stats.created += 1
            elif _apply(row, title=update["title"], content=update["content"]):
                row.update_date = _now()
                db_session.add(row)
                stats.updated += 1

            registry.register(
                db_session,
                kind=DemoEntityKind.COURSE_UPDATE,
                bundle_key=bundle_key,
                entity_id=row.id,  # type: ignore[arg-type]
                entity_uuid=row.courseupdate_uuid,
                org_id=org.id,  # type: ignore[arg-type]
            )


# --- engagement: community, boards, playgrounds -----------------------------

async def _sync_engagement(
    db_session: AsyncSession,
    bundle: Bundle,
    org: Organization,
    registry: Registry,
    epoch: str,
    users: dict[str, User],
    stats: SyncStats,
) -> None:
    """Seed the community, boards and playgrounds.

    The plan enables these features; this is what makes them worth looking at.
    An enabled Boards page with nothing on it demonstrates less than a disabled
    one — a prospect reads "empty" as "nobody uses this".

    Podcasts are deliberately absent: an episode needs a real audio file, which
    carries the same repo-weight and transcoding cost as shipping video.
    """
    stats.steps.append("engagement")
    engagement = bundle.engagement

    if engagement.community:
        await _sync_community(
            db_session, engagement.community, org, registry, epoch, users, stats
        )

    for board_spec in engagement.boards:
        await _sync_board(db_session, board_spec, org, registry, epoch, users, stats)

    for playground_spec in engagement.playgrounds:
        await _sync_playground(
            db_session, playground_spec, org, registry, epoch, users, stats
        )

    for podcast_spec in engagement.podcasts:
        await _sync_podcast(db_session, bundle, podcast_spec, org, registry, epoch, stats)


async def _sync_podcast(
    db_session: AsyncSession,
    bundle: Bundle,
    spec: Any,
    org: Organization,
    registry: Registry,
    epoch: str,
    stats: SyncStats,
) -> None:
    """A show and its episodes, with real cover art and real audio.

    The audio is short spoken clips generated by scripts/build_demo_media.py.
    An episode with no audio file leaves the player spinning on a flat
    waveform, which looks broken rather than empty — so the bundle validator
    refuses a podcast whose media is missing.
    """
    from src.db.podcasts.episodes import PodcastEpisode
    from src.db.podcasts.podcasts import Podcast

    entry = registry.get(DemoEntityKind.PODCAST, spec.slug)
    podcast: Optional[Podcast] = None
    if entry is not None:
        podcast = (
            await db_session.execute(select(Podcast).where(Podcast.id == entry.entity_id))
        ).scalars().first()

    fields = dict(
        name=spec.name,
        description=spec.description,
        about=spec.about,
        tags=spec.tags,
        public=True,
        published=True,
    )

    if podcast is None:
        podcast = Podcast(
            org_id=org.id,
            # The uuid prefix is load-bearing: RBAC resolves the resource type
            # from it, so a podcast without "podcast_" is unreachable.
            podcast_uuid=entry.entity_uuid if entry else _prefixed("podcast"),
            thumbnail_image="",
            creation_date=_days_ago(epoch, HISTORY_DAYS),
            update_date=_now(),
            **fields,
        )
        db_session.add(podcast)
        await db_session.flush()
        stats.created += 1
    elif _apply(podcast, **fields):
        podcast.update_date = _now()
        db_session.add(podcast)
        stats.updated += 1

    cover_dir = f"podcasts/{podcast.podcast_uuid}/thumbnails"
    expected_cover = _upload_name(
        uuid=org.org_uuid,
        directory=cover_dir,
        name="cover.webp",
        version=bundle.manifest.bundle_version,
    )
    if podcast.thumbnail_image != expected_cover:
        podcast.thumbnail_image = await _upload(
            directory=cover_dir,
            type_of_dir="orgs",
            uuid=org.org_uuid,
            source_path=bundle.media_path("podcasts", spec.cover),
            name="cover.webp",
            version=bundle.manifest.bundle_version,
        )
        db_session.add(podcast)
        stats.updated += 1

    registry.register(
        db_session,
        kind=DemoEntityKind.PODCAST,
        bundle_key=spec.slug,
        entity_id=podcast.id,  # type: ignore[arg-type]
        entity_uuid=podcast.podcast_uuid,
        org_id=org.id,  # type: ignore[arg-type]
    )

    await _sync_resource_author_for(db_session, podcast.podcast_uuid, org, stats)

    for number, episode_spec in enumerate(spec.episodes, start=1):
        e_entry = registry.get(DemoEntityKind.PODCAST_EPISODE, episode_spec.slug)
        episode: Optional[PodcastEpisode] = None
        if e_entry is not None:
            episode = (
                await db_session.execute(
                    select(PodcastEpisode).where(PodcastEpisode.id == e_entry.entity_id)
                )
            ).scalars().first()

        episode_fields = dict(
            title=episode_spec.title,
            description=episode_spec.description,
            duration_seconds=episode_spec.duration_seconds,
            episode_number=number,
            order=number,
            published=True,
            # The bundle ships no per-episode artwork, so anything here came
            # from a visitor's upload and would otherwise be permanent.
            thumbnail_image="",
        )

        if episode is None:
            episode = PodcastEpisode(
                podcast_id=podcast.id,
                org_id=org.id,
                episode_uuid=(
                    e_entry.entity_uuid if e_entry else _prefixed("episode")
                ),
                audio_file="",
                creation_date=_days_ago(epoch, episode_spec.days_ago),
                update_date=_now(),
                **episode_fields,
            )
            db_session.add(episode)
            await db_session.flush()
            stats.created += 1
        elif _apply(episode, **episode_fields):
            episode.update_date = _now()
            db_session.add(episode)
            stats.updated += 1

        audio_dir = (
            f"podcasts/{podcast.podcast_uuid}/episodes/"
            f"{episode.episode_uuid}/audio"
        )
        expected_audio = _upload_name(
            uuid=org.org_uuid,
            directory=audio_dir,
            name="episode.mp3",
            version=bundle.manifest.bundle_version,
        )
        if episode.audio_file != expected_audio:
            episode.audio_file = await _upload(
                directory=audio_dir,
                type_of_dir="orgs",
                uuid=org.org_uuid,
                source_path=bundle.media_path("podcasts", episode_spec.audio),
                name="episode.mp3",
                version=bundle.manifest.bundle_version,
                allowed_formats=["mp3"],
            )
            db_session.add(episode)
            stats.updated += 1

        registry.register(
            db_session,
            kind=DemoEntityKind.PODCAST_EPISODE,
            bundle_key=episode_spec.slug,
            entity_id=episode.id,  # type: ignore[arg-type]
            entity_uuid=episode.episode_uuid,
            org_id=org.id,  # type: ignore[arg-type]
        )


async def _sync_community(
    db_session: AsyncSession,
    spec: Any,
    org: Organization,
    registry: Registry,
    epoch: str,
    users: dict[str, User],
    stats: SyncStats,
) -> None:
    from src.db.communities.communities import Community
    from src.db.communities.discussion_comments import DiscussionComment
    from src.db.communities.discussions import Discussion

    entry = registry.get(DemoEntityKind.COMMUNITY, spec.slug)
    community: Optional[Community] = None
    if entry is not None:
        community = (
            await db_session.execute(
                select(Community).where(Community.id == entry.entity_id)
            )
        ).scalars().first()

    if community is None:
        community = Community(
            name=spec.name,
            description=spec.description,
            public=spec.public,
            org_id=org.id,
            community_uuid=entry.entity_uuid if entry else _prefixed("community"),
            creation_date=_days_ago(epoch, HISTORY_DAYS + 10),
            update_date=_now(),
        )
        db_session.add(community)
        await db_session.flush()
        stats.created += 1
    elif _apply(
        community, name=spec.name, description=spec.description, public=spec.public
    ):
        community.update_date = _now()
        db_session.add(community)
        stats.updated += 1

    registry.register(
        db_session,
        kind=DemoEntityKind.COMMUNITY,
        bundle_key=spec.slug,
        entity_id=community.id,  # type: ignore[arg-type]
        entity_uuid=community.community_uuid,
        org_id=org.id,  # type: ignore[arg-type]
    )

    for discussion_spec in spec.discussions:
        author = users.get(discussion_spec.author)
        if author is None:
            continue

        d_entry = registry.get(DemoEntityKind.DISCUSSION, discussion_spec.slug)
        discussion: Optional[Discussion] = None
        if d_entry is not None:
            discussion = (
                await db_session.execute(
                    select(Discussion).where(Discussion.id == d_entry.entity_id)
                )
            ).scalars().first()

        fields = dict(
            title=discussion_spec.title,
            content=discussion_spec.content,
            label=discussion_spec.label,
            emoji=discussion_spec.emoji,
            upvote_count=discussion_spec.upvotes,
            is_pinned=discussion_spec.pinned,
            # A visitor can lock a discussion, and locking it stops everyone
            # after them replying — a seeded conversation that quietly closes
            # for good is a worse demo than one nobody has touched.
            is_locked=False,
        )

        if discussion is None:
            discussion = Discussion(
                community_id=community.id,
                org_id=org.id,
                author_id=author.id,
                discussion_uuid=(
                    d_entry.entity_uuid if d_entry else _prefixed("discussion")
                ),
                creation_date=_days_ago(epoch, discussion_spec.days_ago),
                update_date=_days_ago(epoch, discussion_spec.days_ago),
                **fields,
            )
            db_session.add(discussion)
            await db_session.flush()
            stats.created += 1
        elif _apply(discussion, **fields):
            db_session.add(discussion)
            stats.updated += 1

        registry.register(
            db_session,
            kind=DemoEntityKind.DISCUSSION,
            bundle_key=discussion_spec.slug,
            entity_id=discussion.id,  # type: ignore[arg-type]
            entity_uuid=discussion.discussion_uuid,
            org_id=org.id,  # type: ignore[arg-type]
        )

        for index, comment_spec in enumerate(discussion_spec.comments):
            commenter = users.get(comment_spec.author)
            if commenter is None:
                continue
            comment_key = f"{discussion_spec.slug}-c{index}"
            c_entry = registry.get(DemoEntityKind.DISCUSSION_COMMENT, comment_key)
            comment: Optional[DiscussionComment] = None
            if c_entry is not None:
                comment = (
                    await db_session.execute(
                        select(DiscussionComment).where(
                            DiscussionComment.id == c_entry.entity_id
                        )
                    )
                ).scalars().first()

            if comment is None:
                comment = DiscussionComment(
                    discussion_id=discussion.id,
                    author_id=commenter.id,
                    content=comment_spec.content,
                    upvote_count=comment_spec.upvotes,
                    comment_uuid=(
                        c_entry.entity_uuid if c_entry else _prefixed("discussioncomment")
                    ),
                    creation_date=_days_ago(epoch, comment_spec.days_ago),
                    update_date=_days_ago(epoch, comment_spec.days_ago),
                )
                db_session.add(comment)
                await db_session.flush()
                stats.created += 1
            elif _apply(
                comment,
                content=comment_spec.content,
                upvote_count=comment_spec.upvotes,
            ):
                db_session.add(comment)
                stats.updated += 1

            registry.register(
                db_session,
                kind=DemoEntityKind.DISCUSSION_COMMENT,
                bundle_key=comment_key,
                entity_id=comment.id,  # type: ignore[arg-type]
                entity_uuid=comment.comment_uuid,
                org_id=org.id,  # type: ignore[arg-type]
            )


@lru_cache(maxsize=None)
def _board_canvas(slug: str) -> Optional[bytes]:
    """The pre-built Yjs document for a demo board, if the bundle ships one.

    A board's content is a CRDT binary rather than ordinary columns, so it is
    generated by apps/collab/scripts/build_demo_boards.mjs (where yjs lives)
    and committed. The collaboration server loads this from the database the
    first time a board is opened — without it every demo board opens blank,
    which reads as a feature nobody uses.
    """
    import os

    from src.services.demo.bundle_loader import BUNDLE_ROOT

    path = os.path.join(BUNDLE_ROOT, "boards", f"{slug}.ydoc")
    if not os.path.exists(path):
        return None
    with open(path, "rb") as handle:
        return handle.read()


async def _sync_board(
    db_session: AsyncSession,
    spec: Any,
    org: Organization,
    registry: Registry,
    epoch: str,
    users: dict[str, User],
    stats: SyncStats,
) -> None:
    from src.db.boards import Board, BoardMember

    owner = users.get(spec.owner)
    if owner is None:
        return

    entry = registry.get(DemoEntityKind.BOARD, spec.slug)
    board: Optional[Board] = None
    if entry is not None:
        board = (
            await db_session.execute(select(Board).where(Board.id == entry.entity_id))
        ).scalars().first()

    canvas = _board_canvas(spec.slug)

    if board is None:
        board = Board(
            name=spec.name,
            description=spec.description,
            public=spec.public,
            org_id=org.id,
            board_uuid=entry.entity_uuid if entry else _prefixed("board"),
            created_by=owner.id,
            ydoc_state=canvas,
            creation_date=_days_ago(epoch, HISTORY_DAYS - 5),
            update_date=_now(),
        )
        db_session.add(board)
        await db_session.flush()
        stats.created += 1
    else:
        changed = _apply(
            board, name=spec.name, description=spec.description, public=spec.public
        )
        # Put the canvas back to the bundle's whenever it differs, not only
        # when it has been emptied. Restoring only an empty canvas made a
        # seeded board the one bundle-owned surface where a visitor's edits
        # were permanent: anything drawn on it greeted every later prospect.
        #
        # Comparing the bytes first keeps a settled demo silent. The board is a
        # live CRDT document, so a visitor drawing at the moment of a refresh
        # loses that stroke — which is what a demo that resets every ten
        # minutes is supposed to do. Note the collaboration server holds the
        # document in memory, so an open session keeps rendering its own copy
        # until it reconnects.
        if canvas is not None and board.ydoc_state != canvas:
            board.ydoc_state = canvas
            changed = True
        if changed:
            board.update_date = _now()
            db_session.add(board)
            stats.updated += 1

    registry.register(
        db_session,
        kind=DemoEntityKind.BOARD,
        bundle_key=spec.slug,
        entity_id=board.id,  # type: ignore[arg-type]
        entity_uuid=board.board_uuid,
        org_id=org.id,  # type: ignore[arg-type]
    )

    wanted = {
        users[key].id for key in [spec.owner, *spec.members] if key in users
    }
    existing = (
        await db_session.execute(
            select(BoardMember).where(BoardMember.board_id == board.id)
        )
    ).scalars().all()
    existing_ids = {row.user_id for row in existing}

    for user_id in wanted - existing_ids:
        db_session.add(
            BoardMember(
                board_id=board.id,
                user_id=user_id,
                role="owner" if user_id == owner.id else "editor",
                creation_date=_now(),
            )
        )
        stats.created += 1

    stale = [row for row in existing if row.user_id not in wanted]
    if stale:
        await db_session.execute(
            delete(BoardMember).where(BoardMember.id.in_([r.id for r in stale]))
        )
        stats.drift_deleted += len(stale)


async def _sync_playground(
    db_session: AsyncSession,
    spec: Any,
    org: Organization,
    registry: Registry,
    epoch: str,
    users: dict[str, User],
    stats: SyncStats,
) -> None:
    from src.db.playgrounds import Playground

    owner = users.get(spec.owner)
    entry = registry.get(DemoEntityKind.PLAYGROUND, spec.slug)
    playground: Optional[Playground] = None
    if entry is not None:
        playground = (
            await db_session.execute(
                select(Playground).where(Playground.id == entry.entity_id)
            )
        ).scalars().first()

    course_entry = (
        registry.get(DemoEntityKind.COURSE, spec.course) if spec.course else None
    )

    fields = dict(
        name=spec.name,
        description=spec.description,
        published=spec.published,
        html_content=spec.html,
        course_uuid=course_entry.entity_uuid if course_entry else None,
    )

    if playground is None:
        playground = Playground(
            org_id=org.id,
            playground_uuid=entry.entity_uuid if entry else _prefixed("playground"),
            created_by=owner.id if owner else None,
            course_id=course_entry.entity_id if course_entry else None,
            creation_date=_days_ago(epoch, HISTORY_DAYS - 12),
            update_date=_now(),
            **fields,
        )
        db_session.add(playground)
        await db_session.flush()
        stats.created += 1
    elif _apply(playground, **fields):
        playground.update_date = _now()
        db_session.add(playground)
        stats.updated += 1

    registry.register(
        db_session,
        kind=DemoEntityKind.PLAYGROUND,
        bundle_key=spec.slug,
        entity_id=playground.id,  # type: ignore[arg-type]
        entity_uuid=playground.playground_uuid,
        org_id=org.id,  # type: ignore[arg-type]
    )


# --- store ------------------------------------------------------------------

def _store_unsupported_reason() -> Optional[str]:
    """Why this build cannot host the demo storefront, or None if it can.

    The storefront is the only part of the demo whose models live in the
    Enterprise tree, which ships on its own release cadence. So this asks what
    the build in front of us can actually do instead of assuming, and names the
    gap when it cannot: an older Enterprise release is not a fault, and is not a
    community install either, and one undifferentiated "skipped" line cost a
    debugging round trip while somebody watched a demo refuse to build.

    Both store steps ask the same question here so they can never disagree
    about whether the storefront exists — the seeding skipping while the drift
    sweep carried on is exactly how the second production failure happened.
    """
    from src.core.deployment_mode import get_deployment_mode

    if get_deployment_mode() == "oss":
        return "payments are unavailable in oss mode"

    try:
        from ee.db.payments.payments import (  # type: ignore[import-not-found]
            PaymentProviderEnum,
        )
        from ee.db.payments.payments_enrollments import (  # type: ignore[import-not-found]
            PaymentsEnrollment,
        )
    except ImportError as exc:
        return (
            f"payments models unavailable ({exc}) — expected on a community install"
        )

    # CUSTOM means "this organization drives its own enrolments", the only
    # provider that takes no money. STRIPE would be a real checkout somebody
    # could complete inside a sandbox anyone can enter as an admin, so without
    # CUSTOM there is nothing safe to configure.
    if not hasattr(PaymentProviderEnum, "CUSTOM"):
        return (
            "this Enterprise build's PaymentProviderEnum has no CUSTOM provider "
            f"(has: {', '.join(p.name for p in PaymentProviderEnum)}), and the "
            "demo will not point a storefront at a real payment provider"
        )

    # The drift sweep matches seeded enrolments by uuid. Older builds have the
    # table without that column, and discovering it halfway through the sweep
    # is what stopped the demo provisioning the second time.
    if not hasattr(PaymentsEnrollment, "enrollment_uuid"):
        return (
            "this Enterprise build's PaymentsEnrollment has no enrollment_uuid, "
            "so seeded enrolments could not be tracked or swept"
        )

    return None


async def _sync_store(
    db_session: AsyncSession,
    bundle: Bundle,
    org: Organization,
    registry: Registry,
    epoch: str,
    users: dict[str, User],
    stats: SyncStats,
) -> None:
    """Fill the storefront: offers, bundles and who has bought them.

    Payments are an Enterprise Edition feature — the models live in the private
    ee/ tree and their tables are created by SQLModel rather than a migration,
    so a community install has no payments schema at all. The import is
    therefore guarded and the whole step is skipped rather than failing the
    sync, matching how src/security/rbac/rbac.py handles the same models.
    """
    store = bundle.store
    if not store.offers:
        return

    # One question, asked in one place: can this build host the storefront at
    # all? "Can I import the models?" is not the same as "is this feature on
    # and complete?" — payments is Enterprise-gated, and an Enterprise tree can
    # be present, importable, and still older than the demo needs.
    unsupported = _store_unsupported_reason()
    if unsupported:
        logger.info("Demo store skipped: %s.", unsupported)
        return

    try:
        from ee.db.payments.payments import (  # type: ignore[import-not-found]
            PaymentProviderEnum,
            PaymentsConfig,
        )
        from ee.db.payments.payments_enrollments import (  # type: ignore[import-not-found]
            EnrollmentStatusEnum,
            PaymentsEnrollment,
        )
        # PaymentsOfferResource lives in payments_groups, not payments_offers.
        from ee.db.payments.payments_groups import (  # type: ignore[import-not-found]
            PaymentsGroup,
            PaymentsGroupResource,
            PaymentsOfferResource,
        )
        from ee.db.payments.payments_offers import (  # type: ignore[import-not-found]
            OfferPriceTypeEnum,
            OfferTypeEnum,
            PaymentsOffer,
        )
    except ImportError as exc:
        # Community edition has no payments tables at all, which is a normal
        # state rather than a fault. Logged with the reason: a bare "skipped"
        # made an import typo look identical to a community install, and cost
        # a debugging round trip.
        logger.info(
            "Demo store skipped: payments models unavailable (%s). "
            "Expected on a community install.",
            exc,
        )
        return


    stats.steps.append("store")

    # These models use real datetimes rather than the string dates the core
    # tables use, so the timestamps here are datetime objects on purpose.
    def _dt(days: float) -> datetime:
        return datetime.combine(
            date.fromisoformat(epoch), datetime.min.time()
        ) - timedelta(days=days)

    config = (
        await db_session.execute(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org.id)
        )
    ).scalars().first()
    if config is None:
        config = PaymentsConfig(
            org_id=org.id,
            enabled=True,
            active=True,
            # CUSTOM, never STRIPE: the demo must show a working storefront
            # without credentials, and a Stripe-backed offer in a shared
            # sandbox is a checkout somebody could complete.
            provider=PaymentProviderEnum.CUSTOM,
            provider_config={},
            creation_date=_dt(HISTORY_DAYS),
            update_date=datetime.now(),
        )
        db_session.add(config)
        await db_session.flush()
        stats.created += 1
    elif _apply(config, enabled=True, active=True, provider=PaymentProviderEnum.CUSTOM):
        db_session.add(config)
        stats.updated += 1

    groups: dict[str, Any] = {}
    for group_spec in store.groups:
        entry = registry.get(DemoEntityKind.PAYMENTS_GROUP, group_spec.slug)
        group = None
        if entry is not None:
            group = (
                await db_session.execute(
                    select(PaymentsGroup).where(PaymentsGroup.id == entry.entity_id)
                )
            ).scalars().first()

        if group is None:
            group = PaymentsGroup(
                org_id=org.id,
                name=group_spec.name,
                description=group_spec.description,
                creation_date=_dt(HISTORY_DAYS),
                update_date=datetime.now(),
            )
            db_session.add(group)
            await db_session.flush()
            stats.created += 1
        elif _apply(group, name=group_spec.name, description=group_spec.description):
            db_session.add(group)
            stats.updated += 1

        registry.register(
            db_session,
            kind=DemoEntityKind.PAYMENTS_GROUP,
            bundle_key=group_spec.slug,
            entity_id=group.id,
            entity_uuid=f"paymentsgroup_{group.id}",
            org_id=org.id,  # type: ignore[arg-type]
        )
        groups[group_spec.slug] = group

        wanted = {
            registry.uuid_for(DemoEntityKind.COURSE, key)
            for key in group_spec.courses
        } - {None}
        existing = (
            await db_session.execute(
                select(PaymentsGroupResource).where(
                    PaymentsGroupResource.payments_group_id == group.id
                )
            )
        ).scalars().all()
        have = {row.resource_uuid for row in existing}

        for resource_uuid in wanted - have:
            db_session.add(
                PaymentsGroupResource(
                    payments_group_id=group.id,
                    resource_uuid=resource_uuid,
                    org_id=org.id,
                    creation_date=_dt(HISTORY_DAYS),
                    update_date=datetime.now(),
                )
            )
            stats.created += 1

        stale = [row for row in existing if row.resource_uuid not in wanted]
        if stale:
            await db_session.execute(
                delete(PaymentsGroupResource).where(
                    PaymentsGroupResource.id.in_([r.id for r in stale])
                )
            )
            stats.drift_deleted += len(stale)

    offers: dict[str, Any] = {}
    for offer_spec in store.offers:
        entry = registry.get(DemoEntityKind.PAYMENTS_OFFER, offer_spec.slug)
        offer = None
        if entry is not None:
            offer = (
                await db_session.execute(
                    select(PaymentsOffer).where(PaymentsOffer.id == entry.entity_id)
                )
            ).scalars().first()

        group = groups.get(offer_spec.group) if offer_spec.group else None
        fields = dict(
            name=offer_spec.name,
            description=offer_spec.description,
            offer_type=OfferTypeEnum(offer_spec.offer_type),
            price_type=OfferPriceTypeEnum(offer_spec.price_type),
            amount=offer_spec.amount,
            currency=offer_spec.currency,
            benefits=offer_spec.benefits,
            is_publicly_listed=True,
            payments_group_id=group.id if group else None,
            # Reconciled, not merely set on create. A visitor-admin can point
            # this at any URL, and the storefront sends buyers there — so an
            # unreconciled value is a phishing page living in the demo store
            # until someone notices. The bundle never sets one.
            external_checkout_url=None,
        )

        if offer is None:
            offer = PaymentsOffer(
                org_id=org.id,
                payments_config_id=config.id,
                offer_uuid=entry.entity_uuid if entry else str(uuid4()),
                provider_product_id="",
                creation_date=_dt(HISTORY_DAYS - 5),
                update_date=datetime.now(),
                **fields,
            )
            db_session.add(offer)
            await db_session.flush()
            stats.created += 1
        elif _apply(offer, **fields):
            db_session.add(offer)
            stats.updated += 1

        registry.register(
            db_session,
            kind=DemoEntityKind.PAYMENTS_OFFER,
            bundle_key=offer_spec.slug,
            entity_id=offer.id,
            entity_uuid=offer.offer_uuid,
            org_id=org.id,  # type: ignore[arg-type]
        )
        offers[offer_spec.slug] = offer

        # A single-course offer links the course directly rather than through
        # a group.
        wanted_resources: set[str] = set()
        if offer_spec.course:
            course_uuid = registry.uuid_for(DemoEntityKind.COURSE, offer_spec.course)
            if course_uuid:
                wanted_resources.add(course_uuid)

        existing = (
            await db_session.execute(
                select(PaymentsOfferResource).where(
                    PaymentsOfferResource.offer_id == offer.id
                )
            )
        ).scalars().all()
        have = {row.resource_uuid for row in existing}

        for resource_uuid in wanted_resources - have:
            db_session.add(
                PaymentsOfferResource(
                    offer_id=offer.id,
                    resource_uuid=resource_uuid,
                    org_id=org.id,
                    creation_date=_dt(HISTORY_DAYS - 5),
                    update_date=datetime.now(),
                )
            )
            stats.created += 1

        stale = [row for row in existing if row.resource_uuid not in wanted_resources]
        if stale:
            await db_session.execute(
                delete(PaymentsOfferResource).where(
                    PaymentsOfferResource.id.in_([r.id for r in stale])
                )
            )
            stats.drift_deleted += len(stale)

    for index, enrolment in enumerate(store.enrollments):
        offer = offers.get(enrolment.offer)
        user = users.get(enrolment.student)
        if offer is None or user is None:
            continue

        bundle_key = f"{enrolment.offer}-{enrolment.student}"
        entry = registry.get(DemoEntityKind.PAYMENTS_ENROLLMENT, bundle_key)
        row = None
        if entry is not None:
            row = (
                await db_session.execute(
                    select(PaymentsEnrollment).where(
                        PaymentsEnrollment.id == entry.entity_id
                    )
                )
            ).scalars().first()

        status = EnrollmentStatusEnum(enrolment.status)
        if row is None:
            row = PaymentsEnrollment(
                enrollment_uuid=entry.entity_uuid if entry else str(uuid4()),
                offer_id=offer.id,
                user_id=user.id,
                org_id=org.id,
                status=status,
                creation_date=_dt(enrolment.days_ago),
                update_date=datetime.now(),
            )
            db_session.add(row)
            await db_session.flush()
            stats.created += 1
        elif _apply(row, status=status):
            db_session.add(row)
            stats.updated += 1

        registry.register(
            db_session,
            kind=DemoEntityKind.PAYMENTS_ENROLLMENT,
            bundle_key=bundle_key,
            entity_id=row.id,
            entity_uuid=row.enrollment_uuid,
            org_id=org.id,  # type: ignore[arg-type]
        )


# --- drift ------------------------------------------------------------------

async def _delete_drift(
    db_session: AsyncSession, org: Organization, registry: Registry, stats: SyncStats
) -> None:
    """Remove anything in the demo org the bundle does not own.

    That is, by definition, whatever a visitor created. Their membership of the
    org is left alone — visitors are not drift, their content is.
    """
    stats.steps.append("drift")

    removals: list[_Sweep] = [
        _Sweep(Activity, Activity.activity_uuid, DemoEntityKind.ACTIVITY),
        _Sweep(Chapter, Chapter.chapter_uuid, DemoEntityKind.CHAPTER),
        _Sweep(Course, Course.course_uuid, DemoEntityKind.COURSE),
        _Sweep(UserGroup, UserGroup.usergroup_uuid, DemoEntityKind.USERGROUP),
        _Sweep(Folder, Folder.folder_uuid, DemoEntityKind.FOLDER),
        _Sweep(CourseUpdate, CourseUpdate.courseupdate_uuid, DemoEntityKind.COURSE_UPDATE),
        _Sweep(Assignment, Assignment.assignment_uuid, DemoEntityKind.ASSIGNMENT),
        _Sweep(
            AssignmentTask,
            AssignmentTask.assignment_task_uuid,
            DemoEntityKind.ASSIGNMENT_TASK,
        ),
        _Sweep(Board, Board.board_uuid, DemoEntityKind.BOARD),
        _Sweep(Playground, Playground.playground_uuid, DemoEntityKind.PLAYGROUND),
        _Sweep(Community, Community.community_uuid, DemoEntityKind.COMMUNITY),
        _Sweep(Discussion, Discussion.discussion_uuid, DemoEntityKind.DISCUSSION),
        _Sweep(Podcast, Podcast.podcast_uuid, DemoEntityKind.PODCAST),
        _Sweep(PodcastEpisode, PodcastEpisode.episode_uuid, DemoEntityKind.PODCAST_EPISODE),
        # Not cosmetic. Every visitor joins the demo as an admin, so any of
        # them can mint an API token scoped to the org or point a webhook at a
        # server they control. The bundle owns neither, so both are drift — and
        # without these two lines a token minted once would survive every
        # refresh and keep working indefinitely.
        _Sweep(APIToken, APIToken.token_uuid, DemoEntityKind.API_TOKEN),
        _Sweep(WebhookEndpoint, WebhookEndpoint.webhook_uuid, DemoEntityKind.WEBHOOK),
        # The bundle creates neither: its images go to org storage through
        # _upload rather than the Media table, and it authors activity content
        # as ProseMirror rather than Block rows. So everything here is
        # visitor-uploaded, and without the sweep a file a visitor drops in the
        # library stays in shared storage permanently.
        _Sweep(Media, Media.media_uuid, DemoEntityKind.MEDIA),
        _Sweep(Block, Block.block_uuid, DemoEntityKind.BLOCK),
    ]

    for sweep in removals:
        model, uuid_column, kind = sweep.model, sweep.uuid_column, sweep.kind
        owned = registry.uuids_of_kind(kind)
        stale_uuids = (
            await db_session.execute(
                select(uuid_column).where(
                    model.org_id == org.id,
                    uuid_column.notin_(owned) if owned else True,  # type: ignore[arg-type]
                )
            )
        ).scalars().all()
        if not stale_uuids:
            continue

        # ResourceAuthor links content by a bare resource_uuid string with no
        # foreign key, so deleting a course leaves its author rows behind.
        # Demo-authored rows would go with the demo user, but a course a visitor
        # created is authored by a real user who survives the refresh.
        await db_session.execute(
            delete(ResourceAuthor).where(ResourceAuthor.resource_uuid.in_(stale_uuids))
        )
        await db_session.execute(
            delete(model).where(
                model.org_id == org.id, uuid_column.in_(stale_uuids)
            )
        )

        # Rows are only half of what a visitor leaves behind: a course carries
        # its thumbnail and the images and video inside its activities, a
        # podcast its cover and episode audio, a media row its file. Deleting
        # the row without the file leaves bytes in shared storage with nothing
        # pointing at them, and nothing else ever collects them — teardown only
        # runs when the whole demo is destroyed. The demo would grow at
        # whatever rate prospects try the upload button.
        #
        # Podcast episodes and activities are not swept here: their directories
        # sit under the podcast and the course respectively, which are removed
        # whole when they are themselves drift, and which survive when they are
        # bundle-owned.
        for stale_uuid in _storage_paths_for(kind, org, stale_uuids):
            _remove_storage(stale_uuid)

        stats.drift_deleted += len(stale_uuids)
        logger.info(
            "Demo drift: removed %s %s row(s)", len(stale_uuids), sweep.kind
        )

    await _delete_comment_drift(db_session, org, registry, stats)
    await _delete_reaction_drift(db_session, org, stats)
    await _delete_unowned_org_drift(db_session, org, registry, stats)
    await _delete_certification_drift(db_session, org, registry, stats)
    await _delete_visitor_progress_drift(db_session, org, registry, stats)
    # Same treatment as the seeding step, and for the same reason: this is the
    # other half of the storefront, it touches the same Enterprise models, and
    # a version skew here must cost the storefront rather than the demo. The
    # capability gate above should already have stopped it, but the gate can
    # only know about the gaps we have met so far — this covers the next one.
    #
    # A savepoint rather than a bare try: a statement failing mid-sweep aborts
    # the surrounding transaction on Postgres, and every later phase would then
    # fail on "current transaction is aborted".
    try:
        async with db_session.begin_nested():
            await _delete_store_drift(db_session, org, registry, stats)
    except Exception as exc:
        stats.steps.append("store-drift:failed")
        logger.exception(
            "Demo store drift sweep failed; continuing without it: %s", exc
        )

    # Users who are not registry-owned demo students and hold no membership are
    # not touched here: visitors are real accounts that exist outside the demo.


def _storage_paths_for(kind: str, org: Organization, uuids) -> list[str]:
    """Storage directories to reclaim for a set of drift rows of one kind.

    Only kinds that own a directory of their own appear here. An activity's
    media lives under its course and an episode's under its podcast, so those
    are reclaimed with the parent when the parent is drift, and correctly kept
    when the parent is bundle-owned.
    """
    root = f"content/orgs/{org.org_uuid}"
    if kind == DemoEntityKind.COURSE:
        return [f"{root}/courses/{uuid}" for uuid in uuids]
    if kind == DemoEntityKind.PODCAST:
        return [f"{root}/podcasts/{uuid}" for uuid in uuids]
    return []


def _remove_storage(path: str) -> None:
    """Delete a storage directory, never letting the failure abort the sync.

    An unreachable bucket should cost orphaned files and a warning, not a
    half-finished refresh that leaves the demo vandalised until the next tick.
    """
    try:
        from src.services.courses.transfer.storage_utils import (
            delete_storage_directory,
        )

        delete_storage_directory(path)
    except Exception:  # pragma: no cover - defensive
        logger.warning("Demo drift: could not remove %s", path, exc_info=True)


async def _delete_unowned_org_drift(
    db_session: AsyncSession, org: Organization, registry: Registry, stats: SyncStats
) -> None:
    """Sweep org-scoped tables the bundle never writes to.

    These carry an org_id but no uuid column, so they cannot join the
    uuid-matched sweep above — and since the sync creates none of them, every
    row in the demo org belongs to a visitor.

    Activity versions are the reason this is not merely tidiness: the sync puts
    activity content back, but each intermediate version a visitor saved was
    kept, carrying their name and a one-click restore.

    Note what is *not* swept here. Audit events for logins and logouts carry a
    NULL org_id by design — a connection is not an organization's event — so
    they are not the demo's rows to delete, and a sweep matching NULL would be
    writing outside the demo org. The dossier that exposed them is scoped in
    routers/audit.py instead, which is where the leak actually was.
    """
    from src.security.rbac.constants import ADMIN_ROLE_ID

    for model, label in (
        (UserAuditEvent, "audit event"),
        (ActivityVersion, "activity version"),
        (AIGeneration, "AI generation"),
        (MediaShareToken, "media share token"),
    ):
        stale = (
            await db_session.execute(
                select(model.id).where(model.org_id == org.id)  # type: ignore[attr-defined]
            )
        ).scalars().all()
        if not stale:
            continue
        await db_session.execute(delete(model).where(model.id.in_(stale)))  # type: ignore[attr-defined]
        stats.drift_deleted += len(stale)
        logger.info("Demo drift: removed %s %s row(s)", len(stale), label)

    # Library-root entries. The bundle files every course inside one of its
    # three sections, so it never writes a row with a NULL folder_id — that is
    # the Drive-like root, and only the folders service puts anything there.
    # Left alone, a visitor could pin a copy of a bundle course to the root and
    # it would sit beside the real one for good.
    root_entries = (
        await db_session.execute(
            select(FolderContent.id).where(
                FolderContent.org_id == org.id,
                FolderContent.folder_id.is_(None),  # type: ignore[attr-defined]
            )
        )
    ).scalars().all()
    if root_entries:
        await db_session.execute(
            delete(FolderContent).where(FolderContent.id.in_(root_entries))
        )
        stats.drift_deleted += len(root_entries)
        logger.info(
            "Demo drift: removed %s library-root entry(ies)", len(root_entries)
        )

    # Roles need the memberships pointing at them moved first: role_id is a
    # plain foreign key with no ON DELETE, so deleting a role somebody still
    # holds aborts the whole sync transaction rather than cascading. The
    # built-in roles are global (org_id NULL) and are not touched.
    custom_role_ids = (
        await db_session.execute(select(Role.id).where(Role.org_id == org.id))
    ).scalars().all()
    if not custom_role_ids:
        return

    demo_user_ids = registry.ids_of_kind(DemoEntityKind.USER)
    memberships = (
        await db_session.execute(
            select(UserOrganization).where(
                UserOrganization.org_id == org.id,
                UserOrganization.role_id.in_(custom_role_ids),  # type: ignore[attr-defined]
            )
        )
    ).scalars().all()
    for membership in memberships:
        # Seeded learners go back to the read-only role the bundle gives them;
        # a visitor keeps the admin role they entered with.
        membership.role_id = (
            LEARNER_ROLE_ID if membership.user_id in demo_user_ids else ADMIN_ROLE_ID
        )
        db_session.add(membership)
    await db_session.flush()

    # Only delete roles nothing references any more. A role assigned by
    # update_user_role, which resolves a role by uuid with no org scoping, can
    # be held by a membership in a *different* organization — and role_id is a
    # plain foreign key with no ON DELETE, so deleting it raises and takes the
    # whole sync transaction with it. That would not be a one-off: every
    # subsequent refresh would hit the same row and the demo would stay frozen
    # until someone edited the database by hand. The same check covers the
    # narrower race where a visitor assigns a role between the query above and
    # the delete below.
    #
    # Reassigning the other org's membership is not an option: the sync must
    # never write outside the demo org. Leaving the role costs one stale row.
    still_referenced = set(
        (
            await db_session.execute(
                select(UserOrganization.role_id).where(
                    UserOrganization.role_id.in_(custom_role_ids)  # type: ignore[attr-defined]
                )
            )
        ).scalars().all()
    )
    deletable = [rid for rid in custom_role_ids if rid not in still_referenced]
    if not deletable:
        logger.warning(
            "Demo drift: %s custom role(s) are still assigned outside the demo "
            "org and were left in place",
            len(custom_role_ids),
        )
        return

    await db_session.execute(delete(Role).where(Role.id.in_(deletable)))
    stats.drift_deleted += len(deletable)
    logger.info("Demo drift: removed %s custom role(s)", len(deletable))


async def _delete_reaction_drift(
    db_session: AsyncSession, org: Organization, stats: SyncStats
) -> None:
    """Remove every vote and reaction inside the demo.

    The bundle seeds none of these — discussion upvote counts are a column on
    the discussion, not rows — so anything here was left by a visitor. They
    hang off a discussion, a comment or a playground rather than carrying an
    org_id, so the generic uuid sweep cannot see them at all, and their parents
    are bundle-owned and survive every refresh.

    Not cosmetic: the reactions API returns the reacting user's username, real
    name and avatar, so a visitor's identity was published under a seeded
    discussion for every prospect who came after them.
    """
    org_discussions = (
        select(Discussion.id)
        .join(Community, Community.id == Discussion.community_id)
        .where(Community.org_id == org.id)
    )
    org_comments = select(DiscussionComment.id).where(
        DiscussionComment.discussion_id.in_(org_discussions)  # type: ignore[attr-defined]
    )
    org_playgrounds = select(Playground.id).where(Playground.org_id == org.id)

    sweeps = [
        (DiscussionVote, DiscussionVote.discussion_id.in_(org_discussions), "discussion vote"),
        (
            DiscussionReaction,
            DiscussionReaction.discussion_id.in_(org_discussions),  # type: ignore[attr-defined]
            "discussion reaction",
        ),
        (
            DiscussionCommentVote,
            DiscussionCommentVote.comment_id.in_(org_comments),  # type: ignore[attr-defined]
            "comment vote",
        ),
        (
            PlaygroundReaction,
            PlaygroundReaction.playground_id.in_(org_playgrounds),  # type: ignore[attr-defined]
            "playground reaction",
        ),
    ]

    for model, in_org, label in sweeps:
        stale = (
            await db_session.execute(select(model.id).where(in_org))  # type: ignore[attr-defined]
        ).scalars().all()
        if not stale:
            continue
        await db_session.execute(delete(model).where(model.id.in_(stale)))  # type: ignore[attr-defined]
        stats.drift_deleted += len(stale)
        logger.info("Demo drift: removed %s %s row(s)", len(stale), label)


async def _delete_visitor_progress_drift(
    db_session: AsyncSession, org: Organization, registry: Registry, stats: SyncStats
) -> None:
    """Remove the learning history a visitor leaves behind in the demo.

    Distinct from _delete_progress_drift, which reconciles the *seeded*
    learners against the current epoch and deliberately scopes itself to them.
    Nothing removed a visitor's own trail, submissions or certificate, so a
    prospect who tried a course appeared in the learners table, the grading
    inbox and the certificate list of the next prospect — who is also an admin
    and can read the lot, under that person's real name.

    Every table here scopes through a parent rather than an org_id of its own,
    which is why the generic uuid sweep cannot reach any of them.
    """
    demo_user_ids = registry.ids_of_kind(DemoEntityKind.USER)
    if not demo_user_ids:
        # Nothing seeded yet: with no students to compare against, every row
        # would look like a visitor's. Refuse rather than delete the lot.
        return

    org_courses = select(Course.id).where(Course.org_id == org.id)
    org_assignments = select(Assignment.id).where(Assignment.org_id == org.id)
    org_certifications = select(Certifications.id).where(
        Certifications.course_id.in_(org_courses)  # type: ignore[attr-defined]
    )

    # (model, org scope, label). TrailStep is absent on purpose: it cascades
    # from TrailRun, so deleting the run takes its steps with it.
    sweeps = [
        (Trail, Trail.org_id == org.id, "trail"),
        (TrailRun, TrailRun.org_id == org.id, "trail run"),
        (UserActivityDay, UserActivityDay.org_id == org.id, "activity day"),
        (
            AssignmentUserSubmission,
            AssignmentUserSubmission.assignment_id.in_(org_assignments),  # type: ignore[attr-defined]
            "assignment submission",
        ),
        (
            AssignmentTaskSubmission,
            AssignmentTaskSubmission.course_id.in_(org_courses),  # type: ignore[attr-defined]
            "task submission",
        ),
        (
            CertificateUser,
            CertificateUser.certification_id.in_(org_certifications),  # type: ignore[attr-defined]
            "certificate",
        ),
    ]

    for model, in_org, label in sweeps:
        stale = (
            await db_session.execute(
                select(model.id).where(
                    in_org,
                    model.user_id.notin_(demo_user_ids),  # type: ignore[attr-defined]
                )
            )
        ).scalars().all()
        if not stale:
            continue
        await db_session.execute(delete(model).where(model.id.in_(stale)))  # type: ignore[attr-defined]
        stats.drift_deleted += len(stale)
        logger.info("Demo drift: removed %s visitor %s row(s)", len(stale), label)


async def _delete_certification_drift(
    db_session: AsyncSession, org: Organization, registry: Registry, stats: SyncStats
) -> None:
    """Remove certifications a visitor added to a bundle course.

    Also scoped through a parent rather than an ``org_id``: Certifications
    hangs off the course. The sync only ever looks up its own certification by
    registry entry, so a second one added through the UI is invisible to it and
    would survive every refresh — leaving the course offering two certificates
    and the next prospect wondering which is real.
    """
    course_ids = (
        await db_session.execute(select(Course.id).where(Course.org_id == org.id))
    ).scalars().all()
    if not course_ids:
        return

    owned = registry.uuids_of_kind(DemoEntityKind.CERTIFICATION)
    stale = (
        await db_session.execute(
            select(Certifications.id).where(
                Certifications.course_id.in_(course_ids),  # type: ignore[attr-defined]
                (
                    Certifications.certification_uuid.notin_(owned)  # type: ignore[attr-defined]
                    if owned
                    else True
                ),
            )
        )
    ).scalars().all()
    if not stale:
        return

    await db_session.execute(
        delete(Certifications).where(Certifications.id.in_(stale))  # type: ignore[attr-defined]
    )
    stats.drift_deleted += len(stale)
    logger.info("Demo drift: removed %s certification(s)", len(stale))


async def _delete_comment_drift(
    db_session: AsyncSession, org: Organization, registry: Registry, stats: SyncStats
) -> None:
    """Remove comments a visitor left on the bundle's discussions.

    Handled apart from the sweep above because DiscussionComment has no
    ``org_id``: it reaches the organization through its discussion, so the
    generic query cannot scope it. A comment on a discussion the visitor
    *created* goes away with that discussion; this is the other case, where the
    discussion is bundle-owned and survives.

    Left out, whatever the last visitor typed stays under a seeded discussion
    for every prospect who follows.
    """
    discussion_ids = (
        await db_session.execute(
            select(Discussion.id)
            .join(Community, Community.id == Discussion.community_id)
            .where(Community.org_id == org.id)
        )
    ).scalars().all()
    if not discussion_ids:
        return

    owned = registry.uuids_of_kind(DemoEntityKind.DISCUSSION_COMMENT)
    stale = (
        await db_session.execute(
            select(DiscussionComment.id).where(
                DiscussionComment.discussion_id.in_(discussion_ids),  # type: ignore[attr-defined]
                (
                    DiscussionComment.comment_uuid.notin_(owned)  # type: ignore[attr-defined]
                    if owned
                    else True
                ),
            )
        )
    ).scalars().all()
    if not stale:
        return

    await db_session.execute(
        delete(DiscussionComment).where(DiscussionComment.id.in_(stale))  # type: ignore[attr-defined]
    )
    stats.drift_deleted += len(stale)
    logger.info("Demo drift: removed %s discussion comment(s)", len(stale))


async def _delete_store_drift(
    db_session: AsyncSession, org: Organization, registry: Registry, stats: SyncStats
) -> None:
    """Remove store rows a visitor created.

    Separate from the main sweep because the payments models are Enterprise
    Edition only and must stay behind a guarded import. Without this an offer
    a visitor invents — at whatever price they like — sits in the public
    storefront until someone notices.

    Groups are matched by primary key rather than uuid: PaymentsGroup has no
    uuid column, so the registry stores a synthetic one.
    """
    # The same gate the seeding step uses. Asking a different question here is
    # what broke production: the seeding skipped itself on an older Enterprise
    # build while this sweep went ahead and referenced a column that build does
    # not have.
    unsupported = _store_unsupported_reason()
    if unsupported:
        return

    try:
        from ee.db.payments.payments_enrollments import (  # type: ignore[import-not-found]
            PaymentsEnrollment,
        )
        from ee.db.payments.payments_groups import (  # type: ignore[import-not-found]
            PaymentsGroup,
        )
        from ee.db.payments.payments_offers import (  # type: ignore[import-not-found]
            PaymentsOffer,
        )
    except ImportError:
        return

    owned_offers = registry.uuids_of_kind(DemoEntityKind.PAYMENTS_OFFER)
    stale_offers = (
        await db_session.execute(
            select(PaymentsOffer.offer_uuid).where(
                PaymentsOffer.org_id == org.id,
                PaymentsOffer.offer_uuid.notin_(owned_offers) if owned_offers else True,
            )
        )
    ).scalars().all()
    if stale_offers:
        await db_session.execute(
            delete(PaymentsOffer).where(
                PaymentsOffer.org_id == org.id,
                PaymentsOffer.offer_uuid.in_(stale_offers),
            )
        )
        stats.drift_deleted += len(stale_offers)

    owned_enrolments = registry.uuids_of_kind(DemoEntityKind.PAYMENTS_ENROLLMENT)
    stale_enrolments = (
        await db_session.execute(
            select(PaymentsEnrollment.enrollment_uuid).where(
                PaymentsEnrollment.org_id == org.id,
                PaymentsEnrollment.enrollment_uuid.notin_(owned_enrolments)
                if owned_enrolments
                else True,
            )
        )
    ).scalars().all()
    if stale_enrolments:
        await db_session.execute(
            delete(PaymentsEnrollment).where(
                PaymentsEnrollment.org_id == org.id,
                PaymentsEnrollment.enrollment_uuid.in_(stale_enrolments),
            )
        )
        stats.drift_deleted += len(stale_enrolments)

    owned_group_ids = registry.ids_of_kind(DemoEntityKind.PAYMENTS_GROUP)
    stale_groups = (
        await db_session.execute(
            select(PaymentsGroup.id).where(
                PaymentsGroup.org_id == org.id,
                PaymentsGroup.id.notin_(owned_group_ids) if owned_group_ids else True,
            )
        )
    ).scalars().all()
    if stale_groups:
        await db_session.execute(
            delete(PaymentsGroup).where(PaymentsGroup.id.in_(stale_groups))
        )
        stats.drift_deleted += len(stale_groups)


# --- progress ---------------------------------------------------------------

async def _sync_progress(
    db_session: AsyncSession,
    bundle: Bundle,
    org: Organization,
    registry: Registry,
    epoch: str,
    students: list[StudentPlan],
    users: dict[str, User],
    stats: SyncStats,
) -> None:
    """Reconcile trails, submissions, certificates and activity days.

    Every value here is a function of (student, epoch), so on a settled demo
    the desired state already matches what is stored and nothing is written.
    """
    stats.steps.append("progress")

    course_rows = {
        course.slug: registry.get(DemoEntityKind.COURSE, course.slug)
        for course in bundle.courses
    }
    course_ids = {
        key: entry.entity_id for key, entry in course_rows.items() if entry is not None
    }

    # Ordered activity ids per course — the prefix a learner completes.
    activities_by_course: dict[str, list[int]] = {}
    for course_key, course_id in course_ids.items():
        rows = (
            await db_session.execute(
                select(ChapterActivity.activity_id)
                .join(Activity, Activity.id == ChapterActivity.activity_id)
                .join(CourseChapter, CourseChapter.chapter_id == ChapterActivity.chapter_id)
                .where(
                    ChapterActivity.course_id == course_id,
                    Activity.published.is_(True),
                )
                .order_by(CourseChapter.order, ChapterActivity.order)
            )
        ).scalars().all()
        activities_by_course[course_key] = list(rows)

    for plan in students:
        user = users.get(plan.bundle_key)
        if user is None:
            continue

        trail = (
            await db_session.execute(
                select(Trail).where(Trail.user_id == user.id, Trail.org_id == org.id)
            )
        ).scalars().first()
        if trail is None:
            trail = Trail(
                trail_uuid=_prefixed("trail"),
                org_id=org.id,
                user_id=user.id,
                creation_date=_days_ago(epoch, HISTORY_DAYS),
                update_date=_now(),
            )
            db_session.add(trail)
            await db_session.flush()
            stats.created += 1

        for course_key in plan.course_keys:
            course_id = course_ids.get(course_key)
            if course_id is None:
                continue
            await _sync_trail_run(
                db_session, plan, epoch, trail, user, org, course_key, course_id,
                activities_by_course.get(course_key, []), stats,
            )

        await _sync_activity_days(db_session, plan, epoch, user, org, stats)

    await _sync_submissions(
        db_session, bundle, org, registry, epoch, students, users, stats
    )
    await _sync_certificates(
        db_session, bundle, org, registry, epoch, students, users,
        activities_by_course, stats,
    )
    await _delete_progress_drift(
        db_session, org, students, users, course_ids, stats
    )


async def _delete_progress_drift(
    db_session: AsyncSession,
    org: Organization,
    students: list[StudentPlan],
    users: dict[str, User],
    course_ids: dict[str, int],
    stats: SyncStats,
) -> None:
    """Remove progress for courses a learner is no longer enrolled in.

    The daily epoch roll re-draws every persona, so a learner's enrolled course
    set changes. The per-learner passes above only ever visit courses in the
    CURRENT plan, so anything that fell out was left behind — and because it is
    only ever added to, enrolments accumulate until all forty learners appear
    enrolled in the entire catalogue with frozen progress bars, stale rows in
    the grading inbox and certificates their plan says they never earned.

    That is the persona design — lurkers take one course, completers take six —
    quietly erasing itself over a fortnight of uptime. Reconciling here restores
    the module's stated invariant: the demo is a function of (bundle, epoch),
    not of how long it has been running.

    TrailStep cascades from TrailRun, so deleting the run takes its steps.
    """
    wanted_runs: set[tuple[int, int]] = set()
    for plan in students:
        user = users.get(plan.bundle_key)
        if user is None:
            continue
        for course_key in plan.course_keys:
            course_id = course_ids.get(course_key)
            if course_id is not None:
                wanted_runs.add((int(user.id), int(course_id)))

    demo_user_ids = {int(u.id) for u in users.values() if u.id is not None}
    if not demo_user_ids:
        return

    existing_runs = (
        await db_session.execute(
            select(TrailRun.id, TrailRun.user_id, TrailRun.course_id).where(
                TrailRun.org_id == org.id,
                TrailRun.user_id.in_(demo_user_ids),
            )
        )
    ).all()

    stale_run_ids = [
        row.id
        for row in existing_runs
        if (int(row.user_id), int(row.course_id)) not in wanted_runs
    ]
    if stale_run_ids:
        await db_session.execute(
            delete(TrailRun).where(TrailRun.id.in_(stale_run_ids))
        )
        stats.drift_deleted += len(stale_run_ids)

    # Submissions and certificates for dropped courses go the same way. They
    # reach the org through their assignment/certification rather than an
    # org_id, so they are matched by course.
    stale_course_ids_by_user: dict[int, set[int]] = {}
    for row in existing_runs:
        key = (int(row.user_id), int(row.course_id))
        if key not in wanted_runs:
            stale_course_ids_by_user.setdefault(int(row.user_id), set()).add(
                int(row.course_id)
            )

    for user_id, stale_courses in stale_course_ids_by_user.items():
        stale_assignments = (
            await db_session.execute(
                select(Assignment.id).where(Assignment.course_id.in_(stale_courses))
            )
        ).scalars().all()
        if not stale_assignments:
            continue

        await db_session.execute(
            delete(AssignmentUserSubmission).where(
                AssignmentUserSubmission.user_id == user_id,
                AssignmentUserSubmission.assignment_id.in_(stale_assignments),
            )
        )
        await db_session.execute(
            delete(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.user_id == user_id,
                AssignmentTaskSubmission.course_id.in_(stale_courses),
            )
        )

        stale_certifications = (
            await db_session.execute(
                select(Certifications.id).where(
                    Certifications.course_id.in_(stale_courses)
                )
            )
        ).scalars().all()
        if stale_certifications:
            await db_session.execute(
                delete(CertificateUser).where(
                    CertificateUser.user_id == user_id,
                    CertificateUser.certification_id.in_(stale_certifications),
                )
            )


async def _sync_trail_run(
    db_session: AsyncSession,
    plan: StudentPlan,
    epoch: str,
    trail: Trail,
    user: User,
    org: Organization,
    course_key: str,
    course_id: int,
    activity_ids: list[int],
    stats: SyncStats,
) -> None:
    fraction = plan.completion.get(course_key, 0.0)
    completed = completed_activity_count(len(activity_ids), fraction)

    if fraction >= 1.0 and activity_ids:
        status = "STATUS_COMPLETED"
    elif plan.persona.run_status:
        status = plan.persona.run_status
    else:
        status = "STATUS_IN_PROGRESS"

    run = (
        await db_session.execute(
            select(TrailRun).where(
                TrailRun.trail_id == trail.id,
                TrailRun.course_id == course_id,
                TrailRun.user_id == user.id,
            )
        )
    ).scalars().first()

    if run is None:
        run = TrailRun(
            trailrun_uuid=_prefixed("trailrun"),
            trail_id=trail.id,
            course_id=course_id,
            org_id=org.id,
            user_id=user.id,
            status=status,
            creation_date=step_timestamp(epoch, plan, course_key, 0),
            update_date=_now(),
        )
        db_session.add(run)
        await db_session.flush()
        stats.created += 1
    elif _apply(run, status=status):
        run.update_date = _now()
        db_session.add(run)
        stats.updated += 1

    wanted_ids = activity_ids[:completed]
    existing = (
        await db_session.execute(
            select(TrailStep).where(
                TrailStep.trailrun_id == run.id, TrailStep.user_id == user.id
            )
        )
    ).scalars().all()
    existing_by_activity = {row.activity_id: row for row in existing}

    for position, activity_id in enumerate(wanted_ids):
        row = existing_by_activity.pop(activity_id, None)
        if row is None:
            db_session.add(
                TrailStep(
                    complete=True,
                    teacher_verified=False,
                    grade="",
                    trailrun_id=run.id,
                    trail_id=trail.id,
                    activity_id=activity_id,
                    course_id=course_id,
                    org_id=org.id,
                    user_id=user.id,
                    creation_date=step_timestamp(epoch, plan, course_key, position),
                    update_date=step_timestamp(epoch, plan, course_key, position),
                )
            )
            stats.created += 1
        elif _apply(row, complete=True):
            db_session.add(row)
            stats.updated += 1

    # Steps beyond the target: a visitor ticked something off on the demo, or
    # the epoch rolled and the learner's progress moved.
    if existing_by_activity:
        await db_session.execute(
            delete(TrailStep).where(
                TrailStep.id.in_([row.id for row in existing_by_activity.values()])
            )
        )
        stats.drift_deleted += len(existing_by_activity)


async def _sync_activity_days(
    db_session: AsyncSession,
    plan: StudentPlan,
    epoch: str,
    user: User,
    org: Organization,
    stats: SyncStats,
) -> None:
    wanted = set(activity_days(epoch, plan))
    existing = (
        await db_session.execute(
            select(UserActivityDay).where(
                UserActivityDay.org_id == org.id, UserActivityDay.user_id == user.id
            )
        )
    ).scalars().all()
    existing_days = {row.activity_date for row in existing}

    for day in wanted - existing_days:
        db_session.add(
            UserActivityDay(org_id=org.id, user_id=user.id, activity_date=day)
        )
        stats.created += 1

    stale = [row for row in existing if row.activity_date not in wanted]
    if stale:
        await db_session.execute(
            delete(UserActivityDay).where(
                UserActivityDay.id.in_([row.id for row in stale])
            )
        )
        stats.drift_deleted += len(stale)


async def _sync_submissions(
    db_session: AsyncSession,
    bundle: Bundle,
    org: Organization,
    registry: Registry,
    epoch: str,
    students: list[StudentPlan],
    users: dict[str, User],
    stats: SyncStats,
) -> None:
    for course_key, sidecar in bundle.assignments.items():
        assignment_entry = registry.get(DemoEntityKind.ASSIGNMENT, course_key)
        if assignment_entry is None:
            continue
        assignment = (
            await db_session.execute(
                select(Assignment).where(Assignment.id == assignment_entry.entity_id)
            )
        ).scalars().first()
        if assignment is None:
            continue

        tasks = []
        for task_spec in sidecar["tasks"]:
            entry = registry.get(DemoEntityKind.ASSIGNMENT_TASK, task_spec["slug"])
            if entry is None:
                continue
            task = (
                await db_session.execute(
                    select(AssignmentTask).where(AssignmentTask.id == entry.entity_id)
                )
            ).scalars().first()
            if task is not None:
                tasks.append((task_spec, task))

        for plan in students:
            if course_key not in plan.course_keys:
                continue
            user = users.get(plan.bundle_key)
            if user is None:
                continue

            status = submission_status_for(plan, epoch, course_key)
            if status == "NOT_SUBMITTED":
                continue

            template = submission_template_for(plan, epoch, course_key)
            total = 0
            for task_spec, task in tasks:
                grade = grade_for(plan, epoch, course_key, task_spec["max_grade_value"])
                if status != "GRADED":
                    grade = 0
                total += grade
                await _sync_task_submission(
                    db_session, plan, epoch, course_key, user, org, task,
                    task_spec, template, grade, status, stats,
                )

            await _sync_user_submission(
                db_session, plan, epoch, course_key, user, org, assignment,
                status, total, stats,
            )


async def _sync_task_submission(
    db_session: AsyncSession,
    plan: StudentPlan,
    epoch: str,
    course_key: str,
    user: User,
    org: Organization,
    task: AssignmentTask,
    task_spec: dict,
    template: str,
    grade: int,
    status: str,
    stats: SyncStats,
) -> None:
    payload = task_spec["submissions"][template]

    row = (
        await db_session.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.user_id == user.id,
                AssignmentTaskSubmission.assignment_task_id == task.id,
            )
        )
    ).scalars().first()

    fields = dict(
        task_submission=payload,
        grade=grade,
        task_submission_grade_feedback="",
        manually_graded=False,
    )

    if row is None:
        # No org_id on this table — it reaches the organization through
        # assignment_task, which is why teardown depends on that cascade.
        db_session.add(
            AssignmentTaskSubmission(
                assignment_task_submission_uuid=_prefixed("assignmenttasksubmission"),
                assignment_type=task.assignment_type,
                user_id=user.id,
                assignment_task_id=task.id,
                course_id=task.course_id,
                chapter_id=task.chapter_id,
                activity_id=task.activity_id,
                creation_date=step_timestamp(epoch, plan, course_key, 0),
                update_date=_now(),
                **fields,
            )
        )
        stats.created += 1
    elif _apply(row, **fields):
        row.update_date = _now()
        db_session.add(row)
        stats.updated += 1


async def _sync_user_submission(
    db_session: AsyncSession,
    plan: StudentPlan,
    epoch: str,
    course_key: str,
    user: User,
    org: Organization,
    assignment: Assignment,
    status: str,
    total: int,
    stats: SyncStats,
) -> None:
    row = (
        await db_session.execute(
            select(AssignmentUserSubmission).where(
                AssignmentUserSubmission.user_id == user.id,
                AssignmentUserSubmission.assignment_id == assignment.id,
            )
        )
    ).scalars().first()

    fields = dict(
        submission_status=status,
        grade=total,
        overall_feedback="",
    )

    if row is None:
        # Carries only user_id and assignment_id — it reaches the organization
        # through the assignment, so teardown relies on that cascade.
        db_session.add(
            AssignmentUserSubmission(
                assignmentusersubmission_uuid=_prefixed("assignmentusersubmission"),
                user_id=user.id,
                assignment_id=assignment.id,
                attempt_number=1,
                creation_date=step_timestamp(epoch, plan, course_key, 1),
                update_date=_now(),
                **fields,
            )
        )
        stats.created += 1
    elif _apply(row, **fields):
        row.update_date = _now()
        db_session.add(row)
        stats.updated += 1


async def _sync_certificates(
    db_session: AsyncSession,
    bundle: Bundle,
    org: Organization,
    registry: Registry,
    epoch: str,
    students: list[StudentPlan],
    users: dict[str, User],
    activities_by_course: dict[str, list[int]],
    stats: SyncStats,
) -> None:
    """Issue a certificate to learners who finished a certified course.

    Mirrors the eligibility rule the application uses (all published activities
    complete) rather than calling the real issuing function, which would fire
    webhooks and analytics for every one of these.
    """
    for course_spec in bundle.courses:
        if not course_spec.certification:
            continue
        entry = registry.get(DemoEntityKind.CERTIFICATION, course_spec.slug)
        if entry is None:
            continue

        for plan in students:
            user = users.get(plan.bundle_key)
            if user is None or course_spec.slug not in plan.course_keys:
                continue

            total = len(activities_by_course.get(course_spec.slug, []))
            done = completed_activity_count(
                total, plan.completion.get(course_spec.slug, 0.0)
            )
            eligible = total > 0 and done >= total

            row = (
                await db_session.execute(
                    select(CertificateUser).where(
                        CertificateUser.user_id == user.id,
                        CertificateUser.certification_id == entry.entity_id,
                    )
                )
            ).scalars().first()

            if eligible and row is None:
                db_session.add(
                    CertificateUser(
                        user_certification_uuid=_certificate_code(user.user_uuid, epoch),
                        user_id=user.id,
                        certification_id=entry.entity_id,
                        # created_at / updated_at, not creation_date /
                        # update_date: this table names them differently to the
                        # rest, and SQLModel silently drops kwargs that are not
                        # fields — so the wrong names left every certificate
                        # with an empty award date.
                        created_at=_days_ago(
                            epoch, 2 + (plan.index % 21), hour=9 + (plan.index % 8)
                        ),
                        updated_at=_now(),
                    )
                )
                stats.created += 1
            elif not eligible and row is not None:
                await db_session.execute(
                    delete(CertificateUser).where(CertificateUser.id == row.id)
                )
                stats.drift_deleted += 1


def _certificate_code(user_uuid: str, epoch: str) -> str:
    """Readable certificate reference, in the format the app already uses."""
    stamp = epoch.replace("-", "")
    tail = user_uuid[-4:] if len(user_uuid) >= 4 else user_uuid
    return f"RA-{stamp}-{tail}-{uuid4().hex[:8]}"


# --- finish -----------------------------------------------------------------

async def _assert_single_tenant(db_session: AsyncSession, org: Organization) -> None:
    """Confirm nothing was written outside the demo organization.

    A sync with an org_id bug is a cross-tenant data-injection bug, so it is
    worth two cheap counts to be certain rather than confident.
    """
    demo_entity_leak = (
        await db_session.execute(
            select(func.count())
            .select_from(DemoEntity)
            .where(DemoEntity.org_id != org.id)
        )
    ).scalar_one()
    if demo_entity_leak:
        raise RuntimeError(
            f"demo sync registered {demo_entity_leak} row(s) outside the demo org"
        )


async def _finalize(
    db_session: AsyncSession,
    state: DemoState,
    org: Organization,
    bundle: Bundle,
    epoch: str,
    stats: SyncStats,
) -> None:
    from src.services.orgs.usage import invalidate_usage_cache

    state.org_id = org.id
    state.state = DemoStateEnum.READY
    state.bundle_version = bundle.manifest.bundle_version
    state.content_epoch = epoch
    state.last_refresh_at = _now()
    state.last_step = stats.steps[-1] if stats.steps else ""
    state.last_error = None
    state.stats = stats.as_dict()
    state.update_date = _now()
    if stats.provisioned:
        state.last_provision_at = _now()
    db_session.add(state)

    try:
        invalidate_usage_cache(org.id)  # type: ignore[arg-type]
    except Exception:  # pragma: no cover - cache is best effort
        logger.debug("Could not invalidate usage cache for the demo org")

    try:
        from src.services.orgs.cache import invalidate_org_cache

        invalidate_org_cache(org.slug)
    except Exception:  # pragma: no cover
        logger.debug("Could not invalidate org cache for the demo org")
