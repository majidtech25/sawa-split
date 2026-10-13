"""Login attempt limiting (CLAUDE.md section 5, migration 0013).

5 failures for one phone in 15 minutes lock that phone for 15 minutes; 20 failures from
one IP in 15 minutes lock that IP. While either is locked, POST /auth/login answers
LOCKED_MESSAGE without checking the PIN, whether or not the phone is registered. A
successful login clears that phone's failures. Every lockout is written to the audit log.
"""

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import lifecycle
from .daraja import format_phone

WINDOW_MINUTES = 15
LOCK_MINUTES = 15
MAX_FAILURES_PER_PHONE = 5
MAX_FAILURES_PER_IP = 20
LOCKED_MESSAGE = "Too many attempts, try again in 15 minutes."


def phone_key(phone: str) -> str:
    """One key per phone however it's typed (+2547..., 07..., 2547...)."""
    return format_phone(phone)


def client_ip(request: Request) -> str:
    """The caller's IP for the per-IP limit.

    On Render, every request comes through Cloudflare, which sets CF-Connecting-IP to the
    real client address and refuses any request where the client set it (error 1000), so
    it can't be forged. Measured on Render (keyed /health): X-Forwarded-For there is
    "client, Cloudflare edge, Render internal": its last hop is shared by every visitor and
    its first is whatever the client wrote, and uvicorn's own client address follows that
    forgeable first hop. So neither is used. Without CF-Connecting-IP (local runs, no
    proxy) it's the direct socket address."""
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    return request.client.host if request.client else "unknown"


async def is_locked(session: AsyncSession, phone: str, ip: str) -> bool:
    return (
        await session.execute(
            text(
                "select exists (select 1 from login_lockouts where locked_until > now() and "
                "((kind = 'phone' and key = :phone) or (kind = 'ip' and key = :ip)))"
            ),
            {"phone": phone, "ip": ip},
        )
    ).scalar_one()


async def _who(session: AsyncSession, phone: str) -> tuple[str, object]:
    """For the audit log: which account a phone belongs to, if any."""
    for party_type, table in (("maker", "producers"), ("driver", "drivers")):
        row = (
            await session.execute(text(f"select id from {table} where phone = :p"), {"p": "+" + phone})
        ).one_or_none()
        if row is not None:
            return party_type, row.id
    coordinator = (
        await session.execute(text("select 1 from auth_credentials where phone = :p"), {"p": "+" + phone})
    ).one_or_none()
    return ("coordinator" if coordinator else "unknown"), None


async def record_failure(session: AsyncSession, phone: str, ip: str) -> None:
    """Records a failed attempt and locks the phone or IP if it just reached its limit.
    Commits."""
    await session.execute(text("insert into login_failures (phone, ip) values (:phone, :ip)"), {"phone": phone, "ip": ip})
    counts = (
        await session.execute(
            text(
                f"""
                select
                  (select count(*) from login_failures where phone = :phone and at > now() - interval '{WINDOW_MINUTES} minutes') as by_phone,
                  (select count(*) from login_failures where ip = :ip and at > now() - interval '{WINDOW_MINUTES} minutes') as by_ip
                """
            ),
            {"phone": phone, "ip": ip},
        )
    ).one()
    for kind, key, count, limit in (("phone", phone, counts.by_phone, MAX_FAILURES_PER_PHONE),
                                    ("ip", ip, counts.by_ip, MAX_FAILURES_PER_IP)):
        if count < limit:
            continue
        locked = (
            await session.execute(
                text(
                    f"""
                    insert into login_lockouts (kind, key, locked_until)
                    select :kind, :key, now() + interval '{LOCK_MINUTES} minutes'
                    where not exists (select 1 from login_lockouts where kind = :kind and key = :key and locked_until > now())
                    returning id
                    """
                ),
                {"kind": kind, "key": key},
            )
        ).one_or_none()
        if locked is None:
            continue  # already locked
        party_type, party_id = await _who(session, phone) if kind == "phone" else ("ip", None)
        await lifecycle.audit(
            session, "login_locked", party_type, party_id, actor_role="system",
            reason=f"{count} failed logins in {WINDOW_MINUTES} minutes; locked for {LOCK_MINUTES} minutes",
            details={"locked": kind, "phone": phone if kind == "phone" else None, "ip": ip},
        )
    await session.commit()


async def clear_failures(session: AsyncSession, phone: str) -> None:
    """A successful login clears that phone's counter. Commits."""
    await session.execute(text("delete from login_failures where phone = :phone"), {"phone": phone})
    await session.commit()


async def active_lockouts(session: AsyncSession) -> list:
    return (
        await session.execute(
            text("select id, kind, key, locked_until, created_at from login_lockouts where locked_until > now() order by created_at")
        )
    ).all()


async def clear_lockouts(
    session: AsyncSession, kind: str, key: str, *, actor_role: str, actor_id=None, actor_phone: str | None = None,
    reason: str | None = None,
) -> int:
    """Ends every active lockout of this phone or IP now and clears its failures, so the
    next correct PIN logs in. Audit-logged as login_unlocked. Commits; returns how many
    lockouts it ended (0 if none was active)."""
    if kind == "phone":
        key = phone_key(key)
    ended = (
        await session.execute(
            text("update login_lockouts set locked_until = now() where kind = :kind and key = :key and locked_until > now()"),
            {"kind": kind, "key": key},
        )
    ).rowcount
    await session.execute(
        text(f"delete from login_failures where {'phone' if kind == 'phone' else 'ip'} = :key"), {"key": key}
    )
    party_type, party_id = await _who(session, key) if kind == "phone" else ("ip", None)
    await lifecycle.audit(
        session, "login_unlocked", party_type, party_id, actor_role=actor_role, actor_id=actor_id,
        actor_phone=actor_phone, reason=reason,
        details={"unlocked": kind, "phone": key if kind == "phone" else None, "ip": key if kind == "ip" else None,
                 "lockouts_ended": ended},
    )
    await session.commit()
    return ended


async def prune() -> None:
    """Scheduler job: failures older than a day can't matter any more."""
    from .db import async_session

    async with async_session() as session:
        await session.execute(text("delete from login_failures where at < now() - interval '1 day'"))
        await session.commit()
