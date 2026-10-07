"""Signed price-card links.

A price card's link (and the QR printed from it) carries the stall, its prices and
the referring driver in the URL. Without a signature anyone could edit those — set
the product to KSh 1, or swap in their own driver QR — and the card would still
look official. The signature is an HMAC over exactly those four values, keyed with
CHECKOUT_LINK_SECRET, which only the API holds.
"""

import hashlib
import hmac
from decimal import Decimal

from .config import settings

INVALID_CARD = "This price card isn't valid — ask the seller for a new one."


def _amount(value) -> str:
    # 100, "100" and "100.00" must sign identically.
    return "" if value is None else str(Decimal(value).quantize(Decimal("0.01")))


def _message(producer_id: str, product, photo, driver_qr: str | None) -> bytes:
    return "|".join(["v1", str(producer_id).lower(), _amount(product), _amount(photo), driver_qr or ""]).encode()


def sign(producer_id: str, product, photo, driver_qr: str | None) -> str:
    return hmac.new(
        settings.checkout_link_secret.encode(), _message(producer_id, product, photo, driver_qr), hashlib.sha256
    ).hexdigest()


def is_valid(signature: str | None, producer_id: str, product, photo, driver_qr: str | None) -> bool:
    if not signature:
        return False
    return hmac.compare_digest(signature, sign(producer_id, product, photo, driver_qr))
