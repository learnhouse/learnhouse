import json
import logging
import redis
from datetime import datetime
from typing import Any, Optional, Dict
from sqlmodel import Session, select
from config.config import get_learnhouse_config
from ee.db.audit_logs import AuditLog
from src.db.organization_config import OrganizationConfig, OrganizationConfigBase

logger = logging.getLogger(__name__)
LH_CONFIG = get_learnhouse_config()
REDIS_AUDIT_LOG_KEY = "learnhouse:audit_logs"

def is_enterprise_plan(session: Session, org_id: int) -> bool:
    """
    Check if an organization is on the enterprise plan.
    """
    try:
        statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
        org_config = session.exec(statement).first()
        if not org_config:
            return False
        
        config = OrganizationConfigBase(**org_config.config)
        return config.cloud.plan == "enterprise"
    except Exception as e:
        logger.error(f"Error checking enterprise plan for org {org_id}: {e}")
        return False

def get_redis_client():
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string
    if not redis_conn_string:
        return None
    try:
        return redis.Redis.from_url(redis_conn_string)
    except Exception as e:
        logger.error(f"Failed to connect to Redis: {e}")
        return None

def resolve_org_id(session: Session, data: Dict[str, Any]) -> Optional[int]:
    """
    Elegantly resolve org_id from various data identifiers.
    """
    # 1. Direct org_id
    org_id = data.get("org_id") or data.get("orgId")
    if org_id:
        try:
            return int(org_id)
        except (ValueError, TypeError):
            # Try resolving from slug/uuid
            from src.db.organizations import Organization
            from sqlalchemy import or_
            from sqlmodel import select
            try:
                statement = select(Organization.id).where(
                    or_(
                        Organization.org_uuid == str(org_id),
                        Organization.slug == str(org_id)
                    )
                )
                return session.exec(statement).first()
            except Exception:
                pass

    # 2. From chapter_id
    chapter_id = data.get("chapter_id") or data.get("chapterId")
    if chapter_id:
        from src.db.courses.chapters import Chapter
        try:
            try:
                chid = int(chapter_id)
                chapter = session.get(Chapter, chid)
            except (ValueError, TypeError):
                from sqlmodel import select
                statement = select(Chapter).where(Chapter.chapter_uuid == str(chapter_id))
                chapter = session.exec(statement).first()
            if chapter:
                return chapter.org_id
        except Exception:
            pass

    # 3. From course_id
    course_id = data.get("course_id") or data.get("courseId")
    if course_id:
        from src.db.courses.courses import Course
        try:
            try:
                cid = int(course_id)
                course = session.get(Course, cid)
            except (ValueError, TypeError):
                from sqlmodel import select
                statement = select(Course).where(Course.course_uuid == str(course_id))
                course = session.exec(statement).first()
            if course:
                return course.org_id
        except Exception:
            pass
            
    # 4. From activity_id
    activity_id = data.get("activity_id") or data.get("activityId") or data.get("activity_uuid")
    if activity_id:
        from src.db.courses.activities import Activity
        try:
            try:
                aid = int(activity_id)
                activity = session.get(Activity, aid)
            except (ValueError, TypeError):
                from sqlmodel import select
                statement = select(Activity).where(Activity.activity_uuid == str(activity_id))
                activity = session.exec(statement).first()
            if activity:
                return activity.org_id
        except Exception:
            pass

    # 5. From collection_id
    collection_id = data.get("collection_id") or data.get("collectionId") or data.get("collection_uuid")
    if collection_id:
        from src.db.collections import Collection
        try:
            try:
                coid = int(collection_id)
                collection = session.get(Collection, coid)
            except (ValueError, TypeError):
                from sqlmodel import select
                statement = select(Collection).where(Collection.collection_uuid == str(collection_id))
                collection = session.exec(statement).first()
            if collection:
                return collection.org_id
        except Exception:
            pass

    # 6. From usergroup_id
    usergroup_id = data.get("usergroup_id") or data.get("usergroupId") or data.get("usergroup_uuid")
    if usergroup_id:
        from src.db.usergroups import UserGroup
        try:
            try:
                ugid = int(usergroup_id)
                usergroup = session.get(UserGroup, ugid)
            except (ValueError, TypeError):
                from sqlmodel import select
                statement = select(UserGroup).where(UserGroup.usergroup_uuid == str(usergroup_id))
                usergroup = session.exec(statement).first()
            if usergroup:
                return usergroup.org_id
        except Exception:
            pass

    # 7. From role_id
    role_id = data.get("role_id") or data.get("roleId") or data.get("role_uuid")
    if role_id:
        from src.db.roles import Role
        try:
            try:
                rid = int(role_id)
                role = session.get(Role, rid)
            except (ValueError, TypeError):
                from sqlmodel import select
                statement = select(Role).where(Role.role_uuid == str(role_id))
                role = session.exec(statement).first()
            if role:
                return role.org_id
        except Exception:
            pass

    # 8. From assignment_id
    assignment_id = data.get("assignment_id") or data.get("assignmentId") or data.get("assignment_uuid")
    if assignment_id:
        from src.db.courses.assignments import Assignment
        try:
            try:
                asid = int(assignment_id)
                assignment = session.get(Assignment, asid)
            except (ValueError, TypeError):
                from sqlmodel import select
                statement = select(Assignment).where(Assignment.assignment_uuid == str(assignment_id))
                assignment = session.exec(statement).first()
            if assignment:
                return assignment.org_id
        except Exception:
            pass

    # 9. From certification_id
    certification_id = data.get("certification_id") or data.get("certificationId") or data.get("certification_uuid")
    if certification_id:
        from src.db.courses.certifications import Certifications
        try:
            try:
                ceid = int(certification_id)
                certification = session.get(Certifications, ceid)
            except (ValueError, TypeError):
                from sqlmodel import select
                statement = select(Certifications).where(Certifications.certification_uuid == str(certification_id))
                certification = session.exec(statement).first()
            if certification:
                from src.db.courses.courses import Course
                course = session.get(Course, certification.course_id)
                if course:
                    return course.org_id
        except Exception:
            pass

    return None

async def queue_audit_log(
    user_id: Optional[int],
    action: str,
    resource: str,
    method: str,
    path: str,
    status_code: int,
    payload: Optional[Dict[str, Any]] = None,
    resource_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    org_id: Optional[int] = None,
):
    r = get_redis_client()
    if not r:
        return

    log_data = {
        "user_id": user_id,
        "org_id": org_id,
        "action": action,
        "resource": resource,
        "resource_id": resource_id,
        "method": method,
        "path": path,
        "status_code": status_code,
        "payload": payload,
        "ip_address": ip_address,
        "created_at": datetime.utcnow().isoformat(),
    }
    try:
        r.lpush(REDIS_AUDIT_LOG_KEY, json.dumps(log_data))
    except Exception as e:
        logger.error(f"Failed to queue audit log: {e}")

def flush_audit_logs_to_db(db_session: Session):
    r = get_redis_client()
    if not r:
        return

    logs = []
    # Batch process up to 100 logs at a time
    for _ in range(100):
        log_json = r.rpop(REDIS_AUDIT_LOG_KEY)
        if not log_json:
            break
        
        try:
            data = json.loads(log_json)
            # Convert ISO string back to datetime object
            data["created_at"] = datetime.fromisoformat(data["created_at"])
            logs.append(AuditLog(**data))
        except Exception as e:
            logger.error(f"Failed to parse audit log from redis: {e}")

    if logs:
        try:
            db_session.add_all(logs)
            db_session.commit()
            logger.info(f"Successfully flushed {len(logs)} audit logs to database.")
        except Exception as e:
            logger.error(f"Failed to save audit logs to database: {e}")
            db_session.rollback()
