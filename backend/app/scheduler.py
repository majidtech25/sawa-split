"""In-process jobs (CLAUDE.md section 1: Render's free tier has no native cron).

One API process runs on Render, so one scheduler: a second worker would run every
job twice. The sweep's own guards (in-flight and withdrew-today checks) make a
duplicate run refuse rather than double-pay, but keep it to one worker anyway.
"""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from . import payouts

log = logging.getLogger("sawa.scheduler")


def build_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone=payouts.EAT)
    # Rule 10: the daily payout sweep at 18:00 EAT.
    scheduler.add_job(
        payouts.run_daily_sweep, CronTrigger(hour=18, minute=0, timezone=payouts.EAT),
        id="daily_payout_sweep", coalesce=True, max_instances=1, misfire_grace_time=3600,
    )
    # Rule 12: expire cash sales nobody confirmed within the window.
    scheduler.add_job(
        payouts.expire_unconfirmed_cash, IntervalTrigger(minutes=1),
        id="expire_unconfirmed_cash", coalesce=True, max_instances=1,
    )
    return scheduler
