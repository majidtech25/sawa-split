"""In-process jobs (CLAUDE.md section 1: Render's free tier has no native cron).

One API process runs on Render, so one scheduler: a second worker would run every
job twice. The sweep's own guards (in-flight and withdrew-today checks) make a
duplicate run refuse rather than double-pay, but keep it to one worker anyway.
"""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from . import login_limits, payouts, sales, verification

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
    # Section 6 step 2: have Safaricom confirm each STK callback (STK_QUERY_MODE).
    scheduler.add_job(
        verification.run_due_checks, IntervalTrigger(seconds=20),
        id="stk_push_query", coalesce=True, max_instances=1,
    )
    # A payment with no final result after 10 minutes: release its sale, keep asking.
    scheduler.add_job(
        verification.mark_unresolved, IntervalTrigger(minutes=1),
        id="mark_unresolved_payments", coalesce=True, max_instances=1,
    )
    # SCOPE_V2: open sales nobody paid within 30 minutes expire.
    scheduler.add_job(
        sales.expire_open_sales, IntervalTrigger(minutes=1),
        id="expire_open_sales", coalesce=True, max_instances=1,
    )
    # Section 5: old login failures can't affect a lockout any more.
    scheduler.add_job(
        login_limits.prune, IntervalTrigger(hours=1),
        id="prune_login_failures", coalesce=True, max_instances=1,
    )
    return scheduler
