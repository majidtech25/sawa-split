import base64
import time
from datetime import datetime
from decimal import Decimal
from typing import Any

import httpx

from .config import settings

_token_cache: dict[str, Any] = {"token": None, "expires_at": 0.0}


def format_phone(phone: str) -> str:
    """Daraja wants 254XXXXXXXXX — no '+', no leading 0, no spaces or dashes."""
    digits = "".join(ch for ch in phone if ch.isdigit())
    if digits.startswith("0"):
        digits = "254" + digits[1:]
    elif digits.startswith("7") or digits.startswith("1"):
        digits = "254" + digits
    return digits


async def get_access_token() -> str:
    # Sandbox tokens are valid ~3600s; cache with a safety margin rather than
    # fetching a fresh one on every call.
    if _token_cache["token"] and time.time() < _token_cache["expires_at"] - 30:
        return _token_cache["token"]
    credentials = base64.b64encode(
        f"{settings.daraja_consumer_key}:{settings.daraja_consumer_secret}".encode()
    ).decode()
    async with httpx.AsyncClient(base_url=settings.daraja_base_url) as client:
        resp = await client.get(
            "/oauth/v1/generate",
            params={"grant_type": "client_credentials"},
            headers={"Authorization": f"Basic {credentials}"},
        )
    resp.raise_for_status()
    data = resp.json()
    _token_cache["token"] = data["access_token"]
    _token_cache["expires_at"] = time.time() + int(data["expires_in"])
    return _token_cache["token"]


async def stk_push(
    *, phone: str, amount: Decimal, account_reference: str, transaction_desc: str, callback_url: str
) -> dict[str, Any]:
    token = await get_access_token()
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    password = base64.b64encode(
        f"{settings.daraja_shortcode}{settings.daraja_passkey}{timestamp}".encode()
    ).decode()
    phone = format_phone(phone)
    body = {
        "BusinessShortCode": settings.daraja_shortcode,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": int(amount),  # M-Pesa doesn't use sub-shilling amounts in practice.
        "PartyA": phone,
        "PartyB": settings.daraja_shortcode,
        "PhoneNumber": phone,
        "CallBackURL": callback_url,
        "AccountReference": account_reference,
        "TransactionDesc": transaction_desc,
    }
    async with httpx.AsyncClient(base_url=settings.daraja_base_url) as client:
        resp = await client.post(
            "/mpesa/stkpush/v1/processrequest", json=body, headers={"Authorization": f"Bearer {token}"}
        )
    resp.raise_for_status()
    return resp.json()


async def b2c_payment(
    *,
    phone: str,
    amount: Decimal,
    remarks: str,
    occasion: str,
    result_url: str,
    timeout_url: str,
    originator_conversation_id: str,
) -> dict[str, Any]:
    token = await get_access_token()
    body = {
        "OriginatorConversationID": originator_conversation_id,
        "InitiatorName": settings.daraja_initiator_name,
        "SecurityCredential": settings.daraja_security_credential,
        "CommandID": "BusinessPayment",
        "Amount": int(amount),
        "PartyA": settings.daraja_b2c_shortcode,
        "PartyB": format_phone(phone),
        "Remarks": remarks,
        "QueueTimeOutURL": timeout_url,
        "ResultURL": result_url,
        "Occasion": occasion,
    }
    async with httpx.AsyncClient(base_url=settings.daraja_base_url) as client:
        resp = await client.post(
            "/mpesa/b2c/v3/paymentrequest", json=body, headers={"Authorization": f"Bearer {token}"}
        )
    resp.raise_for_status()
    return resp.json()
