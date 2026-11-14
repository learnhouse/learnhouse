"""Stand-ins for the EE board models (ee.db.boards), for core tests that cover
the code paths core runs when EE is present. Core reaches boards only through
``src.core.ee_hooks.get_ee_module("ee.db.boards")``; the real models and
their own tests live in EE (ee/tests/test_boards_*.py)."""

from types import SimpleNamespace
from typing import Optional

from sqlalchemy import Column, LargeBinary
from sqlmodel import Field, SQLModel


class StandInBoard(SQLModel, table=True):
    """Just the columns core touches."""

    __tablename__ = "test_standin_board"
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = 0
    board_uuid: str = ""
    name: str = ""
    description: Optional[str] = None
    thumbnail_image: Optional[str] = ""
    public: bool = False
    created_by: Optional[int] = None
    ydoc_state: Optional[bytes] = Field(default=None, sa_column=Column(LargeBinary, nullable=True))
    creation_date: str = ""
    update_date: str = ""


class StandInBoardMember(SQLModel, table=True):
    __tablename__ = "test_standin_board_member"
    id: Optional[int] = Field(default=None, primary_key=True)
    board_id: int = 0
    user_id: int = 0
    role: str = "editor"
    creation_date: str = ""


class StandInBoardRead(SQLModel):
    id: int
    org_id: int
    board_uuid: str
    name: str
    public: bool = False


BOARDS = SimpleNamespace(Board=StandInBoard, BoardMember=StandInBoardMember, BoardRead=StandInBoardRead)
