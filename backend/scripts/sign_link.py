"""Prints a signed price-card link path (app/links.py), e.g. for test scripts.
The coordinator's Price cards screen (POST /admin/price-cards) is the normal way to
make one; this skips its validity checks.

Usage (from backend/, .env loaded):
  PYTHONPATH=. .venv/bin/python scripts/sign_link.py <producer_id> <product|-> <photo|-> [driver_qr]
  PYTHONPATH=. .venv/bin/python scripts/sign_link.py --sig <producer_id> <product|-> <photo|-> [driver_qr]
"""

import sys
from urllib.parse import urlencode

from app import links

args = sys.argv[1:]
sig_only = args[:1] == ["--sig"]
if sig_only:
    args = args[1:]
producer_id, product, photo = args[0], args[1], args[2]
driver = args[3] if len(args) > 3 else None
product = None if product == "-" else product
photo = None if photo == "-" else photo
sig = links.sign(producer_id, product, photo, driver)
if sig_only:
    print(sig)
else:
    params = {k: v for k, v in (("product", product), ("photo", photo), ("driver", driver)) if v is not None}
    print(f"/pay/{producer_id}?{urlencode({**params, 'sig': sig})}")
