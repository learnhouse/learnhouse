"""Tests for src/services/packs/packs.py."""

from datetime import datetime
from fnmatch import fnmatch
from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException

from src.db.packs import OrgPack, PackStatusEnum, PackTypeEnum
from src.services.packs.packs import (
    _add_member_seats,
    _apply_pack_credits,
    _remove_ai_credits,
    _remove_member_seats,
    _revoke_pack_credits,
    activate_pack,
    deactivate_all_packs_for_org,
    deactivate_pack,
    get_org_active_packs,
    get_org_pack_summary,
    mark_pack_canceling,
    reconcile_pack_credits,
)


class FakeRedis:
    def __init__(self, initial=None):
        self.values = dict(initial or {})

    def _normalize(self, key):
        return key.decode() if isinstance(key, bytes) else key

    def incrby(self, key, amount):
        key = self._normalize(key)
        value = int(self.values.get(key, 0)) + amount
        self.values[key] = value
        return value

    def decrby(self, key, amount):
        key = self._normalize(key)
        value = int(self.values.get(key, 0)) - amount
        self.values[key] = value
        return value

    def get(self, key):
        return self.values.get(self._normalize(key))

    def set(self, key, value):
        self.values[self._normalize(key)] = value

    def scan_iter(self, match=None):
        for key in list(self.values):
            if match is None or fnmatch(key, match):
                yield key.encode()


class FakeTask:
    def add_done_callback(self, callback):
        callback(self)


def _make_pack(db, org, **overrides):
    pack = OrgPack(
        id=overrides.pop("id", None),
        org_id=overrides.pop("org_id", org.id),
        pack_type=overrides.pop("pack_type", PackTypeEnum.ai_credits),
        pack_id=overrides.pop("pack_id", "ai_500"),
        quantity=overrides.pop("quantity", 500),
        status=overrides.pop("status", PackStatusEnum.active),
        activated_at=overrides.pop("activated_at", datetime(2024, 1, 1)),
        cancelled_at=overrides.pop("cancelled_at", None),
        cancel_at_period_end=overrides.pop("cancel_at_period_end", False),
        platform_subscription_id=overrides.pop(
            "platform_subscription_id", "sub_123"
        ),
    )
    db.add(pack)
    db.commit()
    db.refresh(pack)
    return pack


class TestPackHelpers:
    def test_credit_helpers_and_dispatchers(self):
        redis = FakeRedis({"member_seats_purchased:1": 3, "ai_credits_purchased:1": 2})

        with patch(
            "src.services.packs.packs._get_redis_client",
            return_value=redis,
        ), patch(
            "src.services.packs.packs.add_ai_credits",
            side_effect=lambda org_id, amount: redis.incrby(
                f"ai_credits_purchased:{org_id}", amount
            ),
        ):
            assert _add_member_seats(1, 4) == 7
            assert _remove_member_seats(1, 9) == 0
            assert _remove_ai_credits(1, 5) == 0

            _apply_pack_credits(1, {"type": "ai_credits", "quantity": 6})
            _apply_pack_credits(1, {"type": "member_seats", "quantity": 2})
            _revoke_pack_credits(1, PackTypeEnum.ai_credits, 1)
            _revoke_pack_credits(1, PackTypeEnum.member_seats, 1)

        assert redis.values["member_seats_purchased:1"] == 1
        assert redis.values["ai_credits_purchased:1"] == 5


class TestPackLifecycle:
    def test_activate_pack_create_reactivate_and_guards(self, db, org, other_org):
        redis = FakeRedis()
        background_tasks = Mock()
        fake_task = FakeTask()

        with patch(
            "src.services.packs.packs._get_redis_client",
            return_value=redis,
        ), patch(
            "src.services.packs.packs.add_ai_credits",
            side_effect=lambda org_id, amount: redis.incrby(
                f"ai_credits_purchased:{org_id}", amount
            ),
        ), patch(
            "src.services.packs.packs.dispatch_webhooks",
            new=Mock(),
        ) as dispatch_webhooks, patch(
            "src.services.packs.packs.asyncio.create_task",
            return_value=fake_task,
        ) as create_task, patch(
            "src.services.packs.packs._background_tasks",
            new=background_tasks,
        ):
            created = activate_pack(
                org.id,
                "ai_500",
                "sub_new",
                db,
            )

            _make_pack(
                db,
                org,
                id=2,
                pack_id="seats_200",
                pack_type=PackTypeEnum.member_seats,
                quantity=200,
                status=PackStatusEnum.cancelled,
                platform_subscription_id="sub_cancelled",
                cancelled_at=datetime(2024, 1, 2),
                cancel_at_period_end=True,
            )
            reactivated = activate_pack(
                org.id,
                "seats_200",
                "sub_cancelled",
                db,
            )

            active = _make_pack(
                db,
                org,
                id=3,
                pack_id="ai_500_active",
                pack_type=PackTypeEnum.ai_credits,
                quantity=500,
                status=PackStatusEnum.active,
                platform_subscription_id="sub_active",
            )
            same_org = activate_pack(
                org.id,
                "ai_500",
                "sub_active",
                db,
            )

            foreign = _make_pack(
                db,
                other_org,
                id=4,
                pack_id="ai_500_other",
                pack_type=PackTypeEnum.ai_credits,
                quantity=500,
                status=PackStatusEnum.active,
                platform_subscription_id="sub_foreign",
            )
            with pytest.raises(HTTPException) as unknown_exc:
                activate_pack(org.id, "missing_pack", "sub_missing", db)

            with pytest.raises(HTTPException) as cross_org_exc:
                activate_pack(org.id, "ai_500", "sub_foreign", db)

        assert created.pack_id == "ai_500"
        assert redis.values["ai_credits_purchased:1"] == 500
        assert redis.values["member_seats_purchased:1"] == 200
        assert reactivated.status == PackStatusEnum.active
        assert reactivated.cancel_at_period_end is False
        assert reactivated.cancelled_at is None
        assert same_org.id == active.id
        assert foreign.org_id == other_org.id
        assert unknown_exc.value.status_code == 400
        assert cross_org_exc.value.status_code == 409
        dispatch_webhooks.assert_called()
        create_task.assert_called()
        background_tasks.add.assert_called()
        background_tasks.discard.assert_called()

    def test_deactivate_pack_and_deactivate_all(self, db, org):
        redis = FakeRedis(
            {
                "ai_credits_purchased:1": 500,
                "member_seats_purchased:1": 200,
            }
        )
        background_tasks = Mock()
        fake_task = FakeTask()

        _make_pack(
            db,
            org,
            id=10,
            pack_id="ai_500",
            pack_type=PackTypeEnum.ai_credits,
            quantity=500,
            platform_subscription_id="sub_ai",
        )
        _make_pack(
            db,
            org,
            id=11,
            pack_id="seats_200",
            pack_type=PackTypeEnum.member_seats,
            quantity=200,
            platform_subscription_id="sub_seats",
        )
        _make_pack(
            db,
            org,
            id=12,
            pack_id="cancelled",
            pack_type=PackTypeEnum.ai_credits,
            quantity=100,
            status=PackStatusEnum.cancelled,
            platform_subscription_id="sub_cancelled",
            cancelled_at=datetime(2024, 1, 3),
        )

        with patch(
            "src.services.packs.packs._get_redis_client",
            return_value=redis,
        ), patch(
            "src.services.packs.packs.dispatch_webhooks",
            new=Mock(),
        ) as dispatch_webhooks, patch(
            "src.services.packs.packs.asyncio.create_task",
            return_value=fake_task,
        ) as create_task, patch(
            "src.services.packs.packs._background_tasks",
            new=background_tasks,
        ):
            cancelled_result = deactivate_pack(org.id, "sub_cancelled", db)
            deactivated_ai = deactivate_pack(org.id, "sub_ai", db)
            deactivated_count = deactivate_all_packs_for_org(org.id, db)

            with pytest.raises(HTTPException) as missing_exc:
                deactivate_pack(org.id, "missing-sub", db)

            with pytest.raises(HTTPException) as canceling_exc:
                mark_pack_canceling(org.id, "missing-sub", db)

        assert cancelled_result.status == PackStatusEnum.cancelled
        assert deactivated_ai.status == PackStatusEnum.cancelled
        assert redis.values["ai_credits_purchased:1"] == 0
        assert redis.values["member_seats_purchased:1"] == 0
        assert deactivated_count == 1
        assert missing_exc.value.status_code == 404
        assert canceling_exc.value.status_code == 404
        dispatch_webhooks.assert_called()
        create_task.assert_called()
        background_tasks.add.assert_called()
        background_tasks.discard.assert_called()

    def test_get_org_pack_summary_and_mark_canceling(self, db, org):
        _make_pack(
            db,
            org,
            id=20,
            pack_id="ai_500",
            pack_type=PackTypeEnum.ai_credits,
            quantity=500,
            platform_subscription_id="sub_ai_summary",
        )
        _make_pack(
            db,
            org,
            id=21,
            pack_id="seats_200",
            pack_type=PackTypeEnum.member_seats,
            quantity=200,
            platform_subscription_id="sub_seats_summary",
        )
        _make_pack(
            db,
            org,
            id=22,
            pack_id="cancelled_summary",
            pack_type=PackTypeEnum.ai_credits,
            quantity=100,
            status=PackStatusEnum.cancelled,
            platform_subscription_id="sub_cancelled_summary",
        )

        summary = get_org_pack_summary(org.id, db)
        active = get_org_active_packs(org.id, db)
        marked = mark_pack_canceling(org.id, "sub_ai_summary", db)

        assert summary == {
            "ai_credits": 500,
            "member_seats": 200,
            "active_pack_count": 2,
        }
        assert {pack.pack_id for pack in active} == {"ai_500", "seats_200"}
        assert marked.cancel_at_period_end is True

    def test_reconcile_pack_credits(self, db, org, other_org):
        _make_pack(
            db,
            org,
            id=30,
            pack_id="ai_500",
            pack_type=PackTypeEnum.ai_credits,
            quantity=500,
            platform_subscription_id="sub_ai_reconcile",
        )
        _make_pack(
            db,
            org,
            id=31,
            pack_id="seats_200",
            pack_type=PackTypeEnum.member_seats,
            quantity=200,
            platform_subscription_id="sub_seats_reconcile",
        )
        _make_pack(
            db,
            other_org,
            id=32,
            pack_id="ai_500_other",
            pack_type=PackTypeEnum.ai_credits,
            quantity=500,
            platform_subscription_id="sub_ai_other",
        )

        redis = FakeRedis(
            {
                "ai_credits_purchased:1": 125,
                "member_seats_purchased:1": 999,
                "ai_credits_purchased:2": 500,
                "member_seats_purchased:2": 77,
                "ai_credits_purchased:3": 66,
                "ai_credits_purchased:bad": 50,
                "member_seats_purchased:bad": 10,
            }
        )

        with patch(
            "src.services.packs.packs._get_redis_client",
            return_value=redis,
        ):
            result = reconcile_pack_credits(db)

        assert result == {
            "orgs": 2,
            "ai_credits_fixed": 2,
            "member_seats_fixed": 2,
        }
        assert redis.values["ai_credits_purchased:1"] == 500
        assert redis.values["member_seats_purchased:1"] == 200
        assert redis.values["ai_credits_purchased:2"] == 500
        assert redis.values["member_seats_purchased:2"] == 0
        assert redis.values["ai_credits_purchased:bad"] == 50
        assert redis.values["member_seats_purchased:bad"] == 10
