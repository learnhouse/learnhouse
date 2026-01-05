import json
import logging
import redis
from datetime import datetime
from typing import Any, Optional, Dict
from sqlmodel import Session
from config.config import get_learnhouse_config
from ee.db.audit_logs import AuditLog

logger = logging.getLogger(__name__)
LH_CONFIG = get_learnhouse_config()
REDIS_AUDIT_LOG_KEY = "learnhouse:audit_logs"

def get_redis_client():
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string
    if not redis_conn_string:
        return None
    try:
        return redis.Redis.from_url(redis_conn_string)
    except Exception as e:
        logger.error(f"Failed to connect to Redis: {e}")
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
):
    r = get_redis_client()
    if not r:
        return

    log_data = {
        "user_id": user_id,
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
