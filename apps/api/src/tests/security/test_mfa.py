"""Unit tests for the TOTP second-factor primitives.

These cover the parts where a subtle bug is silent and security-relevant:
secret encryption round-tripping, the drift window, and replay rejection.
"""

import time
from datetime import datetime

import pyotp
import pytest
from sqlmodel import select

from src.db.user_mfa import UserMFA, UserMFABackupCode
from src.services.auth.mfa import (
    TOTP_PERIOD_SECONDS,
    build_provisioning_uri,
    claim_totp_timestep,
    consume_backup_code,
    count_unused_backup_codes,
    decrypt_secret,
    encrypt_secret,
    generate_backup_codes,
    generate_totp_secret,
    hash_backup_code,
    replace_backup_codes,
    verify_and_consume_totp,
    verify_totp_code,
)


def _code_for(secret: str, step_offset: int = 0) -> str:
    step = int(time.time()) // TOTP_PERIOD_SECONDS + step_offset
    return pyotp.TOTP(secret, interval=TOTP_PERIOD_SECONDS).at(step * TOTP_PERIOD_SECONDS)


class TestSecretEncryption:
    def test_roundtrip(self):
        secret = generate_totp_secret()
        assert decrypt_secret(encrypt_secret(secret)) == secret

    def test_ciphertext_is_not_plaintext(self):
        secret = generate_totp_secret()
        assert secret not in encrypt_secret(secret)

    def test_encryption_is_non_deterministic(self):
        # Fernet embeds a random IV, so two encryptions of the same secret must
        # not be byte-identical — otherwise equal ciphertexts would leak that
        # two users share a secret.
        secret = generate_totp_secret()
        assert encrypt_secret(secret) != encrypt_secret(secret)

    def test_undecryptable_returns_none_rather_than_raising(self):
        # Simulates a rotated key. Callers must be able to distinguish "broken"
        # from "not enrolled"; a raise here would surface as a 500 instead.
        assert decrypt_secret("not-a-valid-fernet-token") is None


class TestProvisioningURI:
    def test_contains_issuer_and_account(self):
        uri = build_provisioning_uri(generate_totp_secret(), "learner@example.com")
        assert uri.startswith("otpauth://totp/")
        assert "issuer=LearnHouse" in uri
        assert "learner%40example.com" in uri


class TestTOTPVerification:
    def test_accepts_current_code(self):
        secret = generate_totp_secret()
        is_valid, step = verify_totp_code(secret, _code_for(secret), None)
        assert is_valid is True
        assert step is not None

    def test_accepts_one_step_of_drift_either_side(self):
        secret = generate_totp_secret()
        for offset in (-1, 1):
            is_valid, _ = verify_totp_code(secret, _code_for(secret, offset), None)
            assert is_valid is True, f"offset {offset} should be inside the drift window"

    def test_rejects_two_steps_of_drift(self):
        secret = generate_totp_secret()
        for offset in (-2, 2):
            is_valid, _ = verify_totp_code(secret, _code_for(secret, offset), None)
            assert is_valid is False, f"offset {offset} should be outside the drift window"

    def test_rejects_wrong_secret(self):
        is_valid, _ = verify_totp_code(
            generate_totp_secret(), _code_for(generate_totp_secret()), None
        )
        assert is_valid is False

    @pytest.mark.parametrize("bad", ["", "12345", "1234567", "abcdef", "12 34 56 78", None])
    def test_rejects_malformed_input(self, bad):
        assert verify_totp_code(generate_totp_secret(), bad, None)[0] is False

    def test_strips_spaces_and_dashes(self):
        secret = generate_totp_secret()
        code = _code_for(secret)
        spaced = f"{code[:3]} {code[3:]}"
        assert verify_totp_code(secret, spaced, None)[0] is True

    def test_rejects_replay_of_the_same_timestep(self):
        secret = generate_totp_secret()
        code = _code_for(secret)

        is_valid, step = verify_totp_code(secret, code, None)
        assert is_valid is True

        # Same code, now that the timestep has been recorded as spent.
        replayed, _ = verify_totp_code(secret, code, step)
        assert replayed is False

    def test_rejects_older_timestep_after_a_newer_one_was_used(self):
        secret = generate_totp_secret()
        current_step = int(time.time()) // TOTP_PERIOD_SECONDS

        # Previous step's code is normally inside the drift window, but must be
        # refused once the current step has already been consumed.
        is_valid, _ = verify_totp_code(secret, _code_for(secret, -1), current_step)
        assert is_valid is False


class TestBackupCodes:
    def test_generates_distinct_formatted_codes(self):
        codes = generate_backup_codes()
        assert len(codes) == 10
        assert len(set(codes)) == 10
        for code in codes:
            assert len(code) == 11 and code[5] == "-"

    def test_excludes_visually_ambiguous_characters(self):
        joined = "".join(generate_backup_codes(50)).replace("-", "")
        for ambiguous in "01OIL":
            assert ambiguous not in joined

    def test_hash_is_insensitive_to_formatting_and_case(self):
        canonical = hash_backup_code("ABCDE-FGHJK")
        assert hash_backup_code("abcde-fghjk") == canonical
        assert hash_backup_code("ABCDEFGHJK") == canonical
        assert hash_backup_code("  abcde fghjk  ") == canonical

    def test_distinct_codes_hash_differently(self):
        assert hash_backup_code("ABCDE-FGHJK") != hash_backup_code("ABCDE-FGHJM")

    def test_hash_is_not_reversible_to_plaintext(self):
        assert "ABCDE" not in hash_backup_code("ABCDE-FGHJK")


async def _enroll_confirmed(db, user_id, last_step=None):
    now = str(datetime.now())
    db.add(
        UserMFA(
            user_id=user_id,
            secret_encrypted="ciphertext",
            confirmed_at=now,
            last_used_timestep=last_step,
            creation_date=now,
            update_date=now,
        )
    )
    await db.commit()


@pytest.mark.asyncio
class TestTimestepClaim:
    """A code is single-use because the timestep is claimed by an atomic,
    conditional UPDATE — not read, checked, then written. These pin that a
    second claim of the same (or an older) step loses, which is what stops two
    concurrent logins from both minting a session off one intercepted code.
    """

    async def test_first_claim_wins_replay_loses(self, db, regular_user):
        await _enroll_confirmed(db, regular_user.id)
        step = int(time.time()) // TOTP_PERIOD_SECONDS

        assert await claim_totp_timestep(db, regular_user.id, step) is True
        # Same step again — already burned.
        assert await claim_totp_timestep(db, regular_user.id, step) is False

    async def test_older_step_cannot_be_claimed_after_a_newer_one(self, db, regular_user):
        await _enroll_confirmed(db, regular_user.id)
        step = int(time.time()) // TOTP_PERIOD_SECONDS

        assert await claim_totp_timestep(db, regular_user.id, step) is True
        assert await claim_totp_timestep(db, regular_user.id, step - 1) is False
        # A genuinely newer step is still claimable.
        assert await claim_totp_timestep(db, regular_user.id, step + 1) is True

    async def test_verify_and_consume_burns_the_code(self, db, regular_user):
        secret = generate_totp_secret()
        await _enroll_confirmed(db, regular_user.id)
        # Point the stored secret at a known value so we can mint a live code.
        mfa = (await db.execute(select(UserMFA).where(UserMFA.user_id == regular_user.id))).scalars().first()
        mfa.secret_encrypted = encrypt_secret(secret)
        await db.commit()

        code = pyotp.TOTP(secret, interval=TOTP_PERIOD_SECONDS).now()

        assert await verify_and_consume_totp(db, regular_user.id, secret, code, None) is True
        # Replaying the exact same code within its window must now fail.
        row = (await db.execute(select(UserMFA).where(UserMFA.user_id == regular_user.id))).scalars().first()
        assert await verify_and_consume_totp(db, regular_user.id, secret, code, row.last_used_timestep) is False

    # NB: true parallel racing is not exercised here — the shared test session is
    # a single connection (SQLAlchemy forbids concurrent ops on one AsyncSession,
    # and separate connections to in-memory SQLite would see different DBs). The
    # single-use guarantee is enforced by the conditional UPDATE at the DB layer;
    # the sequential tests above pin the contract that guarantee provides.


@pytest.mark.asyncio
class TestBackupCodeConsumption:
    """Backup codes must be burned exactly once. Consumption is a single
    conditional UPDATE (``WHERE used_at IS NULL``) so a racing second request
    against the same code matches zero rows instead of re-reading it as unused.
    """

    async def _add_code(self, db, user_id, code):
        db.add(
            UserMFABackupCode(
                user_id=user_id,
                code_hash=hash_backup_code(code),
                creation_date=str(datetime.now()),
            )
        )
        await db.commit()

    async def test_code_is_consumed_once(self, db, regular_user):
        await self._add_code(db, regular_user.id, "ABCDE-FGHJK")
        assert await consume_backup_code(db, regular_user.id, "ABCDE-FGHJK") is True
        assert await consume_backup_code(db, regular_user.id, "ABCDE-FGHJK") is False

    async def test_unknown_code_is_rejected(self, db, regular_user):
        assert await consume_backup_code(db, regular_user.id, "ZZZZZ-ZZZZZ") is False


@pytest.mark.asyncio
class TestDisableRemovesBackupCodes:
    async def test_disable_deletes_factor_and_codes(self, db, regular_user):
        from src.services.auth.mfa import disable_mfa, get_user_mfa

        await _enroll_confirmed(db, regular_user.id)
        # Give the account backup codes so disable exercises the delete loop.
        await replace_backup_codes(db, regular_user.id)
        assert await count_unused_backup_codes(db, regular_user.id) == 10

        await disable_mfa(db, regular_user.id)
        assert await get_user_mfa(db, regular_user.id) is None
        assert await count_unused_backup_codes(db, regular_user.id) == 0


@pytest.mark.asyncio
class TestRegenerateDeletesPriorCodes:
    async def test_second_generation_replaces_first(self, db, regular_user):
        await _enroll_confirmed(db, regular_user.id)
        first = await replace_backup_codes(db, regular_user.id)
        # Second call must delete the prior batch (the delete loop) before adding.
        second = await replace_backup_codes(db, regular_user.id)
        assert set(first).isdisjoint(second)
        assert await count_unused_backup_codes(db, regular_user.id) == 10


@pytest.mark.asyncio
class TestIssueSessionChallenge:
    async def test_mfa_active_user_gets_challenge_with_provenance(self, db, regular_user):
        from src.db.users import User
        from src.services.auth.session import (
            decode_mfa_pending_provenance,
            issue_session_or_challenge,
        )

        await _enroll_confirmed(db, regular_user.id)
        user = (
            await db.execute(select(User).where(User.id == regular_user.id))
        ).scalars().first()

        result = await issue_session_or_challenge(db, user, amr="password", org_id=7)
        assert result.mfa_required is True
        assert result.access_token is None
        # Provenance must ride the pending token so the /login/mfa step can stamp it.
        assert decode_mfa_pending_provenance(result.mfa_token) == ("password", 7)
