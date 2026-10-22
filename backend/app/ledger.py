from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CENTS = Decimal("0.01")

# The Conservation fund's one ledger account (migration 0020). Ring-fenced: its entries are
# never paid out by B2C, and the payout cap keeps its money out of every payout.
FUND_ID = "00000000-0000-0000-0000-00000000f00d"


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
        "split_model": "legacy",  # v1 price cards always split this way (migration 0020)
        "product_maker_amount": product_maker_amount,
        "product_driver_amount": product_driver_amount,
        "fund_amount": Decimal("0"),
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
    fund_amount: Decimal = Decimal("0"),
) -> None:
    """An M-Pesa sale's split, written once its STK callback confirms it (CLAUDE.md
    section 6), from the amounts stored on the transaction. Cash sales go through
    record_cash_sale below instead: their money is never in the M-Pesa account, so it
    must never become payable."""
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
    if fund_amount > 0:
        await session.execute(
            text(
                """
                insert into wallet_ledger_entries (recipient_type, recipient_id, amount, status, transaction_id)
                values ('fund', :fund_id, :amount, 'pending', :txn_id)
                """
            ),
            {"fund_id": FUND_ID, "amount": fund_amount, "txn_id": transaction_id},
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


# --- Cash sales and maker -> driver debts (CLAUDE.md rule 12, migration 0010) ---------
#
# Only M-Pesa money is ever payable. A cash sale's maker share is recorded as
# 'cash_held' (the maker already holds the notes); its driver share becomes a debt the
# maker owes the driver, settled by moving whole available entries of the maker's to
# the driver (plus change back to the maker), never by B2C. So the payable entries
# (pending/available/frozen/paid) always add up to exactly the M-Pesa money collected.

# Serializes everything that spends or pays out entries: debt settlement and payout
# initiation. Held until the caller's transaction commits or rolls back.
MONEY_LOCK_KEY = 7_262_021


async def lock_money(session: AsyncSession) -> None:
    await session.execute(text("select pg_advisory_xact_lock(:key)"), {"key": MONEY_LOCK_KEY})


async def record_cash_sale(session: AsyncSession, txn) -> None:
    """A cash sale has just reached cash_confirmed. Records the maker's share as held
    in cash, opens the driver's share and the Conservation fund's share (fixed split) as
    debts the maker owes, then tries to settle them at once."""
    if txn.maker_amount > 0:
        await session.execute(
            text(
                "insert into wallet_ledger_entries (recipient_type, recipient_id, amount, status, transaction_id) "
                "values ('maker', :producer_id, :amount, 'cash_held', :txn_id)"
            ),
            {"producer_id": txn.producer_id, "amount": txn.maker_amount, "txn_id": txn.id},
        )
    if txn.driver_id is not None and txn.driver_amount > 0:
        await session.execute(
            text(
                "insert into cash_debts (transaction_id, producer_id, driver_id, amount) "
                "values (:txn_id, :producer_id, :driver_id, :amount)"
            ),
            {"txn_id": txn.id, "producer_id": txn.producer_id, "driver_id": txn.driver_id, "amount": txn.driver_amount},
        )
    if txn.fund_amount > 0:
        await session.execute(
            text(
                "insert into cash_debts (transaction_id, producer_id, driver_id, creditor_type, amount) "
                "values (:txn_id, :producer_id, null, 'fund', :amount)"
            ),
            {"txn_id": txn.id, "producer_id": txn.producer_id, "amount": txn.fund_amount},
        )
    if (txn.driver_id is not None and txn.driver_amount > 0) or txn.fund_amount > 0:
        await settle_debts(session, txn.producer_id)


async def blocking_withdrawal(session: AsyncSession, recipient_type: str, recipient_id):
    """A withdrawal that must resolve before another starts: one still in flight, or
    a failed retry (retry_of set) that now waits for a coordinator. A failed first
    attempt doesn't block — it gets its automatic retry straight away, and if that
    never happened (refused, or the process restarted first) a later on-demand
    withdrawal or sweep is the next attempt."""
    return (
        await session.execute(
            text(
                "select id, status from withdrawal_requests where recipient_type = :rtype and recipient_id = :rid "
                "and (status in ('requested', 'processing') or (status = 'failed' and retry_of is not null)) limit 1"
            ),
            {"rtype": recipient_type, "rid": recipient_id},
        )
    ).one_or_none()


async def settle_debts(session: AsyncSession, producer_id) -> int:
    """Settles, oldest first, every outstanding debt this maker can cover in full from
    their available balance. Partial settlement isn't a thing: a debt waits until it
    fits. Skips debts whose cash sale is disputed (rule 13), and does nothing while a
    payout of the maker's is in flight or awaiting a coordinator retry, because that
    payout's amount was sized from these same entries. Returns how many it settled.
    Doesn't commit; the caller does."""
    await lock_money(session)
    if await blocking_withdrawal(session, "maker", producer_id) is not None:
        return 0
    debts = (
        await session.execute(
            text(
                """
                select d.id, d.transaction_id, d.driver_id, d.creditor_type, d.amount
                from cash_debts d join transactions t on t.id = d.transaction_id
                where d.producer_id = :pid and d.status = 'outstanding' and t.status <> 'disputed'
                order by d.created_at, d.creditor_type
                """
            ),
            {"pid": producer_id},
        )
    ).all()
    settled = 0
    for debt in debts:
        entries = (
            await session.execute(
                text(
                    "select id, amount, transaction_id from wallet_ledger_entries "
                    "where recipient_type = 'maker' and recipient_id = :pid and status = 'available' "
                    "order by created_at, id for update"
                ),
                {"pid": producer_id},
            )
        ).all()
        if sum((e.amount for e in entries), Decimal(0)) < debt.amount:
            continue
        spent, total = [], Decimal(0)
        for e in entries:
            spent.append(e)
            total += e.amount
            if total >= debt.amount:
                break
        await session.execute(
            text("update wallet_ledger_entries set status = 'transferred', settlement_id = :sid where id = any(:ids)"),
            {"sid": debt.id, "ids": [e.id for e in spent]},
        )
        await session.execute(
            text(
                "insert into wallet_ledger_entries (recipient_type, recipient_id, amount, status, transaction_id, settlement_id) "
                "values (:rtype, :rid, :amount, 'available', :txn_id, :sid)"
            ),
            {
                "rtype": debt.creditor_type,
                "rid": FUND_ID if debt.creditor_type == "fund" else debt.driver_id,
                "amount": debt.amount, "txn_id": debt.transaction_id, "sid": debt.id,
            },
        )
        change = total - debt.amount
        if change > 0:
            # The change keeps the transaction of the entry it came from, so a dispute
            # on that M-Pesa sale can still freeze it.
            await session.execute(
                text(
                    "insert into wallet_ledger_entries (recipient_type, recipient_id, amount, status, transaction_id, settlement_id) "
                    "values ('maker', :pid, :amount, 'available', :txn_id, :sid)"
                ),
                {"pid": producer_id, "amount": change, "txn_id": spent[-1].transaction_id, "sid": debt.id},
            )
        await session.execute(
            text("update cash_debts set status = 'settled', settled_at = now() where id = :id"), {"id": debt.id}
        )
        settled += 1
    return settled


async def available_balance(session: AsyncSession, recipient_type: str, recipient_id) -> Decimal:
    """Sum of available entries. Every one is M-Pesa money: cash shares are 'cash_held'."""
    return (
        await session.execute(
            text(
                "select coalesce(sum(amount), 0) from wallet_ledger_entries "
                "where recipient_type = :rtype and recipient_id = :rid and status = 'available'"
            ),
            {"rtype": recipient_type, "rid": recipient_id},
        )
    ).scalar_one()


async def fund_held(session: AsyncSession) -> Decimal:
    """The Conservation fund's M-Pesa money, still in the account: ring-fenced, so the
    payout cap keeps it out of every payout (migration 0020)."""
    return (
        await session.execute(
            text(
                "select coalesce(sum(amount), 0) from wallet_ledger_entries "
                "where recipient_type = 'fund' and status in ('pending', 'available', 'frozen')"
            )
        )
    ).scalar_one()


async def outstanding_debt(session: AsyncSession, producer_id) -> Decimal:
    """What this maker still owes drivers and the Conservation fund from cash sales, leaving out disputed sales
    (rule 13: excluded from every withdrawal calculation until resolved)."""
    return (
        await session.execute(
            text(
                "select coalesce(sum(d.amount), 0) from cash_debts d join transactions t on t.id = d.transaction_id "
                "where d.producer_id = :pid and d.status = 'outstanding' and t.status <> 'disputed'"
            ),
            {"pid": producer_id},
        )
    ).scalar_one()


async def payable_balance(session: AsyncSession, recipient_type: str, recipient_id) -> Decimal:
    """What a payout may send: the available M-Pesa-sourced balance, minus (for a
    maker) what they still owe drivers. Never negative."""
    balance = await available_balance(session, recipient_type, recipient_id)
    if recipient_type == "maker":
        balance -= await outstanding_debt(session, recipient_id)
    return max(balance, Decimal(0))
