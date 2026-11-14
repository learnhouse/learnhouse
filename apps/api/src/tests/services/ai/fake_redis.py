"""A small in-memory Redis for the AI credit tests.

Implements the commands the credit store and the metering module use, and runs
the credit store's Lua scripts (reserve, refund, charge-up-to) as Python
equivalents, picked by script source.
"""

from __future__ import annotations

from src.security.features_utils import usage


class FakeRedis:
    def __init__(self):
        self.kv: dict[str, str] = {}
        self.hashes: dict[str, dict[str, int]] = {}
        self.expiries: dict[str, int] = {}

    # strings
    def get(self, key):
        val = self.kv.get(key)
        return None if val is None else str(val).encode()

    def mget(self, *keys):
        return [self.get(k) for k in keys]

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.kv:
            return None
        self.kv[key] = str(value)
        if ex:
            self.expiries[key] = ex
        return True

    def incrby(self, key, amount):
        self.kv[key] = str(int(self.kv.get(key, 0)) + int(amount))
        return int(self.kv[key])

    def delete(self, *keys):
        for k in keys:
            self.kv.pop(k, None)
            self.hashes.pop(k, None)

    def expire(self, key, seconds):
        self.expiries[key] = seconds

    # hashes
    def hincrby(self, key, field, amount=1):
        h = self.hashes.setdefault(key, {})
        h[field] = h.get(field, 0) + int(amount)
        return h[field]

    def hgetall(self, key):
        return {k.encode(): str(v).encode() for k, v in self.hashes.get(key, {}).items()}

    # scripts
    def _int(self, key):
        return int(self.kv.get(key, 0) or 0)

    def register_script(self, src):
        fake = self

        def reserve(keys, args):
            base, extra, amount, unlimited = int(args[0]), int(args[1]), int(args[2]), args[3] == "1"
            if unlimited:
                return fake.incrby(keys[0], amount)
            total = base + extra + fake._int(keys[1])
            if total - fake._int(keys[0]) < amount:
                return -1
            return fake.incrby(keys[0], amount)

        def refund(keys, args):
            new = max(fake._int(keys[0]) - int(args[0]), 0)
            fake.kv[keys[0]] = str(new)
            return new

        def up_to(keys, args):
            amount = int(args[2])
            if args[3] == "1":
                fake.incrby(keys[0], amount)
                return amount
            room = int(args[0]) + int(args[1]) + fake._int(keys[1]) - fake._int(keys[0])
            if room <= 0:
                return 0
            amount = min(amount, room)
            fake.incrby(keys[0], amount)
            return amount

        scripts = {
            usage._ATOMIC_RESERVE_LUA: reserve,
            usage._REFUND_LUA: refund,
            usage._CHARGE_UP_TO_LUA: up_to,
        }
        fn = scripts[src]
        return lambda keys, args: fn(keys, args)
