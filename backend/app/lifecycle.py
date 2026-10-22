"""Account closure and suspension (CLAUDE.md rule 17, migration 0011).

Closure: a maker or driver asks, a coordinator approves. Approval is refused while
anything is still in motion for that account. On approval the account stops taking
sales ('closing') and its remaining payable balance is paid out by B2C, even below
KES 500. Only once that payout succeeds (or there was nothing to pay) is it 'closed'.
If the payout fails, the account stays 'closing' and the usual retry rules apply.

Suspension: a coordinator's call, with a reason and a review date. It blocks new
sales and login, but honestly earned money stays owed and the sweep still pays it.
Only disputed sales stay frozen (rule 13).

Every request, cancel, approve, reject, closure, suspend and unsuspend is written to
account_audit_log, which nobody can edit or delete.
"""

import json
import logging
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import supabase_auth
from .ledger import available_balance, blocking_withdrawal

log = logging.getLogger("sawa.lifecycle")

PARTY_TABLE = {"maker": "producers", "driver": "drivers"}


async def party(session: AsyncSession, party_type: str, party_id):
    """The maker's or driver's row (name, phone, account_status), or None."""
    return (
        await session.execute(
            text(f"select id, name, phone, account_status from {PARTY_TABLE[party_type]} where id = :id"),
            {"id": party_id},
        )
    ).one_or_none()


async def audit(
    session: AsyncSession,
    action: str,
    party_type: str,
    party_id,
    *,
    actor_role: str,
    actor_id=None,
    actor_phone: str | None = None,
    reason: str | None = None,
    details: dict | None = None,
) -> None:
    await session.execute(
        text(
            """
            insert into account_audit_log (action, party_type, party_id, actor_role, actor_id, actor_phone, reason, details)
            values (:action, :ptype, :pid, :role, :actor_id, :phone, :reason, cast(:details as jsonb))
            """
        ),
        {
            "action": action, "ptype": party_type, "pid": party_id, "role": actor_role, "actor_id": actor_id,
            "phone": actor_phone, "reason": reason, "details": json.dumps(details or {}, default=str),
        },
    )


async def active_suspension(session: AsyncSession, party_type: str, party_id):
    return (
        await session.execute(
            text(
                "select id, reason, review_on, suspended_at from account_suspensions "
                "where party_type = :ptype and party_id = :pid and lifted_at is null"
            ),
            {"ptype": party_type, "pid": party_id},
        )
    ).one_or_none()


async def closure_blockers(session: AsyncSession, party_type: str, party_id) -> list[str]:
    """Why a closure can't be approved yet, in plain words; empty when it can."""
    column = "producer_id" if party_type == "maker" else "driver_id"
    r = (
        await session.execute(
            text(
                f"""
                select
                  (select account_status from {PARTY_TABLE[party_type]} where id = :pid) as account_status,
                  (select count(*) from transactions where {column} = :pid and status = 'cash_unconfirmed') as cash_pending,
                  (select count(*) from transactions where {column} = :pid and status = 'disputed') as disputes,
                  (select count(*) from withdrawal_requests where recipient_type = :ptype and recipient_id = :pid
                     and status in ('requested', 'processing')) as payouts_in_flight,
                  (select count(*) from withdrawal_requests where recipient_type = :ptype and recipient_id = :pid
                     and status = 'failed') as payouts_failed,
                  (select coalesce(sum(amount), 0) from cash_debts where {column} = :pid and status = 'outstanding') as debt
                """
            ),
            {"pid": party_id, "ptype": party_type},
        )
    ).one()
    blockers = []
    if r.account_status == "suspended":
        blockers.append("The account is suspended. Unsuspend it first, or reject the request.")
    if r.cash_pending:
        blockers.append(f"{r.cash_pending} cash {'sale is' if r.cash_pending == 1 else 'sales are'} still waiting for confirmation.")
    if r.disputes:
        blockers.append(f"{r.disputes} open {'dispute' if r.disputes == 1 else 'disputes'}.")
    if r.payouts_in_flight:
        blockers.append("A payout is in progress.")
    if r.payouts_failed:
        blockers.append("A failed payout is waiting for a retry.")
    if r.debt > 0:
        debt = f"KSh {r.debt:,.0f}" if r.debt == r.debt.to_integral_value() else f"KSh {r.debt:,.2f}"
        blockers.append(
            f"{debt} from cash sales is still owed to site intermediaries."
            if party_type == "maker"
            else f"{debt} from cash sales is still owed to this site intermediary by creators."
        )
    return blockers


async def login_refusal(session: AsyncSession, party_type: str, party_id, account_status: str) -> str | None:
    """Why this maker or driver may not use their account right now (suspended or
    closed), in words they'll see; None when they may. A closing account can still log
    in to watch its final payout."""
    if account_status == "suspended":
        s = await active_suspension(session, party_type, party_id)
        reason = s.reason if s else "no reason recorded"
        review = f" It will be reviewed by {s.review_on:%d %b %Y}." if s else ""
        return f"Your account is suspended: {reason}.{review} Talk to your site coordinator. Money you've already earned is still paid out by the usual rules."
    if account_status == "closed":
        return "This account is closed. Talk to your site coordinator if that's a mistake."
    return None


async def auth_user_id(session: AsyncSession, phone: str):
    return (
        await session.execute(text("select auth_user_id from auth_credentials where phone = :phone"), {"phone": phone})
    ).scalar_one_or_none()


async def set_login_banned(session: AsyncSession, phone: str, banned: bool) -> None:
    """Second layer behind POST /auth/login's own check. Best effort: a failure is
    logged, not raised, because login stays refused regardless."""
    user_id = await auth_user_id(session, phone)
    if user_id is None:
        return
    try:
        await supabase_auth.set_banned(str(user_id), banned)
    except Exception:
        log.exception("Could not %s Supabase Auth user %s", "ban" if banned else "unban", user_id)


async def close_account(session: AsyncSession, party_type: str, party_id, request_id, *, payout_id=None) -> None:
    """Marks the account and its approved request closed and audits it. Doesn't commit."""
    await session.execute(
        text(f"update {PARTY_TABLE[party_type]} set account_status = 'closed' where id = :id"), {"id": party_id}
    )
    await session.execute(
        text("update closure_requests set status = 'closed', closed_at = now() where id = :id"), {"id": request_id}
    )
    await audit(
        session, "account_closed", party_type, party_id, actor_role="system",
        reason="Final payout complete" if payout_id else "Nothing left to pay out",
        details={"closure_request_id": str(request_id), "final_withdrawal_id": str(payout_id) if payout_id else None},
    )


async def finish_closure_if_paid_out(session: AsyncSession, party_type: str, party_id, payout_id) -> bool:
    """Called after a successful B2C payout: if this account is closing and nothing is
    left to pay or in flight, it's now closed. Commits; returns whether it closed."""
    who = await party(session, party_type, party_id)
    if who is None or who.account_status != "closing":
        return False
    request = (
        await session.execute(
            text("select id from closure_requests where party_type = :ptype and party_id = :pid and status = 'approved'"),
            {"ptype": party_type, "pid": party_id},
        )
    ).one_or_none()
    if request is None:
        return False
    if await blocking_withdrawal(session, party_type, party_id) is not None:
        return False
    left = await available_balance(session, party_type, party_id)
    if left > Decimal(0):
        log.warning("%s %s is closing but KSh %s is still available after its final payout", party_type, party_id, left)
        return False
    await close_account(session, party_type, party_id, request.id, payout_id=payout_id)
    await session.commit()
    await set_login_banned(session, who.phone, True)
    return True
