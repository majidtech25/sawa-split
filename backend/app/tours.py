"""Tours (SCOPE_V2 MUST 17, migration 0018): a referral is earned only through a tour.

A referrer starts a tour from their dashboard with a group size (1-30). It ends at
midnight EAT, or earlier when they end it; they have at most one open tour. A tourist
joins it by scanning the referrer's QR ("Use X as my guide today") or by typing the code
at checkout. Each join is counted here, on the server, and hands the tourist's phone a
join token (only its hash is stored). An open sale earns the referrer a share only when
it carries a valid join for that referrer's tour that is still running.

So a code alone earns nothing: no tour, or a full one, and the tourist pays with no
referral (maker 100%). A referrer can't farm their code past the group size they set,
and that's capped at 30 a tour. Signed price cards (v1) are unchanged: their driver is
part of the signed card, not a tour.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import sales

MAX_GROUP = 30
EAT = timezone(timedelta(hours=3))  # Nairobi: UTC+3, no daylight saving


class TourRefused(Exception):
    """The tourist can't join: no tour running, or it's full. The message is for them."""


def no_tour(name: str) -> str:
    return f"{sales.first_name(name)} isn't running a tour right now."


def tour_full(name: str) -> str:
    return f"{sales.first_name(name)}'s tour is full."


def next_midnight_eat(now: datetime | None = None) -> datetime:
    now = (now or datetime.now(timezone.utc)).astimezone(EAT)
    return datetime(now.year, now.month, now.day, tzinfo=EAT) + timedelta(days=1)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def close_past(session: AsyncSession, driver_id=None) -> None:
    """Tours past their midnight are closed, so the next one can start. Doesn't commit."""
    await session.execute(
        text(
            "update tours set ended_at = ends_at where ended_at is null and ends_at <= now()"
            + (" and driver_id = :d" if driver_id else "")
        ),
        {"d": driver_id} if driver_id else {},
    )


async def open_tour(session: AsyncSession, driver_id, *, lock: bool = False):
    """The referrer's running tour, or None. Doesn't commit."""
    await close_past(session, driver_id)
    return (
        await session.execute(
            text("select * from tours where driver_id = :d and ended_at is null" + (" for update" if lock else "")),
            {"d": driver_id},
        )
    ).one_or_none()


async def joined(session: AsyncSession, tour_id) -> int:
    return (await session.execute(text("select count(*) from tour_joins where tour_id = :t"), {"t": tour_id})).scalar_one()


async def has_join(session: AsyncSession, tour_id, token: str | None) -> bool:
    if not token:
        return False
    return (
        await session.execute(
            text("select 1 from tour_joins where tour_id = :t and token_hash = :h"), {"t": tour_id, "h": hash_token(token)}
        )
    ).one_or_none() is not None


async def join(session: AsyncSession, referrer) -> tuple[str, object]:
    """Counts one tourist into the referrer's running tour and returns (join token, tour).
    The tour row is locked, so two joins at once can't overfill it. Raises TourRefused.
    Doesn't commit."""
    tour = await open_tour(session, referrer.id, lock=True)
    if tour is None:
        raise TourRefused(no_tour(referrer.name))
    if await joined(session, tour.id) >= tour.group_size:
        raise TourRefused(tour_full(referrer.name))
    token = secrets.token_urlsafe(24)
    await session.execute(
        text("insert into tour_joins (tour_id, token_hash) values (:t, :h)"), {"t": tour.id, "h": hash_token(token)}
    )
    return token, tour


async def check_referral(session: AsyncSession, referrer, token: str | None):
    """For showing a breakdown (no join is used up): (tour, None) when this sale would
    earn the referral, else (None, why not). A valid join for the running tour earns it;
    without one, a seat must be left (paying will join)."""
    tour = await open_tour(session, referrer.id)
    if tour is None:
        return None, no_tour(referrer.name)
    if await has_join(session, tour.id, token):
        return tour, None
    if await joined(session, tour.id) >= tour.group_size:
        return None, tour_full(referrer.name)
    return tour, None


async def referral_for_payment(session: AsyncSession, referrer, token: str | None):
    """At payment: the tour this sale's referral is earned through. A valid join is used
    as is; otherwise the tourist joins now (the code typed at checkout), which takes a
    seat. Raises TourRefused. Doesn't commit."""
    tour = await open_tour(session, referrer.id, lock=True)
    if tour is not None and await has_join(session, tour.id, token):
        return tour
    _token, tour = await join(session, referrer)
    return tour
