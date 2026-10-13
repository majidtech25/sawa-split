import base64
import time
from datetime import datetime
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from .config import settings

# Daraja reads the STK password timestamp as Kenyan time (EAT), whatever clock the
# server runs on (Render is UTC).
EAT = ZoneInfo("Africa/Nairobi")

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
    timestamp = datetime.now(EAT).strftime("%Y%m%d%H%M%S")
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


async def stk_query(checkout_request_id: str) -> dict[str, Any]:
    """Asks Daraja how an STK Push actually ended (STK Push Query). Returns the JSON
    body whatever the HTTP status: an answer comes back as ResultCode, and "not known
    yet" or "no such transaction" as an errorCode/errorMessage with HTTP 500 (both
    share errorCode 500.001.1001, so app/verification.py reads the message)."""
    token = await get_access_token()
    timestamp = datetime.now(EAT).strftime("%Y%m%d%H%M%S")
    password = base64.b64encode(
        f"{settings.daraja_shortcode}{settings.daraja_passkey}{timestamp}".encode()
    ).decode()
    body = {
        "BusinessShortCode": settings.daraja_shortcode,
        "Password": password,
        "Timestamp": timestamp,
        "CheckoutRequestID": checkout_request_id,
    }
    async with httpx.AsyncClient(base_url=settings.daraja_base_url, timeout=30) as client:
        resp = await client.post(
            "/mpesa/stkpushquery/v1/query", json=body, headers={"Authorization": f"Bearer {token}"}
        )
    try:
        return resp.json()
    except ValueError:
        return {"errorCode": f"http-{resp.status_code}", "errorMessage": resp.text[:200]}


# Safaricom's sandbox only pays its own test MSISDN; B2C to any other number fails with
# ResultCode 2040, and repeated failures lock the initiator (8006) for everyone. So in
# the sandbox a payout to any other number is refused here, before any request is sent.
SANDBOX_B2C_MSISDN = "254708374149"


class SandboxRecipientRefused(Exception):
    """A sandbox B2C to a number the sandbox can't pay. Nothing was sent to Daraja."""


def is_sandbox() -> bool:
    return "sandbox.safaricom.co.ke" in settings.daraja_base_url


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
    if is_sandbox() and format_phone(phone) != SANDBOX_B2C_MSISDN:
        raise SandboxRecipientRefused(
            f"Not sent: the Daraja sandbox only pays {SANDBOX_B2C_MSISDN}, and failed payouts lock the initiator."
        )
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
