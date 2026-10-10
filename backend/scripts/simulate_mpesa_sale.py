"""Creates an M-Pesa sale exactly as POST /transactions/initiate would, but without the
STK Push: no Daraja call, no prompt to anyone's phone, no money. The caller then
delivers a simulated Daraja callback to the real callback endpoint, so the real
callback, ledger and settlement code runs (CLAUDE.md section 2.1: a sandbox STK Push
to a real number charges real money, so test scripts fund balances this way).

The callback must go to /daraja/stk-callback/<callback_token> with Amount equal to
total_amount, exactly as Daraja would be told to (app/links.py, app/verification.py).
Safaricom's STK Push Query then says this sale doesn't exist, as it never went through
M-Pesa: with STK_QUERY_MODE=flag it stays credited and is flagged as a mismatch.

Prints one JSON line: {"id", "checkout_request_id", "callback_token", "total_amount", "maker_amount", "driver_amount"}.

Usage (from backend/, .env loaded):
  PYTHONPATH=. .venv/bin/python scripts/simulate_mpesa_sale.py <producer_id> <product|-> <photo|-> [driver_id]
"""

import asyncio
import json
import sys
import uuid
from decimal import Decimal

from sqlalchemy import text

from app import links
from app.db import async_session
from app.ledger import compute_split


async def main(producer_id: str, product: Decimal | None, photo: Decimal | None, driver_id: str | None) -> None:
    async with async_session() as session:
        pct = (
            await session.execute(
                text("select default_split_driver_pct from producers where id = :id"), {"id": producer_id}
            )
        ).scalar_one()
        split = compute_split(product_amount=product, photo_amount=photo, driver_pct=pct, has_driver=driver_id is not None)
        checkout_request_id = f"SIM-{uuid.uuid4()}"
        row = (
            await session.execute(
                text(
                    """
                    insert into transactions
                        (producer_id, driver_id, payment_method, product_enabled, product_amount,
                         product_maker_amount, product_driver_amount, photo_enabled, photo_amount,
                         total_amount, maker_amount, driver_amount, status)
                    values
                        (:producer_id, :driver_id, 'mpesa', :product_enabled, :product_amount,
                         :product_maker_amount, :product_driver_amount, :photo_enabled, :photo_amount,
                         :total_amount, :maker_amount, :driver_amount, 'initiated')
                    returning id
                    """
                ),
                {
                    "producer_id": producer_id,
                    "driver_id": driver_id,
                    "product_enabled": product is not None,
                    "product_amount": product,
                    "product_maker_amount": split["product_maker_amount"],
                    "product_driver_amount": split["product_driver_amount"],
                    "photo_enabled": photo is not None,
                    "photo_amount": photo,
                    "total_amount": split["total_amount"],
                    "maker_amount": split["maker_amount"],
                    "driver_amount": split["driver_amount"],
                },
            )
        ).one()
        await session.execute(
            text("insert into transaction_secrets (transaction_id, checkout_request_id) values (:id, :crid)"),
            {"id": row.id, "crid": checkout_request_id},
        )
        await session.commit()
    print(
        json.dumps(
            {
                "id": str(row.id),
                "checkout_request_id": checkout_request_id,
                "callback_token": links.callback_token(row.id),
                "total_amount": str(split["total_amount"]),
                "maker_amount": str(split["maker_amount"]),
                "driver_amount": str(split["driver_amount"]),
            }
        )
    )


if __name__ == "__main__":
    args = sys.argv[1:]
    amount = lambda v: None if v == "-" else Decimal(v)  # noqa: E731
    asyncio.run(main(args[0], amount(args[1]), amount(args[2]), args[3] if len(args) > 3 else None))
