"""Loading and validating the demo content bundle.

The bundle is static data checked into the repository: one manifest, one file
per course, one assignment sidecar per course, and a small media directory.
Everything the demo organization contains is derived from it.

Two things are load-bearing and are enforced here rather than discovered at
runtime:

* **Every `bundle_key` is a stable identity.** The refresh matches database
  rows to bundle entries by key, so a renamed key is not an edit — it orphans
  the old row and creates a new one. Keys are validated for shape and
  uniqueness so a typo fails at load rather than silently duplicating content.
* **The bundle is fully validated before the first row is written.** Provision
  creates an organization, forty users and hundreds of content rows; finding a
  malformed activity halfway through would leave a half-built demo live.
"""

import json
import os
import re
from functools import lru_cache
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from src.services.demo.content import ContentError, compile_document, plain_text

BUNDLE_ROOT = os.path.join(os.path.dirname(__file__), "bundle")

# Keys land in DemoEntity.bundle_key and in storage paths, so they stay in a
# conservative slug alphabet.
_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")

# A guard against the bundle quietly growing until it dominates a git clone.
MAX_BUNDLE_BYTES = 8 * 1024 * 1024


class BundleError(ValueError):
    """The bundle on disk is malformed. Always an authoring bug, never input."""


def _validate_key(value: str) -> str:
    if not _KEY_RE.match(value):
        raise ValueError(
            f"{value!r} is not a valid bundle key (lowercase letters, digits, dashes)"
        )
    return value


class ActivitySpec(BaseModel):
    slug: str
    name: str
    kind: str = "document"  # document | video | assignment
    published: bool = True
    body: list[Any] = Field(default_factory=list)
    # Only for kind="video": a YouTube id. Deliberately not a hosted file —
    # shipping real video would put tens of megabytes in the repo and run an
    # ffmpeg pass on every provision.
    youtube_id: Optional[str] = None

    _validate_slug = field_validator("slug")(_validate_key)

    @field_validator("kind")
    @classmethod
    def _known_kind(cls, value: str) -> str:
        if value not in ("document", "video", "assignment"):
            raise ValueError(f"unknown activity kind {value!r}")
        return value

    def compiled_content(self) -> dict:
        if self.kind == "video":
            return {
                "type": "doc",
                "content": [],
            }
        return compile_document(self.body)

    def word_count(self) -> int:
        return len(plain_text(self.body).split())


class ChapterSpec(BaseModel):
    slug: str
    name: str
    description: str = ""
    activities: list[ActivitySpec]

    _validate_slug = field_validator("slug")(_validate_key)


class CourseSpec(BaseModel):
    slug: str
    name: str
    description: str
    about: str = ""
    learnings: str = ""
    tags: str = ""
    thumbnail: str  # filename inside bundle/media/courses/
    section: str  # a section key from the manifest
    public: bool = True
    published: bool = True
    certification: bool = False
    # Certificate copy and design. The editor renders entirely from these, and
    # varying the pattern per course means two certificates look like two
    # certificates rather than the same template twice.
    certification_name: Optional[str] = None
    certification_description: Optional[str] = None
    certification_type: str = "completion"  # completion | assessment | professional
    certificate_pattern: str = "professional"
    updates: list[dict] = Field(default_factory=list)
    chapters: list[ChapterSpec]

    _validate_slug = field_validator("slug")(_validate_key)


class PersonaSpec(BaseModel):
    id: str
    weight: int
    min_courses: int
    max_courses: int
    min_completion: float
    max_completion: float
    assignments: str = "none"  # graded | pending | none
    min_grade_pct: int = 0
    max_grade_pct: int = 0
    run_status: Optional[str] = None


class CohortSpec(BaseModel):
    slug: str
    name: str
    description: str = ""
    share: float
    restricted_courses: list[str] = Field(default_factory=list)

    _validate_slug = field_validator("slug")(_validate_key)


class SectionSpec(BaseModel):
    slug: str
    name: str
    color: str = "violet"

    _validate_slug = field_validator("slug")(_validate_key)


class OrgSpec(BaseModel):
    name: str
    description: str
    about: str = ""
    email: str
    logo: str
    thumbnail: str


class StudentsSpec(BaseModel):
    count: int
    # How many of them have uploaded a profile picture. The rest fall back to
    # initials, which is what a real organization looks like.
    with_avatar: int
    avatar_count: int


class Manifest(BaseModel):
    bundle_version: str
    org: OrgSpec
    students: StudentsSpec
    sections: list[SectionSpec]
    cohorts: list[CohortSpec]
    personas: list[PersonaSpec]
    courses: list[str]  # course keys, in catalogue order


class CommentSpec(BaseModel):
    author: str  # a student bundle key
    content: str
    days_ago: float = 1
    upvotes: int = 0


class DiscussionSpec(BaseModel):
    slug: str
    title: str
    content: str
    label: str = "general"
    emoji: Optional[str] = None
    author: str
    days_ago: float = 1
    upvotes: int = 0
    pinned: bool = False
    comments: list[CommentSpec] = Field(default_factory=list)

    _validate_slug = field_validator("slug")(_validate_key)


class CommunitySpec(BaseModel):
    slug: str
    name: str
    description: str = ""
    public: bool = True
    discussions: list[DiscussionSpec] = Field(default_factory=list)

    _validate_slug = field_validator("slug")(_validate_key)


class BoardSpec(BaseModel):
    slug: str
    name: str
    description: str = ""
    public: bool = False
    owner: str
    members: list[str] = Field(default_factory=list)

    _validate_slug = field_validator("slug")(_validate_key)


class PlaygroundSpec(BaseModel):
    slug: str
    name: str
    description: str = ""
    published: bool = True
    owner: str
    course: Optional[str] = None
    html: str

    _validate_slug = field_validator("slug")(_validate_key)


class PodcastEpisodeSpec(BaseModel):
    slug: str
    title: str
    description: str = ""
    audio: str  # filename inside bundle/media/podcasts/
    duration_seconds: int = 0
    days_ago: float = 7

    _validate_slug = field_validator("slug")(_validate_key)


class PodcastSpec(BaseModel):
    slug: str
    name: str
    description: str = ""
    about: str = ""
    tags: str = ""
    cover: str  # filename inside bundle/media/podcasts/
    episodes: list[PodcastEpisodeSpec] = Field(default_factory=list)

    _validate_slug = field_validator("slug")(_validate_key)


class Engagement(BaseModel):
    """Boards, playgrounds and the community.

    Separate from courses because these are what make the *platform* look
    used rather than what makes a course look complete — an enabled feature
    with an empty page demonstrates nothing.
    """

    community: Optional[CommunitySpec] = None
    boards: list[BoardSpec] = Field(default_factory=list)
    playgrounds: list[PlaygroundSpec] = Field(default_factory=list)
    podcasts: list[PodcastSpec] = Field(default_factory=list)


class StoreGroupSpec(BaseModel):
    slug: str
    name: str
    description: str = ""
    courses: list[str] = Field(default_factory=list)

    _validate_slug = field_validator("slug")(_validate_key)


class StoreOfferSpec(BaseModel):
    slug: str
    name: str
    description: str = ""
    offer_type: str = "one_time"  # one_time | subscription
    price_type: str = "fixed_price"  # fixed_price | customer_choice
    amount: float = 0.0
    currency: str = "USD"
    benefits: str = ""
    # Exactly one of these: an offer sells a single course or a group of them.
    course: Optional[str] = None
    group: Optional[str] = None

    _validate_slug = field_validator("slug")(_validate_key)


class StoreEnrollmentSpec(BaseModel):
    offer: str
    student: str
    status: str = "active"
    days_ago: float = 14


class StoreSpec(BaseModel):
    """The org's store: what it sells and who has bought it.

    Payments live in the Enterprise Edition, so this whole section is optional
    and the sync skips it when those models are not importable — a community
    install has no payments tables at all.
    """

    provider: str = "custom"
    groups: list[StoreGroupSpec] = Field(default_factory=list)
    offers: list[StoreOfferSpec] = Field(default_factory=list)
    enrollments: list[StoreEnrollmentSpec] = Field(default_factory=list)


class Bundle(BaseModel):
    manifest: Manifest
    courses: list[CourseSpec]
    assignments: dict[str, dict]  # course key -> assignment sidecar
    engagement: Engagement = Field(default_factory=Engagement)
    store: StoreSpec = Field(default_factory=StoreSpec)

    def course_by_key(self, key: str) -> CourseSpec:
        for course in self.courses:
            if course.slug == key:
                return course
        raise BundleError(f"no course with key {key!r}")

    def media_path(self, *parts: str) -> str:
        return os.path.join(BUNDLE_ROOT, "media", *parts)


def _read_json(path: str) -> dict:
    if not os.path.exists(path):
        raise BundleError(f"missing bundle file: {path}")
    with open(path, "r", encoding="utf-8") as handle:
        try:
            return json.load(handle)
        except json.JSONDecodeError as exc:
            raise BundleError(f"{path} is not valid JSON: {exc}") from exc


def bundle_size_bytes(root: str = BUNDLE_ROOT) -> int:
    total = 0
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            total += os.path.getsize(os.path.join(dirpath, name))
    return total


def _validate(bundle: Bundle) -> None:
    """Everything that must hold before a single row is written."""
    manifest = bundle.manifest

    section_keys = {section.slug for section in manifest.sections}
    if len(section_keys) != len(manifest.sections):
        raise BundleError("duplicate section keys in manifest")

    course_keys = [course.slug for course in bundle.courses]
    if len(set(course_keys)) != len(course_keys):
        raise BundleError("duplicate course keys")
    if set(course_keys) != set(manifest.courses):
        missing = set(manifest.courses) - set(course_keys)
        extra = set(course_keys) - set(manifest.courses)
        raise BundleError(
            f"manifest course list does not match course files "
            f"(missing: {sorted(missing)}, unexpected: {sorted(extra)})"
        )

    # Keys are the identity the refresh matches on, and they are globally
    # namespaced by kind — so a chapter and an activity may share a key, but two
    # activities anywhere in the bundle may not.
    seen_chapters: set[str] = set()
    seen_activities: set[str] = set()

    for course in bundle.courses:
        if course.section not in section_keys:
            raise BundleError(
                f"course {course.slug!r} is in unknown section {course.section!r}"
            )
        if not os.path.exists(bundle.media_path("courses", course.thumbnail)):
            raise BundleError(
                f"course {course.slug!r} references missing thumbnail {course.thumbnail!r}"
            )
        if not course.chapters:
            raise BundleError(f"course {course.slug!r} has no chapters")

        for chapter in course.chapters:
            if chapter.slug in seen_chapters:
                raise BundleError(f"duplicate chapter key {chapter.slug!r}")
            seen_chapters.add(chapter.slug)
            if not chapter.activities:
                raise BundleError(f"chapter {chapter.slug!r} has no activities")

            for activity in chapter.activities:
                if activity.slug in seen_activities:
                    raise BundleError(f"duplicate activity key {activity.slug!r}")
                seen_activities.add(activity.slug)

                try:
                    activity.compiled_content()
                except ContentError as exc:
                    raise BundleError(
                        f"activity {activity.slug!r} has invalid content: {exc}"
                    ) from exc

                if activity.kind == "video" and not activity.youtube_id:
                    raise BundleError(
                        f"video activity {activity.slug!r} has no youtube_id"
                    )
                # An empty document renders as a blank page. On a demo that is
                # a prospect clicking into nothing during a sales call.
                if activity.kind == "document" and activity.word_count() < 20:
                    raise BundleError(
                        f"activity {activity.slug!r} has almost no content "
                        f"({activity.word_count()} words)"
                    )

    for cohort in manifest.cohorts:
        for course_key in cohort.restricted_courses:
            if course_key not in course_keys:
                raise BundleError(
                    f"cohort {cohort.slug!r} restricts unknown course {course_key!r}"
                )

    total_weight = sum(persona.weight for persona in manifest.personas)
    if total_weight <= 0:
        raise BundleError("persona weights must sum to more than zero")

    students = manifest.students
    if students.with_avatar > students.count:
        raise BundleError("with_avatar exceeds the student count")

    assignment_activity_keys = {
        activity.slug
        for course in bundle.courses
        for chapter in course.chapters
        for activity in chapter.activities
        if activity.kind == "assignment"
    }
    seen_task_keys: set[str] = set()

    for assignment_course_key, sidecar in bundle.assignments.items():
        if assignment_course_key not in course_keys:
            raise BundleError(
                f"assignment sidecar for unknown course {assignment_course_key!r}"
            )

        activity_key = sidecar.get("activity_key")
        if activity_key not in assignment_activity_keys:
            # The sidecar hangs off an Activity of type ASSIGNMENT. Pointing it
            # at a document activity would produce an assignment nothing links
            # to, which is invisible until someone opens the course.
            raise BundleError(
                f"assignment sidecar {assignment_course_key!r} targets "
                f"{activity_key!r}, which is not an assignment activity"
            )

        tasks = sidecar.get("tasks") or []
        if not tasks:
            raise BundleError(f"assignment {assignment_course_key!r} has no tasks")

        for task in tasks:
            key = task.get("slug")
            if not key or key in seen_task_keys:
                raise BundleError(f"duplicate or missing task key {key!r}")
            seen_task_keys.add(key)

            templates = task.get("submissions") or {}
            missing = {"correct", "partial", "incorrect"} - set(templates)
            if missing:
                # Every persona picks one of the three. A missing template
                # would silently give that persona an empty submission, which
                # renders as a blank card in the grading inbox.
                raise BundleError(
                    f"task {key!r} is missing submission templates: {sorted(missing)}"
                )

    # Every assignment activity needs a sidecar, or it renders as an assignment
    # with nothing in it.
    covered = {
        sidecar.get("activity_key") for sidecar in bundle.assignments.values()
    }
    uncovered = assignment_activity_keys - covered
    if uncovered:
        raise BundleError(
            f"assignment activities with no sidecar: {sorted(uncovered)}"
        )

    # Engagement content is authored by the fake students, so every author
    # reference must name one that exists. A typo here would otherwise surface
    # as a missing post halfway through a sync.
    student_keys = {f"student-{i:02d}" for i in range(manifest.students.count)}
    engagement = bundle.engagement

    def _check_author(who: str, where: str) -> None:
        if who not in student_keys:
            raise BundleError(f"{where} is authored by unknown student {who!r}")

    if engagement.community:
        seen_discussions: set[str] = set()
        for discussion in engagement.community.discussions:
            if discussion.slug in seen_discussions:
                raise BundleError(f"duplicate discussion slug {discussion.slug!r}")
            seen_discussions.add(discussion.slug)
            _check_author(discussion.author, f"discussion {discussion.slug!r}")
            for comment in discussion.comments:
                _check_author(comment.author, f"a comment on {discussion.slug!r}")

    for board in engagement.boards:
        _check_author(board.owner, f"board {board.slug!r}")
        for member in board.members:
            _check_author(member, f"board {board.slug!r} membership")

    for playground in engagement.playgrounds:
        _check_author(playground.owner, f"playground {playground.slug!r}")
        if playground.course and playground.course not in course_keys:
            raise BundleError(
                f"playground {playground.slug!r} links unknown course "
                f"{playground.course!r}"
            )

    # Podcast media must exist: a missing audio file is a player that spins,
    # and a missing cover is a blank tile in the catalogue.
    seen_episodes: set[str] = set()
    for podcast in engagement.podcasts:
        if not os.path.exists(bundle.media_path("podcasts", podcast.cover)):
            raise BundleError(
                f"podcast {podcast.slug!r} references missing cover {podcast.cover!r}"
            )
        if not podcast.episodes:
            raise BundleError(f"podcast {podcast.slug!r} has no episodes")
        for episode in podcast.episodes:
            if episode.slug in seen_episodes:
                raise BundleError(f"duplicate episode slug {episode.slug!r}")
            seen_episodes.add(episode.slug)
            if not os.path.exists(bundle.media_path("podcasts", episode.audio)):
                raise BundleError(
                    f"episode {episode.slug!r} references missing audio "
                    f"{episode.audio!r}"
                )

    # Store references must resolve, or the storefront renders offers that sell
    # nothing and enrolments attached to nobody.
    store = bundle.store
    group_keys = {group.slug for group in store.groups}
    offer_keys = {offer.slug for offer in store.offers}

    for group in store.groups:
        for course_key in group.courses:
            if course_key not in course_keys:
                raise BundleError(
                    f"store group {group.slug!r} lists unknown course {course_key!r}"
                )

    for offer in store.offers:
        if bool(offer.course) == bool(offer.group):
            raise BundleError(
                f"store offer {offer.slug!r} must name exactly one of course/group"
            )
        if offer.course and offer.course not in course_keys:
            raise BundleError(
                f"store offer {offer.slug!r} sells unknown course {offer.course!r}"
            )
        if offer.group and offer.group not in group_keys:
            raise BundleError(
                f"store offer {offer.slug!r} sells unknown group {offer.group!r}"
            )

    for enrolment in store.enrollments:
        if enrolment.offer not in offer_keys:
            raise BundleError(
                f"enrolment references unknown offer {enrolment.offer!r}"
            )
        _check_author(enrolment.student, f"enrolment in {enrolment.offer!r}")

    size = bundle_size_bytes()
    if size > MAX_BUNDLE_BYTES:
        raise BundleError(
            f"bundle is {size / 1_048_576:.1f} MB, over the "
            f"{MAX_BUNDLE_BYTES / 1_048_576:.0f} MB budget"
        )


def load_bundle(root: str = BUNDLE_ROOT) -> Bundle:
    """Read and fully validate the bundle. Raises BundleError if unusable."""
    manifest_data = _read_json(os.path.join(root, "manifest.json"))
    try:
        manifest = Manifest.model_validate(manifest_data)
    except Exception as exc:
        raise BundleError(f"manifest.json is invalid: {exc}") from exc

    courses: list[CourseSpec] = []
    for key in manifest.courses:
        data = _read_json(os.path.join(root, "courses", f"{key}.json"))
        try:
            courses.append(CourseSpec.model_validate(data))
        except Exception as exc:
            raise BundleError(f"courses/{key}.json is invalid: {exc}") from exc

    assignments: dict[str, dict] = {}
    assignments_dir = os.path.join(root, "assignments")
    if os.path.isdir(assignments_dir):
        for name in sorted(os.listdir(assignments_dir)):
            if not name.endswith(".json"):
                continue
            assignments[name[:-5]] = _read_json(os.path.join(assignments_dir, name))

    engagement = Engagement()
    engagement_path = os.path.join(root, "engagement.json")
    if os.path.exists(engagement_path):
        try:
            engagement = Engagement.model_validate(_read_json(engagement_path))
        except Exception as exc:
            raise BundleError(f"engagement.json is invalid: {exc}") from exc

    store = StoreSpec()
    store_path = os.path.join(root, "store.json")
    if os.path.exists(store_path):
        try:
            store = StoreSpec.model_validate(_read_json(store_path))
        except Exception as exc:
            raise BundleError(f"store.json is invalid: {exc}") from exc

    bundle = Bundle(
        manifest=manifest,
        courses=courses,
        assignments=assignments,
        engagement=engagement,
        store=store,
    )
    _validate(bundle)
    return bundle


@lru_cache(maxsize=1)
def get_bundle() -> Bundle:
    """Process-wide cached bundle.

    The bundle is immutable data on disk, read on every refresh tick; parsing
    and validating it hourly for the life of the process would be pure waste.
    """
    return load_bundle()
