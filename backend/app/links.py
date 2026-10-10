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


# --- Signed STK callback URLs ------------------------------------------------------------
#
# Each STK Push gets its own callback URL, /daraja/stk-callback/<token>, where the token
# is an HMAC of the transaction id. Daraja calls back exactly the URL it was given; a
# forged callback can't, because the token isn't stored anywhere a browser can read and
# can't be derived without the API's secret. Keyed with CHECKOUT_LINK_SECRET under its
# own label, so it never collides with a price-card signature.

def callback_token(transaction_id) -> str:
    message = f"stk-callback|v1|{str(transaction_id).lower()}".encode()
    return hmac.new(settings.checkout_link_secret.encode(), message, hashlib.sha256).hexdigest()


def callback_token_valid(token: str | None, transaction_id) -> bool:
    return bool(token) and hmac.compare_digest(token, callback_token(transaction_id))
