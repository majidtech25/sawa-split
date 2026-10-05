from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CENTS = Decimal("0.01")


def compute_split(
    *, product_amount: Decimal | None, photo_amount: Decimal | None, driver_pct: Decimal, has_driver: bool
) -> dict:
    """CLAUDE.md section 4: photo never splits (100% maker); product splits by the
    producer's own default_split_driver_pct only when a driver referred the sale.
    Driver's cut is rounded first and the maker's is the exact remainder, so the two
    always sum to product_amount with no rounding dust — no platform fee, ever."""
    product_maker_amount = None
    product_driver_amount = None
    if product_amount is not None:
        if has_driver:
            product_driver_amount = (product_amount * driver_pct / Decimal(100)).quantize(
                CENTS, rounding=ROUND_HALF_UP
            )
            product_maker_amount = product_amount - product_driver_amount
        else:
            product_driver_amount = Decimal("0")
            product_maker_amount = product_amount

    maker_amount = (product_maker_amount or Decimal("0")) + (photo_amount or Decimal("0"))
    driver_amount = product_driver_amount or Decimal("0")
    total_amount = (product_amount or Decimal("0")) + (photo_amount or Decimal("0"))

    return {
        "product_maker_amount": product_maker_amount,
        "product_driver_amount": product_driver_amount,
        "maker_amount": maker_amount,
        "driver_amount": driver_amount,
        "total_amount": total_amount,
    }


async def write_ledger_entries(
    session: AsyncSession,
    *,
    transaction_id: str,
    producer_id: str,
    driver_id: str | None,
    maker_amount: Decimal,
    driver_amount: Decimal,
) -> None:
    """Shared by the mpesa fake-confirm and cash dual-confirm paths once a transaction
    reaches its confirmed state (CLAUDE.md section 6) — same split, same pending entries,
    regardless of payment method."""
    await session.execute(
        text(
            """
            insert into wallet_ledger_entries (recipient_type, recipient_id, amount, status, transaction_id)
            values ('maker', :producer_id, :amount, 'pending', :txn_id)
            """
        ),
        {"producer_id": producer_id, "amount": maker_amount, "txn_id": transaction_id},
    )
    # Only if product_enabled, for the driver (section 6 step 2) — driver_amount is
    # already 0 whenever there's no driver or no product component, and the ledger
    # table's amount > 0 check means a 0 entry couldn't be inserted anyway.
    if driver_id is not None and driver_amount > 0:
        await session.execute(
            text(
                """
                insert into wallet_ledger_entries (recipient_type, recipient_id, amount, status, transaction_id)
                values ('driver', :driver_id, :amount, 'pending', :txn_id)
                """
            ),
            {"driver_id": driver_id, "amount": driver_amount, "txn_id": transaction_id},
        )

    # Section 6 step 3: balance becomes available once cleared for payout eligibility.
    # Neither CLAUDE.md nor the other docs define a separate clearing delay/condition,
    # and M-Pesa/cash confirmation is itself the irreversible, completed event — so
    # clearing happens immediately, as a second step right after the pending write
    # (kept as two steps, not one combined insert, to match section 6's literal wording
    # and leave 'pending' as a real, auditable — if momentary — state).
    await session.execute(
        text("update wallet_ledger_entries set status = 'available' where transaction_id = :txn_id and status = 'pending'"),
        {"txn_id": transaction_id},
    )
