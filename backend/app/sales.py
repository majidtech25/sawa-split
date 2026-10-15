"""Open sales, referral codes and stall codes (SCOPE_V2.md, migration 0017).

A maker types a sale (agreed amount, optional description, photo consent). The tourist
scans the maker's one static stand QR (/#/stall/<stall code>), sees the sale with a
server-computed breakdown, optionally with a referrer's code from their tour pass, and
pays by M-Pesa or cash through the same payment code as a signed price card.

A sale is single use. Starting a payment holds it ('paying'); a confirmed payment makes
it 'paid'; a failed STK Push, an expired cash sale or a Safaricom "not paid" releases it
('open' again while its 30 minutes last, else 'expired'). Paid, expired and cancelled
sales can't be paid.

Split, in whole shillings (rules 1-4):
  referrer = floor(agreed amount x maker's driver %)   (no code: 0)
  maker    = agreed amount - referrer  +  photo fee (if photo consent; never split)
The referrer's share is rounded down, so the parts always add up exactly, the maker's
product share never falls below their floor (rule 3), and no shilling is left over for
anyone else (rule 4).
"""

from datetime import datetime, timedelta, timezone
from decimal import ROUND_FLOOR, Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

SALE_MINUTES = 30


def compute_sale_split(amount: Decimal, photo_fee: Decimal | None, driver_pct: Decimal, has_referrer: bool) -> dict:
    """Same shape as ledger.compute_split, whole shillings (see the module docstring)."""
    amount = Decimal(amount)
    referrer = (amount * Decimal(driver_pct) / Decimal(100)).to_integral_value(rounding=ROUND_FLOOR) if has_referrer else Decimal(0)
    photo = Decimal(photo_fee) if photo_fee else Decimal(0)
    product_maker = amount - referrer
    return {
        "product_maker_amount": product_maker,
        "product_driver_amount": referrer,
        "maker_amount": product_maker + photo,
        "driver_amount": referrer,
        "total_amount": amount + photo,
    }


def first_name(name: str) -> str:
    return name.split()[0] if name.split() else name


async def referrer_by_code(session: AsyncSession, code: str, *, active_only: bool = True):
    """The driver whose referral code (case-insensitive) or old QR code this is, or None.
    Inactive (suspended, closing, closed) referrers count as unknown, unless active_only
    is False (the referrer page's "Not active" badge, MUST 12)."""
    code = (code or "").strip()
    if not code:
        return None
    return (
        await session.execute(
            text(
                "select id, name, referral_code, referrer_type, active from drivers where "
                + ("active and " if active_only else "")
                + "(lower(referral_code) = lower(:code) or qr_code = :code)"
            ),
            {"code": code},
        )
    ).one_or_none()


async def maker_by_stall_code(session: AsyncSession, code: str):
    return (
        await session.execute(
            text(
                "select id, name, site, active, photo_fee, default_split_driver_pct, stall_code, business_type "
                "from producers where lower(stall_code) = lower(:code)"
            ),
            {"code": (code or "").strip()},
        )
    ).one_or_none()


async def expire_due(session: AsyncSession, producer_id=None) -> None:
    """Open sales past their 30 minutes become 'expired'. A 'paying' sale is left to its
    payment, which ends it either way. Doesn't commit."""
    await session.execute(
        text(
            "update open_sales set status = 'expired' where status = 'open' and expires_at <= now()"
            + (" and producer_id = :pid" if producer_id else "")
        ),
        {"pid": producer_id} if producer_id else {},
    )


async def expire_open_sales() -> None:
    """Scheduler job."""
    from .db import async_session

    async with async_session() as session:
        await expire_due(session)
        await session.commit()


async def payment_finished(session: AsyncSession, transaction_id, *, paid: bool) -> None:
    """A payment for an open sale ended: the sale is 'paid', or released ('open' while its
    30 minutes last, else 'expired'). No-op for a signed-price-card payment. Doesn't commit."""
    await session.execute(
        text(
            """
            update open_sales s
            set status = case when :paid then 'paid' when s.expires_at > now() then 'open' else 'expired' end,
                paid_at = case when :paid then now() else s.paid_at end
            from transactions t
            where t.id = :tid and t.open_sale_id = s.id and s.status = 'paying'
            """
        ),
        {"tid": transaction_id, "paid": paid},
    )


async def paid_late(session: AsyncSession, transaction_id) -> None:
    """A payment Safaricom confirmed only after its sale was released (app/verification.py):
    the sale is paid, unless another payment has paid or is paying it, or the maker
    cancelled it. Doesn't commit."""
    await session.execute(
        text(
            """
            update open_sales s set status = 'paid', paid_at = now()
            from transactions t
            where t.id = :tid and t.open_sale_id = s.id and s.status in ('open', 'expired')
            """
        ),
        {"tid": transaction_id},
    )


def new_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=SALE_MINUTES)


async def unique_code(session: AsyncSession, table: str, column: str, name: str, fallback: str) -> str:
    """First name, letters only, upper case, at most 10 characters; a number appended when
    taken (case-insensitive). Same rule as migration 0017's backfill."""
    base = "".join(ch for ch in (name.split() or [""])[0] if ch.isascii() and ch.isalpha()).upper()[:10] or fallback
    candidate, n = base, 1
    while (
        await session.execute(text(f"select 1 from {table} where lower({column}) = lower(:c)"), {"c": candidate})
    ).one_or_none():
        n += 1
        candidate = f"{base}{n}"
    return candidate
