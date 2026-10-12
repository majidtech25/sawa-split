"""Coordinator-only: closure requests, suspensions and the audit log (CLAUDE.md rule
17). The rules themselves live in app/lifecycle.py."""

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import lifecycle, login_limits, payouts
from ..db import get_session
from ..ledger import payable_balance, settle_debts
from ..security import require_admin

router = APIRouter(prefix="/admin", tags=["admin"])

PartyType = Literal["maker", "driver"]
SUSPENSION_REVIEW_DAYS = 7


def _today_eat() -> date:
    return datetime.now(payouts.EAT).date()


def _actor(admin: dict[str, Any]) -> dict[str, Any]:
    return {"actor_role": "coordinator", "actor_id": admin["id"], "actor_phone": admin.get("phone")}


# --- Listing ----------------------------------------------------------------------------


class Suspension(BaseModel):
    reason: str
    review_on: date
    suspended_at: str
    overdue: bool               # past its review date and still in force


class Account(BaseModel):
    party_type: str
    id: str
    name: str
    phone: str
    account_status: str
    payable: Decimal
    suspension: Suspension | None


class ClosureRow(BaseModel):
    id: str
    party_type: str
    party_id: str
    name: str
    account_status: str
    status: str                 # pending, or approved (final payout in progress)
    reason: str
    requested_at: str
    payable: Decimal            # what the final payout would send
    blockers: list[str]         # why it can't be approved yet; empty when it can


class AuditRow(BaseModel):
    id: int
    at: str
    action: str
    party_type: str             # maker, driver, or for a login lockout coordinator/unknown/ip
    party_id: str | None
    party_name: str | None
    actor_role: str
    actor_phone: str | None
    reason: str | None


class Lockout(BaseModel):
    id: int
    kind: str                   # 'phone' or 'ip'
    key: str                    # the phone (254XXXXXXXXX) or the IP
    name: str | None            # whose phone, if it's registered
    locked_until: str


class AccountsResponse(BaseModel):
    accounts: list[Account]
    closure_requests: list[ClosureRow]
    audit: list[AuditRow]
    overdue_reviews: int
    lockouts: list[Lockout]     # login lockouts in force now (section 5)


@router.get("/accounts", response_model=AccountsResponse)
async def accounts(
    _admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AccountsResponse:
    today = _today_eat()
    parties = (
        await session.execute(
            text(
                """
                select 'maker' as party_type, id, name, phone, account_status, created_at from producers
                union all
                select 'driver', id, name, phone, account_status, created_at from drivers
                order by party_type desc, name
                """
            )
        )
    ).all()
    suspensions = {
        (s.party_type, s.party_id): s
        for s in (
            await session.execute(text("select * from account_suspensions where lifted_at is null"))
        ).all()
    }
    names = {(p.party_type, p.id): p for p in parties}

    account_rows = []
    for p in parties:
        s = suspensions.get((p.party_type, p.id))
        account_rows.append(
            Account(
                party_type=p.party_type, id=str(p.id), name=p.name, phone=p.phone, account_status=p.account_status,
                payable=await payable_balance(session, p.party_type, p.id),
                suspension=Suspension(
                    reason=s.reason, review_on=s.review_on, suspended_at=s.suspended_at.isoformat(),
                    overdue=s.review_on < today,
                ) if s else None,
            )
        )

    closures = []
    for c in (
        await session.execute(
            text("select * from closure_requests where status in ('pending', 'approved') order by requested_at")
        )
    ).all():
        p = names.get((c.party_type, c.party_id))
        closures.append(
            ClosureRow(
                id=str(c.id), party_type=c.party_type, party_id=str(c.party_id), name=p.name if p else "Unknown",
                account_status=p.account_status if p else "unknown", status=c.status, reason=c.reason,
                requested_at=c.requested_at.isoformat(),
                payable=await payable_balance(session, c.party_type, c.party_id),
                blockers=await lifecycle.closure_blockers(session, c.party_type, c.party_id) if c.status == "pending" else [],
            )
        )

    audit = (
        await session.execute(text("select * from account_audit_log order by at desc, id desc limit 200"))
    ).all()
    return AccountsResponse(
        accounts=account_rows,
        closure_requests=closures,
        audit=[
            AuditRow(
                id=a.id, at=a.at.isoformat(), action=a.action, party_type=a.party_type,
                party_id=str(a.party_id) if a.party_id else None,
                party_name=names[(a.party_type, a.party_id)].name if (a.party_type, a.party_id) in names else None,
                actor_role=a.actor_role, actor_phone=a.actor_phone, reason=a.reason,
            )
            for a in audit
        ],
        overdue_reviews=sum(1 for a in account_rows if a.suspension and a.suspension.overdue),
        lockouts=[
            Lockout(
                id=l.id, kind=l.kind, key=l.key, locked_until=l.locked_until.isoformat(),
                name=next((p.name for p in parties if l.kind == "phone" and login_limits.phone_key(p.phone) == l.key), None),
            )
            for l in await login_limits.active_lockouts(session)
        ],
    )


# --- Closure decisions ----------------------------------------------------------------


class ApproveBody(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class RejectBody(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class Payout(BaseModel):
    id: str
    amount: Decimal
    status: str


class ClosureDecision(BaseModel):
    id: str
    status: str                 # rejected, approved (final payout in progress) or closed
    account_status: str
    payout: Payout | None       # the final payout, when there was anything to pay


async def _pending_request(session: AsyncSession, request_id: str):
    row = (
        await session.execute(text("select * from closure_requests where id = cast(:id as uuid)"), {"id": request_id})
    ).one_or_none() if _is_uuid(request_id) else None
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Closure request not found")
    if row.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"This request is already {row.status}.")
    return row


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


@router.post("/closure-requests/{request_id}/approve", response_model=ClosureDecision)
async def approve_closure(
    request_id: str,
    body: ApproveBody,
    admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ClosureDecision:
    """Approves a closure: refused while anything is still in motion for the account
    (lifecycle.closure_blockers). Otherwise the account stops taking sales, its payable
    balance goes out by B2C even below KES 500, and it closes once that payout
    succeeds, or straight away when there's nothing to pay."""
    request = await _pending_request(session, request_id)
    ptype, pid = request.party_type, request.party_id
    if ptype == "maker":
        # A debt the maker can already cover shouldn't hold the closure up.
        await settle_debts(session, pid)
        await session.commit()
    blockers = await lifecycle.closure_blockers(session, ptype, pid)
    if blockers:
        raise HTTPException(status.HTTP_409_CONFLICT, "Can't approve yet. " + " ".join(blockers))

    claimed = (
        await session.execute(
            text(
                "update closure_requests set status = 'approved', decided_at = now(), decided_by = :by, "
                "decision_reason = :note where id = :id and status = 'pending' returning id"
            ),
            {"by": admin["id"], "note": (body.note or "").strip() or None, "id": request.id},
        )
    ).one_or_none()
    if claimed is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This request was decided a moment ago.")
    await session.execute(
        text(f"update {lifecycle.PARTY_TABLE[ptype]} set account_status = 'closing' where id = :id"), {"id": pid}
    )
    payable = await payable_balance(session, ptype, pid)
    await lifecycle.audit(
        session, "closure_approved", ptype, pid, **_actor(admin), reason=(body.note or "").strip() or None,
        details={"closure_request_id": str(request.id), "final_payout_amount": str(payable)},
    )
    await session.commit()

    if payable <= 0:
        await lifecycle.close_account(session, ptype, pid, request.id)
        await session.commit()
        who = await lifecycle.party(session, ptype, pid)
        await lifecycle.set_login_banned(session, who.phone, True)
        return ClosureDecision(id=str(request.id), status="closed", account_status="closed", payout=None)

    try:
        w = await payouts.start_payout(session, ptype, pid, minimum=Decimal("0.01"))
    except payouts.PayoutRefused as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Approved, but the final payout couldn't start: {exc} The account stays closing until it's paid.",
        ) from exc
    return ClosureDecision(
        id=str(request.id), status="approved", account_status="closing",
        payout=Payout(id=str(w.id), amount=w.amount, status=w.status),
    )


@router.post("/closure-requests/{request_id}/reject", response_model=ClosureDecision)
async def reject_closure(
    request_id: str,
    body: RejectBody,
    admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ClosureDecision:
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give a reason for rejecting the request.")
    request = await _pending_request(session, request_id)
    row = (
        await session.execute(
            text(
                "update closure_requests set status = 'rejected', decided_at = now(), decided_by = :by, "
                "decision_reason = :reason where id = :id and status = 'pending' returning id"
            ),
            {"by": admin["id"], "reason": reason, "id": request.id},
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This request was decided a moment ago.")
    await lifecycle.audit(
        session, "closure_rejected", request.party_type, request.party_id, **_actor(admin), reason=reason,
        details={"closure_request_id": str(request.id)},
    )
    await session.commit()
    who = await lifecycle.party(session, request.party_type, request.party_id)
    return ClosureDecision(id=str(request.id), status="rejected", account_status=who.account_status, payout=None)


# --- Suspension -----------------------------------------------------------------------


class SuspendBody(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)
    review_on: date | None = None   # default: 7 days from today (EAT)


class UnsuspendBody(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class SuspensionState(BaseModel):
    party_type: str
    id: str
    account_status: str
    suspension: Suspension | None


@router.post("/accounts/{party_type}/{party_id}/suspend", response_model=SuspensionState)
async def suspend(
    party_type: PartyType,
    party_id: str,
    body: SuspendBody,
    admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SuspensionState:
    """Blocks new sales and login, with a reason the suspended person sees. Earned money
    stays owed and is still paid by the normal rules; only disputes freeze (rule 13)."""
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give a reason for the suspension.")
    today = _today_eat()
    review_on = body.review_on or today + timedelta(days=SUSPENSION_REVIEW_DAYS)
    if review_on < today:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The review date can't be in the past.")
    who = await lifecycle.party(session, party_type, party_id) if _is_uuid(party_id) else None
    if who is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No such {party_type}.")
    if who.account_status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Only an active account can be suspended (this one is {who.account_status}).")
    updated = (
        await session.execute(
            text(
                f"update {lifecycle.PARTY_TABLE[party_type]} set account_status = 'suspended' "
                "where id = :id and account_status = 'active' returning id"
            ),
            {"id": party_id},
        )
    ).one_or_none()
    if updated is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This account changed a moment ago. Reload and try again.")
    s = (
        await session.execute(
            text(
                "insert into account_suspensions (party_type, party_id, reason, review_on, suspended_by) "
                "values (:ptype, :pid, :reason, :review_on, :by) returning *"
            ),
            {"ptype": party_type, "pid": party_id, "reason": reason, "review_on": review_on, "by": admin["id"]},
        )
    ).one()
    await lifecycle.audit(
        session, "suspended", party_type, party_id, **_actor(admin), reason=reason,
        details={"suspension_id": str(s.id), "review_on": review_on.isoformat()},
    )
    await session.commit()
    # No Supabase Auth ban here, unlike closure: login and every API call already
    # refuse a suspended account with its reason, and a ban would turn an open
    # session's refusal into a bare "invalid token" instead.
    return SuspensionState(
        party_type=party_type, id=party_id, account_status="suspended",
        suspension=Suspension(reason=s.reason, review_on=s.review_on, suspended_at=s.suspended_at.isoformat(), overdue=False),
    )


@router.post("/accounts/{party_type}/{party_id}/unsuspend", response_model=SuspensionState)
async def unsuspend(
    party_type: PartyType,
    party_id: str,
    body: UnsuspendBody,
    admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SuspensionState:
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give a reason for lifting the suspension.")
    who = await lifecycle.party(session, party_type, party_id) if _is_uuid(party_id) else None
    if who is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No such {party_type}.")
    if who.account_status != "suspended":
        raise HTTPException(status.HTTP_409_CONFLICT, "This account isn't suspended.")
    s = (
        await session.execute(
            text(
                "update account_suspensions set lifted_at = now(), lifted_by = :by, lift_reason = :reason "
                "where party_type = :ptype and party_id = :pid and lifted_at is null returning id"
            ),
            {"by": admin["id"], "reason": reason, "ptype": party_type, "pid": party_id},
        )
    ).one_or_none()
    await session.execute(
        text(f"update {lifecycle.PARTY_TABLE[party_type]} set account_status = 'active' where id = :id"), {"id": party_id}
    )
    await lifecycle.audit(
        session, "unsuspended", party_type, party_id, **_actor(admin), reason=reason,
        details={"suspension_id": str(s.id) if s else None},
    )
    await session.commit()
    return SuspensionState(party_type=party_type, id=party_id, account_status="active", suspension=None)


# --- Login lockouts -------------------------------------------------------------------


class UnlockBody(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)


class UnlockResult(BaseModel):
    kind: str
    key: str
    lockouts_ended: int


@router.post("/login-lockouts/{lockout_id}/clear", response_model=UnlockResult)
async def clear_login_lockout(
    lockout_id: int,
    body: UnlockBody,
    admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UnlockResult:
    """Ends a login lockout before its 15 minutes are up (section 5) and clears that
    phone's or IP's failed attempts. Audit-logged as login_unlocked, with who and why."""
    lockout = (
        await session.execute(text("select kind, key from login_lockouts where id = :id"), {"id": lockout_id})
    ).one_or_none()
    if lockout is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such lockout.")
    ended = await login_limits.clear_lockouts(
        session, lockout.kind, lockout.key, **_actor(admin), reason=(body.reason or "").strip() or None
    )
    return UnlockResult(kind=lockout.kind, key=lockout.key, lockouts_ended=ended)
