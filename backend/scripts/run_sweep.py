"""Runs the 18:00 EAT payout sweep once, now — for verification and for a coordinator
who needs it run off-schedule. Real B2C payouts go out to everyone eligible.

Usage (from backend/): (set -a; source .env; set +a; PYTHONPATH=. .venv/bin/python scripts/run_sweep.py)
"""

import asyncio
import json

from app.payouts import run_daily_sweep

print(json.dumps(asyncio.run(run_daily_sweep()), indent=2))
