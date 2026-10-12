import asyncio

import bcrypt

# bcrypt cost. 10 rather than the library default of 12: on Render's free CPU a cost-12
# check took ~1.65s per login. A 4-digit PIN has only 10,000 values, so the real defence
# against guessing is login attempt limiting (app/login_limits.py), not hash cost.
# Hashes made at a higher cost are re-made at this one on the next successful login.
BCRYPT_ROUNDS = 10

# Checked against when the phone has no account, so an unknown phone takes as long as
# a wrong PIN and timing doesn't reveal which phones are registered.
_DUMMY_HASH = bcrypt.hashpw(b"0000", bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()


def verify_pin(pin: str, pin_hash: str) -> bool:
    return bcrypt.checkpw(pin.encode(), pin_hash.encode())


def needs_rehash(pin_hash: str) -> bool:
    """True when the hash was made at a different cost ($2b$12$... -> 12)."""
    try:
        return int(pin_hash.split("$")[2]) != BCRYPT_ROUNDS
    except (IndexError, ValueError):
        return True


# bcrypt is deliberately slow CPU work. Run it in a thread so a login doesn't stall every
# other request on the event loop while it hashes.
async def hash_pin_async(pin: str) -> str:
    return await asyncio.to_thread(hash_pin, pin)


async def verify_pin_async(pin: str, pin_hash: str | None) -> bool:
    if pin_hash is None:
        await asyncio.to_thread(verify_pin, pin, _DUMMY_HASH)
        return False
    return await asyncio.to_thread(verify_pin, pin, pin_hash)
