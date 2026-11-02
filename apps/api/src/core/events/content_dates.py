"""Keep a course's (or podcast's) update_date in step with edits to its content.

"Last updated" on a course should move when anything inside it is edited, not
only the course row itself. Service code stamps update_date on the activity,
chapter, assignment or episode it edits; these hooks carry that stamp up to the
parent, together with content being added, removed or reordered. Background
writes (indexing status, transcoding and caption progress, reader-side gating)
leave the child's update_date alone, so they don't count as edits.
"""

from datetime import datetime

from sqlalchemy import event, inspect, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment, AssignmentTask
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.podcasts.episodes import PodcastEpisode
from src.db.podcasts.podcasts import Podcast

# Child rows whose update_date marks an author edit: child -> (parent, foreign key).
STAMPED_CHILDREN = {
    Activity: (Course, "course_id"),
    Chapter: (Course, "course_id"),
    Assignment: (Course, "course_id"),
    AssignmentTask: (Course, "course_id"),
    PodcastEpisode: (Podcast, "podcast_id"),
}
# Rows that only place content in a course (ordering links).
LINK_CHILDREN = {
    ChapterActivity: (Course, "course_id"),
    CourseChapter: (Course, "course_id"),
}

PARENTS = {**STAMPED_CHILDREN, **LINK_CHILDREN}

_TOUCHED_KEY = "content_parents_touched"
_registered = False


def touch_parent(connection, target) -> None:
    """Set the target's parent update_date to now, once per parent per flush."""
    parent, foreign_key = PARENTS[type(target)]
    parent_id = getattr(target, foreign_key, None)
    session = Session.object_session(target)
    if not parent_id or session is None:
        return
    touched = session.info.setdefault(_TOUCHED_KEY, set())
    if (parent, parent_id) in touched:
        return
    touched.add((parent, parent_id))

    now = str(datetime.now())
    connection.execute(
        update(parent).where(parent.id == parent_id).values(update_date=now)  # type: ignore[attr-defined]
    )
    # Keep a loaded parent in step without marking it dirty, so a response
    # built from it shows the new date and a later flush doesn't undo it.
    loaded = session.identity_map.get(
        inspect(parent).identity_key_from_primary_key((parent_id,))
    )
    if loaded is not None:
        set_committed_value(loaded, "update_date", now)


def _child_added_or_removed(mapper, connection, target) -> None:
    touch_parent(connection, target)


def _stamped_child_updated(mapper, connection, target) -> None:
    if inspect(target).attrs.update_date.history.has_changes():
        touch_parent(connection, target)


def _link_updated(mapper, connection, target) -> None:
    session = Session.object_session(target)
    if session is not None and session.is_modified(target, include_collections=False):
        touch_parent(connection, target)


def _forget_touched(session, flush_context) -> None:
    session.info.pop(_TOUCHED_KEY, None)


def register_content_date_hooks() -> None:
    """Register once per process. The database module gets reloaded (tests do
    that), and registering twice would only repeat the same writes."""
    global _registered
    if _registered:
        return
    for model in PARENTS:
        event.listen(model, "after_insert", _child_added_or_removed)
        event.listen(model, "after_delete", _child_added_or_removed)
    for model in STAMPED_CHILDREN:
        event.listen(model, "after_update", _stamped_child_updated)
    for model in LINK_CHILDREN:
        event.listen(model, "after_update", _link_updated)
    event.listen(Session, "after_flush_postexec", _forget_touched)
    _registered = True
