from typing import Optional
from sqlalchemy import JSON, Column, ForeignKey, Integer, Text, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel
from pgvector.sqlalchemy import Vector


class CourseEmbedding(SQLModel, table=True):
    __tablename__ = "course_embedding"
    __table_args__ = (
        Index("ix_course_embedding_org_id", "org_id"),
        Index("ix_course_embedding_course_id", "course_id"),
        Index("ix_course_embedding_course_activity", "course_id", "activity_id"),
        Index(
            "ix_course_embedding_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"))
    )
    # NULL for course-level rows (course and chapter text).
    activity_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"), nullable=True),
    )
    activity_uuid: str = ""
    block_uuid: Optional[str] = None
    # See src.services.ai.rag.types.SourceType for the values.
    source_type: str = ""
    chunk_text: str = Field(default="", sa_column=Column(Text))
    chunk_index: int = 0
    # Where in the source the chunk comes from: {"page": 4} or {"start": 192.0}.
    locator: Optional[dict] = Field(
        default=None, sa_column=Column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)
    )
    # Hash of everything indexed for the chunk's ref, shared by all its rows.
    content_hash: Optional[str] = None
    activity_name: str = ""
    chapter_name: str = ""
    course_name: str = ""
    embedding: list = Field(sa_column=Column(Vector(768)))
    creation_date: str = ""
    update_date: str = ""
