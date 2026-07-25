"""TOTP multi-factor authentication.

Secret storage
--------------
TOTP shared secrets are symmetric credentials: anyone holding one can mint
valid codes forever. They are therefore encrypted at rest with Fernet
(AES-128-CBC + HMAC) rather than hashed — verification needs the original
value back, so hashing is not an option.

The encryption key is derived via HKDF from ``LEARNHOUSE_MFA_ENCRYPTION_KEY``
if set, otherwise from the JWT secret. Deriving from the JWT secret keeps this
zero-config for existing deployments, but it couples the two:

    ⚠️  Rotating the JWT secret without setting LEARNHOUSE_MFA_ENCRYPTION_KEY
        makes every enrolled TOTP secret undecryptable, locking out every user
        who has 2FA on. Set the dedicated key before rotating.

Enrolled users whose secret fails to decrypt are treated as "MFA broken" and
must recover via backup code — never as "MFA not enabled", which would
silently downgrade them to single-factor.
"""

import base64
import hashlib
import logging
import os
import secrets
import time
from datetime import datetime
from typing import List, Optional, Tuple

import pyotp
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import or_, update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.user_mfa import UserMFA, UserMFABackupCode
from src.security.security import SECRET_KEY

logger = logging.getLogger(__name__)

TOTP_ISSUER = "LearnHouse"
TOTP_PERIOD_SECONDS = 30
# Accept the immediately preceding and following timestep. Phone clock drift is
# the single most common cause of "my code doesn't work" support tickets; one
# step either side covers realistic drift without meaningfully widening the
# window an attacker can guess into.
TOTP_DRIFT_STEPS = 1

BACKUP_CODE_COUNT = 10
BACKUP_CODE_LENGTH = 10
# Excludes 0/O and 1/I/L — these get transcribed by hand off a printout.
_BACKUP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

_MFA_KEY_INFO = b"learnhouse-mfa-secret-encryption-v1"
_fernet_cached: Optional[Fernet] = None


def _get_fernet() -> Fernet:
    global _fernet_cached
    if _fernet_cached is not None:
        return _fernet_cached

    material = os.environ.get("LEARNHOUSE_MFA_ENCRYPTION_KEY") or SECRET_KEY
    if not material:  # pragma: no cover - SECRET_KEY is always configured in a running app
        raise RuntimeError(
            "No key material available for MFA secret encryption: set "
            "LEARNHOUSE_MFA_ENCRYPTION_KEY or the JWT secret."
        )
    if isinstance(material, str):
        material = material.encode()

    derived = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=_MFA_KEY_INFO
    ).derive(material)
    _fernet_cached = Fernet(base64.urlsafe_b64encode(derived))
    return _fernet_cached


def encrypt_secret(secret: str) -> str:
    return _get_fernet().encrypt(secret.encode()).decode()


def decrypt_secret(encrypted: str) -> Optional[str]:
    """Return the plaintext TOTP secret, or ``None`` if it cannot be decrypted."""
    try:
        return _get_fernet().decrypt(encrypted.encode()).decode()
    except (InvalidToken, ValueError, TypeError):
        # Almost always a rotated key. Surfaced to the caller as "broken",
        # never as "not enrolled".
        logger.error("Failed to decrypt a stored MFA secret — has the key rotated?")
        return None


### 🔒 TOTP ##############################################################


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def build_provisioning_uri(secret: str, account_label: str) -> str:
    """Build the ``otpauth://`` URI that the enrollment QR code encodes."""
    return pyotp.TOTP(secret, interval=TOTP_PERIOD_SECONDS).provisioning_uri(
        name=account_label, issuer_name=TOTP_ISSUER
    )


def _normalize_code(code: str) -> str:
    return "".join(ch for ch in (code or "") if ch.isalnum()).upper()


def verify_totp_code(secret: str, code: str, last_used_timestep: Optional[int]) -> Tuple[bool, Optional[int]]:
    """Verify ``code`` against ``secret``.

    Returns ``(is_valid, timestep)``. ``timestep`` is the counter value the code
    matched and must be persisted by the caller as the new ``last_used_timestep``
    so the same code cannot be replayed while it is still within its window —
    the realistic attack being a code shoulder-surfed or phished seconds ago.
    """
    digits = _normalize_code(code)
    if not digits.isdigit() or len(digits) != 6:
        return False, None

    totp = pyotp.TOTP(secret, interval=TOTP_PERIOD_SECONDS)
    current_step = int(time.time()) // TOTP_PERIOD_SECONDS

    for offset in range(-TOTP_DRIFT_STEPS, TOTP_DRIFT_STEPS + 1):
        step = current_step + offset
        expected = totp.at(step * TOTP_PERIOD_SECONDS)
        if secrets.compare_digest(expected, digits):
            if last_used_timestep is not None and step <= last_used_timestep:
                return False, None
            return True, step

    return False, None


async def claim_totp_timestep(db_session: AsyncSession, user_id: int, step: int) -> bool:
    """Atomically record ``step`` as the highest used timestep for the user.

    Returns True only if this call won the claim. The conditional UPDATE succeeds
    for exactly one of any set of concurrent requests carrying the same code:
    everyone reads the same old ``last_used_timestep`` in :func:`verify_totp_code`,
    but only the first to commit satisfies ``last_used_timestep < step`` — the
    rest match zero rows and get False. That closes the replay window that a plain
    read-verify-then-write would leave open under parallel submission.
    """
    stmt = (
        update(UserMFA)
        .where(
            UserMFA.user_id == user_id,
            or_(
                UserMFA.last_used_timestep.is_(None),  # type: ignore[union-attr]
                UserMFA.last_used_timestep < step,
            ),
        )
        .values(last_used_timestep=step, update_date=str(datetime.now()))
        .returning(UserMFA.id)
        .execution_options(synchronize_session=False)
    )
    won = (await db_session.execute(stmt)).scalar_one_or_none() is not None
    await db_session.commit()
    return won


async def verify_and_consume_totp(
    db_session: AsyncSession,
    user_id: int,
    secret: str,
    code: str,
    last_used_timestep: Optional[int],
) -> bool:
    """Verify a TOTP ``code`` and atomically burn the timestep it matched.

    Returns True only when the code is valid *and* this request won the race to
    claim that timestep. Use this — never bare :func:`verify_totp_code` followed
    by an ORM write — anywhere a code authorises an action, so a single code can
    mint at most one session / perform at most one privileged operation.
    """
    is_valid, step = verify_totp_code(secret, code, last_used_timestep)
    if not is_valid or step is None:
        return False
    return await claim_totp_timestep(db_session, user_id, step)


### 🔒 Backup codes ##############################################################


_BACKUP_PEPPER = SECRET_KEY.encode() if isinstance(SECRET_KEY, str) else bytes(SECRET_KEY or b"")


def hash_backup_code(code: str) -> str:
    return hashlib.sha256(_BACKUP_PEPPER + _normalize_code(code).encode()).hexdigest()


def generate_backup_codes(count: int = BACKUP_CODE_COUNT) -> List[str]:
    """Generate display-formatted single-use recovery codes (``XXXXX-XXXXX``)."""
    codes = []
    for _ in range(count):
        raw = "".join(secrets.choice(_BACKUP_ALPHABET) for _ in range(BACKUP_CODE_LENGTH))
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


### 🔒 Persistence helpers ##############################################################


async def get_user_mfa(db_session: AsyncSession, user_id: int) -> Optional[UserMFA]:
    return (
        await db_session.execute(select(UserMFA).where(UserMFA.user_id == user_id))
    ).scalars().first()


async def is_mfa_active(db_session: AsyncSession, user_id: int) -> bool:
    """True when the user has a *confirmed* TOTP factor.

    Unconfirmed enrollment rows deliberately do not count — a half-finished
    setup must never gate login, or a user who closes the tab mid-enrollment is
    locked out with a factor they never registered in their app.
    """
    mfa = await get_user_mfa(db_session, user_id)
    return mfa is not None and mfa.confirmed_at is not None


async def replace_backup_codes(db_session: AsyncSession, user_id: int) -> List[str]:
    """Regenerate the batch, invalidating all previous codes. Returns plaintext
    codes — the only time they exist outside the user's hands."""
    existing = (
        await db_session.execute(
            select(UserMFABackupCode).where(UserMFABackupCode.user_id == user_id)
        )
    ).scalars().all()
    for row in existing:
        await db_session.delete(row)

    now = str(datetime.now())
    codes = generate_backup_codes()
    for code in codes:
        db_session.add(
            UserMFABackupCode(
                user_id=user_id, code_hash=hash_backup_code(code), creation_date=now
            )
        )
    await db_session.commit()
    return codes


async def consume_backup_code(db_session: AsyncSession, user_id: int, code: str) -> bool:
    """Burn a backup code. Returns False if unknown or already used.

    The claim is a single conditional UPDATE (``... WHERE used_at IS NULL``) so a
    code is consumed exactly once even under concurrent requests: two racers
    targeting the same unused code both match the row, but only the first commit
    flips ``used_at`` — the second matches zero rows and returns False. A prior
    select-then-update left a window where both could read it unused and both
    succeed, turning a recovery code into a replayable credential.
    """
    stmt = (
        update(UserMFABackupCode)
        .where(
            UserMFABackupCode.user_id == user_id,
            UserMFABackupCode.code_hash == hash_backup_code(code),
            UserMFABackupCode.used_at.is_(None),  # type: ignore[union-attr]
        )
        .values(used_at=str(datetime.now()))
        .returning(UserMFABackupCode.id)
        .execution_options(synchronize_session=False)
    )
    consumed = (await db_session.execute(stmt)).scalar_one_or_none() is not None
    await db_session.commit()
    return consumed


async def count_unused_backup_codes(db_session: AsyncSession, user_id: int) -> int:
    rows = (
        await db_session.execute(
            select(UserMFABackupCode).where(
                UserMFABackupCode.user_id == user_id,
                UserMFABackupCode.used_at.is_(None),  # type: ignore[union-attr]
            )
        )
    ).scalars().all()
    return len(rows)


async def disable_mfa(db_session: AsyncSession, user_id: int) -> None:
    """Remove the factor and every recovery code for a user."""
    mfa = await get_user_mfa(db_session, user_id)
    if mfa is not None:
        await db_session.delete(mfa)

    for row in (
        await db_session.execute(
            select(UserMFABackupCode).where(UserMFABackupCode.user_id == user_id)
        )
    ).scalars().all():
        await db_session.delete(row)

    await db_session.commit()
