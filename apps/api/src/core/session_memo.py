"""Answers a request looks up more than once, remembered on its DB session.

A lesson read asks the same questions several times over: is this user an
author of the course, is there anything to claim for them, which user groups
unlock it. Each ask used to be its own round trip to the database.

The memo lives in ``session.info`` and is dropped as soon as the session
writes anything (a flush, or a bulk update/delete/insert statement), commits
or rolls back, so a change made during the request is always seen by the next
lookup. While the session holds changes it has not flushed yet (the next
SELECT would autoflush them and could answer differently), nothing is served
from or stored in the memo.
"""

from typing import Optional

from sqlalchemy import event
from sqlalchemy.orm import Session

_INFO_KEY = "lh_session_memo"


def session_memo(db_session) -> Optional[dict]:
    """The session's memo, or None when it can't be used right now."""
    try:
        sync = db_session.sync_session
        info = sync.info
    except Exception:
        # Not a real AsyncSession (e.g. a test double); don't memoize.
        return None
    if not isinstance(info, dict):
        return None
    if sync.new or sync.deleted or sync.dirty:
        return None
    return info.setdefault(_INFO_KEY, {})


@event.listens_for(Session, "after_flush")
@event.listens_for(Session, "after_commit")
@event.listens_for(Session, "after_rollback")
@event.listens_for(Session, "after_soft_rollback")
def _forget(session, *_):
    session.info.pop(_INFO_KEY, None)


@event.listens_for(Session, "after_transaction_end")
def _forget_on_close(session, transaction):
    # close() ends the outer transaction without a rollback event; a session
    # reused after that (a background task) must not see the old answers.
    if transaction.parent is None:
        session.info.pop(_INFO_KEY, None)


@event.listens_for(Session, "do_orm_execute")
def _forget_on_bulk_write(orm_execute_state):
    # update()/delete()/insert() statements write without a flush.
    if orm_execute_state.is_update or orm_execute_state.is_delete or orm_execute_state.is_insert:
        orm_execute_state.session.info.pop(_INFO_KEY, None)
