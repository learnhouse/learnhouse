from typing import List, Optional
from sqlalchemy import JSON, BigInteger, Column, ForeignKey, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel


# ----------------------------------------------------------------------------
# Path: an ordered sequence of courses with its own certificate
# ----------------------------------------------------------------------------

class PathBase(SQLModel):
    name: str
    description: Optional[str] = ""
    about: Optional[str] = ""
    thumbnail_image: Optional[str] = ""
    # "beginner" | "intermediate" | "advanced" | "" (unset)
    level: Optional[str] = ""
    public: bool = True
    published: bool = False
    # When on, each course is only open in the path view once the previous
    # required course is done. Courses stay reachable on their own; this only
    # shapes how the path guides the learner.
    sequential: bool = False
    # How many optional (elective) courses a learner must finish on top of the
    # required ones. 0 means electives never count toward completion.
    electives_required: int = 0
    certificate_enabled: bool = False


class Path(PathBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), index=True
        )
    )
    path_uuid: str = Field(default="", index=True)
    # Same shape as a course certification config (certification_name,
    # certification_description, certification_type, certificate_pattern,
    # certificate_instructor, ...), so the existing certificate renderer can
    # draw it.
    certificate_config: dict = Field(default_factory=dict, sa_column=Column(JSON))
    creation_date: str = ""
    update_date: str = ""


class PathCourse(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("path_id", "course_id", name="uq_pathcourse_path_course"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    path_id: int = Field(
        sa_column=Column(Integer, ForeignKey("path.id", ondelete="CASCADE"), index=True)
    )
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), index=True)
    )
    position: int = 0
    required: bool = True
    creation_date: str = ""


class PathEnrollment(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("path_id", "user_id", name="uq_pathenrollment_path_user"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    path_id: int = Field(
        sa_column=Column(Integer, ForeignKey("path.id", ondelete="CASCADE"), index=True)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), index=True)
    )
    enrolled_at: str = ""
    completed_at: Optional[str] = None


class PathCertificate(SQLModel, table=True):
    # One certificate per learner per path, enforced in the DB so two
    # concurrent completion checks can't both issue one.
    __table_args__ = (
        UniqueConstraint("path_id", "user_id", name="uq_pathcertificate_path_user"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    path_id: int = Field(
        sa_column=Column(Integer, ForeignKey("path.id", ondelete="CASCADE"), index=True)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), index=True)
    )
    certificate_uuid: str = Field(unique=True, index=True)
    created_at: str = ""


# ----------------------------------------------------------------------------
# API schemas
# ----------------------------------------------------------------------------

class PathCreate(PathBase):
    org_id: int


class PathUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    about: Optional[str] = None
    thumbnail_image: Optional[str] = None
    level: Optional[str] = None
    public: Optional[bool] = None
    published: Optional[bool] = None
    sequential: Optional[bool] = None
    electives_required: Optional[int] = None
    certificate_enabled: Optional[bool] = None
    certificate_config: Optional[dict] = None


class PathCourseInput(SQLModel):
    course_uuid: str
    required: bool = True


class PathCoursesUpdate(SQLModel):
    # Full ordered list; position = array index. Replaces the path's courses.
    courses: List[PathCourseInput]


class PathCourseRead(SQLModel):
    course_uuid: str
    position: int
    required: bool
    # Course card projection: name, description, thumbnail_image, ...
    course: dict
    # Learner progress, only filled for a signed-in viewer.
    completed: bool = False
    progress: int = 0  # percent of published activities done
    started: bool = False
    locked: bool = False


class PathProgress(SQLModel):
    enrolled: bool = False
    enrolled_at: Optional[str] = None
    completed: bool = False
    completed_at: Optional[str] = None
    required_total: int = 0
    required_done: int = 0
    electives_done: int = 0
    # Courses that count toward completion: required ones plus the electives
    # still needed, and how many of those are done.
    courses_needed: int = 0
    courses_done: int = 0
    percent: int = 0
    certificate_uuid: Optional[str] = None


class PathRead(PathBase):
    id: int
    org_id: int
    path_uuid: str
    certificate_config: dict = {}
    creation_date: str
    update_date: str
    course_count: int = 0
    enrollment_count: int = 0
    courses: List[PathCourseRead] = []
    progress: Optional[PathProgress] = None


class PathLearnerRead(SQLModel):
    user: dict
    enrolled_at: str
    completed_at: Optional[str] = None
    required_done: int = 0
    required_total: int = 0
    courses_needed: int = 0
    courses_done: int = 0
    percent: int = 0
    certificate_uuid: Optional[str] = None
