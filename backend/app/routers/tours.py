"""The referrer's tour (SCOPE_V2 MUST 17): start one with a group size, see who joined
and what it earned, end it. Logic lives in app/tours.py."""

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import tours
from ..caller import resolve_producer_or_driver
from ..db import get_session

router = APIRouter(prefix="/tours", tags=["tours"])


class Tour(BaseModel):
    id: str
    group_size: int
    joined: int
    started_at: str
    ends_at: str
    sales: int                  # referred sales on this tour that went through
    commission: Decimal         # the referrer's shares of them


class StartTour(BaseModel):
    group_size: int = Field(ge=1, le=tours.MAX_GROUP)


async def _driver_id(session: AsyncSession, authorization: str | None) -> str:
    role, party_id = await resolve_producer_or_driver(session, authorization)
    if role != "driver":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a site intermediary runs a tour.")
    return party_id


async def _view(session: AsyncSession, t) -> Tour:
    earned = (
        await session.execute(
            text(
                "select count(*) as sales, coalesce(sum(driver_amount), 0) as commission from transactions "
                "where tour_id = :t and status in ('confirmed', 'cash_confirmed', 'disputed')"
            ),
            {"t": t.id},
        )
    ).one()
    return Tour(
        id=str(t.id), group_size=t.group_size, joined=await tours.joined(session, t.id),
        started_at=t.started_at.isoformat(), ends_at=t.ends_at.isoformat(),
        sales=earned.sales, commission=earned.commission,
    )


@router.get("/current", response_model=Tour | None)
async def current_tour(
    session: Annotated[AsyncSession, Depends(get_session)], authorization: Annotated[str | None, Header()] = None
) -> Tour | None:
    did = await _driver_id(session, authorization)
    t = await tours.open_tour(session, did)
    await session.commit()
    return await _view(session, t) if t else None


@router.post("", response_model=Tour, status_code=status.HTTP_201_CREATED)
async def start_tour(
    body: StartTour,
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> Tour:
    """One open tour per referrer; it ends at midnight EAT unless ended sooner."""
    did = await _driver_id(session, authorization)
    if await tours.open_tour(session, did) is not None:
        await session.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have a tour running. End it first.")
    t = (
        await session.execute(
            text("insert into tours (driver_id, group_size, ends_at) values (:d, :n, :e) returning *"),
            {"d": did, "n": body.group_size, "e": tours.next_midnight_eat()},
        )
    ).one()
    await session.commit()
    return await _view(session, t)


@router.post("/current/end", response_model=Tour)
async def end_tour(
    session: Annotated[AsyncSession, Depends(get_session)], authorization: Annotated[str | None, Header()] = None
) -> Tour:
    """Ends the running tour: nobody else can join, and its joins stop earning referrals."""
    did = await _driver_id(session, authorization)
    t = await tours.open_tour(session, did, lock=True)
    if t is None:
        await session.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, "You don't have a tour running.")
    t = (await session.execute(text("update tours set ended_at = now() where id = :id returning *"), {"id": t.id})).one()
    await session.commit()
    return await _view(session, t)
