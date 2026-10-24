#!/usr/bin/env bash
# Verifies the fixed split and the Conservation fund (CLAUDE.md rule 4, SCOPE_V2 MUST 21,
# migration 0020) on the TEST project, with no STK Push, no STK Push Query and no B2C.
# The real API runs in this process (httpx's ASGITransport: real endpoints, no server, no
# scheduler), and every Daraja function is replaced by a stub: stk_push answers like
# Daraja without sending anything, and the rest refuse and are counted, so the run fails
# if anything tried to reach Daraja. Payments are confirmed by simulated callbacks to the
# real /daraja/stk-callback endpoint, or by Safaricom answers simulated in-process.
#   - legacy (the default) splits exactly as before: the creator's own %, no fund;
#   - fixed: 1000 -> 800/150/50; 700 + 10 photo -> 570/105/35; no intermediary
#     1000 -> 950/0/50; 333 -> 268/49/16; the parts always add up to the price;
#   - the split is stored when the payment starts: a sale made in fixed mode and credited
#     after switching to legacy (late credit, callback, cash confirmation) is still 80/15/5;
#   - cash: the intermediary's 15% and the fund's 5% are debts from the creator, settled
#     from her M-Pesa earnings, also after switching back to legacy (the rollback path);
#     a disputed sale's fund debt waits like the intermediary's;
#   - the fund is never payable: not in the creator's payable, not a sweep candidate,
#     refused as a payout recipient, and the payout cap keeps its money out;
#   - reconciliation: collected = creators + intermediaries + fund, balanced.
# Needs no API server, and none may run (its scheduler would act on the same rows).
# Usage (from backend/): (set -a; source .env; set +a; bash scripts/verify_split_model.sh)
set -uo pipefail

case "${SUPABASE_URL:-}" in *jmbktbcnwyshwobbkohl*) ;; *) echo "FATAL: not the TEST project."; exit 1;; esac
if curl -s -m 3 -o /dev/null http://127.0.0.1:8000/health; then
  echo "FATAL: an API is running on :8000; stop it first (its scheduler would touch these rows)."; exit 1
fi
q() { psql "$DATABASE_URL" -tAc "$1"; }
PRODUCER_ID=$(q "select id from producers where phone = '+254708374149';")
DRIVER_ID=$(q "select id from drivers where phone = '+254799999003';")
[ -n "$PRODUCER_ID" ] && [ -n "$DRIVER_ID" ] || { echo "FATAL: test fixtures not found."; exit 1; }
BUSY=$(q "select (select count(*) from open_sales where producer_id = '$PRODUCER_ID' and status in ('open','paying'))
  + (select count(*) from wallet_ledger_entries where (recipient_id in ('$PRODUCER_ID','$DRIVER_ID') or recipient_type = 'fund')
       and status in ('pending','available','frozen'))
  + (select count(*) from cash_debts where status = 'outstanding')
  + (select count(*) from withdrawal_requests where status in ('requested','processing'))
  + (select count(*) from tours where driver_id = '$DRIVER_ID' and ended_at is null and ends_at > now());")
[ "$BUSY" = "0" ] || { echo "FATAL: the fixtures already hold an open sale, a balance, a debt, a payout or a running tour."; exit 1; }
STARTED_AT=$(q "select now();")
export STARTED_AT PRODUCER_ID DRIVER_ID

cleanup() {
  echo
  echo "== Cleanup: this run's sales, payments, ledger rows, debts, tours and test payout row =="
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
    begin;
    create temp table run_txns on commit drop as
      select id from transactions where producer_id = '$PRODUCER_ID' and (created_at >= '$STARTED_AT'
        or open_sale_id in (select id from open_sales where producer_id = '$PRODUCER_ID' and created_at >= '$STARTED_AT'));
    delete from wallet_ledger_entries where transaction_id in (select id from run_txns)
      or settlement_id in (select id from cash_debts where transaction_id in (select id from run_txns));
    delete from cash_debts where transaction_id in (select id from run_txns);
    delete from transactions where id in (select id from run_txns);
    delete from open_sales where producer_id = '$PRODUCER_ID' and created_at >= '$STARTED_AT';
    delete from tour_joins where tour_id in (select id from tours where started_at >= '$STARTED_AT');
    delete from tours where started_at >= '$STARTED_AT';
    delete from withdrawal_requests where requested_at >= '$STARTED_AT' and b2c_receipt is null and status = 'processing'
      and recipient_id = '$DRIVER_ID';
    delete from login_failures where at >= '$STARTED_AT';
    commit;" && echo "cleanup ok" || { echo "cleanup FAILED: this run's rows may be left"; exit 1; }
}
trap cleanup EXIT

PYTHONPATH=. .venv/bin/python -u - <<'PY'
import asyncio, logging, os, sys, traceback, uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D

import httpx
from sqlalchemy import text

from app import daraja, payouts, verification
from app.config import settings
from app.db import async_session
from app.ledger import FUND_ID, payable_balance
from app.main import app
from app.sales import compute_sale_split

PRODUCER, DRIVER = os.environ["PRODUCER_ID"], os.environ["DRIVER_ID"]
PINS = {"maker": ("+254708374149", "1111"), "driver": ("+254799999003", "2222"), "coord": ("+254799999001", "9999")}
passed = failed = 0
DARAJA_ATTEMPTS = []

def check(desc, actual, expected):
    global passed, failed
    if actual == expected:
        print(f"PASS  {desc}"); passed += 1
    else:
        print(f"FAIL  {desc} (expected {expected!r}, got {actual!r})"); failed += 1

# Nothing reaches Daraja. stk_push answers as Daraja would (the sale then waits for a
# simulated callback); every other call is refused and counted.
async def fake_stk_push(**kw):
    return {"ResponseCode": "0", "CheckoutRequestID": f"SIM-{uuid.uuid4()}"}
def blocked(name):
    async def _refuse(*a, **k):
        DARAJA_ATTEMPTS.append(name)
        raise RuntimeError(f"{name} is blocked in this test")
    return _refuse
daraja.stk_push = fake_stk_push
for name in ("b2c_payment", "stk_query", "get_access_token"):
    setattr(daraja, name, blocked(name))

async def paid(_):
    return {"ResponseCode": "0", "ResultCode": "0", "ResultDesc": "The service request is processed successfully."}

client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=120)
TOKENS = {}

# Every retried request is logged with the API's own error (app/main.py logs each unhandled
# one on 'sawa.errors'). Only a DB/network timeout may be retried quietly: any other 5xx
# counts as a failure, even if the retry then succeeds.
TIMEOUT_NAMES = {"TimeoutError", "ConnectTimeout", "ReadTimeout", "WriteTimeout", "PoolTimeout",
                 "ConnectionDoesNotExistError", "ConnectionResetError", "ConnectionRefusedError"}
RETRIES = []

class ApiErrors(logging.Handler):
    last = None
    def emit(self, record):
        if record.exc_info:
            self.last = record.exc_info[1]
API_ERRORS = ApiErrors()
logging.getLogger("sawa.errors").addHandler(API_ERRORS)

def _chain(exc):
    seen = []
    while exc is not None and exc not in seen:
        seen.append(exc)
        exc = exc.__cause__ or exc.__context__
    return seen

def note_retry(call, outcome):
    global failed
    exc = outcome if isinstance(outcome, BaseException) else API_ERRORS.last
    API_ERRORS.last = None
    status = getattr(outcome, "status_code", type(outcome).__name__)
    if exc is None:
        timeout, desc = False, "the API logged no exception for it"
    else:
        frames = traceback.extract_tb(exc.__traceback__)
        mine = [f for f in frames if "/backend/app/" in f.filename]
        f = (mine or frames or [None])[-1]
        where = f"{f.filename.split('/backend/')[-1]}:{f.lineno} in {f.name}" if f else "?"
        links = _chain(exc)
        names = [type(e).__name__ for e in links]
        text_all = " ".join(str(e) for e in links).lower()
        timeout = bool(TIMEOUT_NAMES & set(names)) or "connection was closed" in text_all or "connection is closed" in text_all
        first = str(exc).splitlines()[0][:140] if str(exc) else ""
        desc = f"{type(exc).__module__}.{type(exc).__name__}: {first} (chain: {' <- '.join(names)}) at {where}"
    kind = "timeout" if timeout else "FAILURE"
    RETRIES.append(f"[{kind}] {call} -> {status}: {desc}")
    print(f"RETRY [{kind}] {call} -> {status}: {desc}")
    if not timeout:
        failed += 1

async def login(who):
    phone, pin = PINS[who]
    for _ in range(3):
        r = await client.post("/auth/login", json={"phone": phone, "pin": pin})
        if r.status_code == 200:
            TOKENS[who] = r.json()["access_token"]; return
        await asyncio.sleep(2)
    sys.exit(f"FATAL: could not log in {who}: {r.status_code} {r.text[:200]}")

def auth(who):
    return {"Authorization": f"Bearer {TOKENS[who]}"}

async def req(method, url, **kw):
    """A request to the in-process API, retried on a 5xx or a dropped connection: this dev
    network's pooler stalls now and then (CLAUDE.md section 2). Only for calls that are safe
    to repeat; creating a sale or a payment goes through new_sale / pay below."""
    for attempt in range(3):
        try:
            r = await client.request(method, url, **kw)
            if r.status_code < 500:
                return r
        except httpx.HTTPError as exc:
            r = exc
        note_retry(f"{method} {url}", r)
        await asyncio.sleep(3)
    return r

async def new_sale(amount, photo=False):
    for attempt in range(3):
        r = await client.post("/sales", json={"amount": amount, "description": "split-model test", "photo": photo}, headers=auth("maker"))
        if r.status_code == 201:
            return r.json()["id"]
        if r.status_code < 500:
            break
        note_retry("POST /sales", r)
        # A 5xx may still have created it: use it if it's there.
        cur = await req("GET", "/sales/current", headers=auth("maker"))
        if cur.status_code == 200 and cur.json() and cur.json().get("status") == "open" and int(cur.json()["amount"]) == amount:
            return cur.json()["id"]
        await asyncio.sleep(3)
    sys.exit(f"FATAL: could not start a sale: {r.status_code} {r.text[:200]}")

async def pay(sale_id, method, *, ref=True, join=None):
    body = {"payment_method": method}
    if method == "mpesa":
        body["phone"] = f"2547{uuid.uuid4().int % 10**8:08d}"  # a fresh number each time: the STK rate limit is per phone
    if ref:
        body.update(referral_code="JAMES", join_token=join)
    for attempt in range(3):
        r = await client.post(f"/public/sales/{sale_id}/pay", json=body)
        if r.status_code == 201:
            return r.json()
        if r.status_code >= 500:
            note_retry(f"POST /public/sales/{sale_id}/pay", r)
        elif attempt == 0:
            break   # a refusal on the first try is a real answer, not a stall
        # A 5xx may still have started the payment: use it if it's there.
        async with async_session() as s2:
            row = (await s2.execute(text(
                "select t.id, t.split_model, t.fund_amount, x.tourist_confirm_token from transactions t "
                "join transaction_secrets x on x.transaction_id = t.id where t.open_sale_id = :s order by t.created_at desc limit 1"),
                {"s": sale_id})).one_or_none()
        if row is not None and r.status_code in (409, 500, 502, 503):
            return {"id": str(row.id), "split_model": row.split_model, "fund_amount": row.fund_amount,
                    "tourist_confirm_token": row.tourist_confirm_token}
        await asyncio.sleep(3)
    sys.exit(f"FATAL: could not pay: {r.status_code} {r.text[:300]}")

async def sql(s, query, params, take, commit=False):
    """The harness's own reads and repeatable writes, retried on a DB/network timeout only
    (logged and listed like the API's retries); anything else is raised."""
    for attempt in range(3):
        try:
            res = take(await s.execute(text(query), params))
            if commit:
                await s.commit()
            return res
        except Exception as exc:
            names = {type(e).__name__ for e in _chain(exc)}
            if attempt == 2 or not (TIMEOUT_NAMES & names):
                raise
            note_retry(f"harness DB: {' '.join(query.split())[:60]}", exc)
            await s.rollback()
            await asyncio.sleep(3)

async def crid_of(s, tid):
    return await sql(s, "select checkout_request_id from transaction_secrets where transaction_id = :t", {"t": tid}, lambda r: r.scalar_one())

async def callback(s, tid):
    """A simulated Daraja success callback to the real endpoint, at the sale's signed URL."""
    from app import links
    total = await sql(s, "select total_amount from transactions where id = :t", {"t": tid}, lambda r: r.scalar_one())
    crid = await crid_of(s, tid)
    payload = {"Body": {"stkCallback": {"CheckoutRequestID": crid, "ResultCode": 0, "CallbackMetadata": {"Item": [
        {"Name": "Amount", "Value": int(total)}, {"Name": "MpesaReceiptNumber", "Value": "SIM" + uuid.uuid4().hex[:10].upper()}]}}}}
    r = await req("POST", f"/daraja/stk-callback/{links.callback_token(tid)}", json=payload)
    await hold_off(s, tid)
    return r.status_code

async def hold_off(s, tid):
    # Nothing may ask Safaricom about these sales; nothing would answer anyway (blocked).
    await sql(s, "update stk_verifications set next_check_at = now() + interval '1 hour' where transaction_id = :t", {"t": tid},
              lambda r: None, commit=True)

async def stored(s, tid):
    r = await sql(s,
        "select split_model, product_maker_amount, product_driver_amount, fund_amount, maker_amount, driver_amount, total_amount "
        "from transactions where id = :t", {"t": tid}, lambda x: x.one())
    return f"{r.split_model} {int(r.maker_amount)}/{int(r.driver_amount)}/{int(r.fund_amount)} total {int(r.total_amount)}"

async def entries(s, tid):
    rows = await sql(s,
        "select recipient_type, amount, status from wallet_ledger_entries where transaction_id = :t and settlement_id is null "
        "order by recipient_type", {"t": tid}, lambda x: x.all())
    return ", ".join(f"{r.recipient_type} {int(r.amount)} {r.status}" for r in rows)

async def debts(s, tid):
    rows = await sql(s,
        "select creditor_type, amount, status from cash_debts where transaction_id = :t order by creditor_type", {"t": tid}, lambda x: x.all())
    return ", ".join(f"{r.creditor_type} {int(r.amount)} {r.status}" for r in rows)

async def scalar(s, query, **p):
    return await sql(s, query, p, lambda r: r.scalar_one())

async def confirm(tid, *who):
    for w in who:
        r = await req("POST", f"/transactions/{tid}/confirm", json={}, headers=auth(w))
    return r.json().get("status")

async def main():
    for who in PINS:
        await login(who)

    print("== Test 1: the split itself (whole shillings, the parts add up) ==")
    def parts(a, ph, ref, model, pct=D(30)):
        x = compute_sale_split(D(a), D(ph) if ph else None, pct, ref, model)
        return (int(x["maker_amount"]), int(x["driver_amount"]), int(x["fund_amount"]), int(x["total_amount"]))
    check("fixed 1000 with an intermediary -> 800/150/50", parts(1000, None, True, "fixed"), (800, 150, 50, 1000))
    check("fixed 700 + 10 photo -> 570/105/35 (photo to the creator, not split)", parts(700, 10, True, "fixed"), (570, 105, 35, 710))
    check("fixed 1000, no intermediary -> 950/0/50", parts(1000, None, False, "fixed"), (950, 0, 50, 1000))
    check("fixed 333 -> 268/49/16, floor for the intermediary and the fund", parts(333, None, True, "fixed"), (268, 49, 16, 333))
    bad = [a for a in range(50, 3001) for ref in (True, False)
           if (lambda m, d, f, t: m + d + f != t or m < a * 0.6)(*parts(a, None, ref, "fixed"))]
    check("fixed: for every price 50..3000 the parts add up and the creator keeps >= 60%", bad, [])
    legacy_bad = [(a, p) for a in range(50, 1001, 7) for p in (0, 15, 30, 40)
                  if parts(a, 10, True, "legacy", D(p)) != (a - (a * p // 100) + 10, a * p // 100, 0, a + 10)]
    check("legacy: exactly the old rule (floor of the creator's %, no fund) for 0/15/30/40%", legacy_bad, [])
    r = await req("GET", "/public/config")
    check("the API reports the split model (legacy by default)", r.json(), {"split_model": settings.split_model})

    async with async_session() as s:
        # A tour, so a referral can apply (MUST 17).
        r = await req("POST", "/tours", json={"group_size": 10}, headers=auth("driver"))
        if r.status_code == 409:
            r = await req("GET", "/tours/current", headers=auth("driver"))
        if r.status_code not in (200, 201) or not r.json():
            sys.exit(f"FATAL: could not start a tour: {r.status_code} {r.text[:200]}")
        join = (await req("POST", "/public/drivers/JAMES/join")).json()["join_token"]

        print("\n== Test 2: fixed checkout and M-Pesa (simulated callback) ==")
        settings.split_model = "fixed"
        check("the API now reports fixed", (await req("GET", "/public/config")).json(), {"split_model": "fixed"})
        sid = await new_sale(1000)
        qt = (await req("GET", f"/public/sales/{sid}", params={"ref": "james", "join": join})).json()
        check("fixed quote 1000: 800/150/50, intermediary shown as 15%",
              (qt["split_model"], int(qt["maker_amount"]), int(qt["driver_amount"]), int(qt["fund_amount"]),
               int(qt["product"]["fund_amount"]), int(qt["driver_split_pct"])), ("fixed", 800, 150, 50, 50, 15))
        p = await pay(sid, "mpesa", join=join)
        t1 = p["id"]
        check("pay response carries the stored split", (p["split_model"], int(p["fund_amount"])), ("fixed", 50))
        check("stored at creation: fixed 800/150/50", await stored(s, t1), "fixed 800/150/50 total 1000")
        check("the simulated callback is accepted", await callback(s, t1), 200)
        check("credited: maker 800, driver 150, fund 50", await entries(s, t1), "driver 150 available, fund 50 available, maker 800 available")
        check("the fund entry uses the one fund id", await scalar(s, "select count(*) from wallet_ledger_entries where transaction_id = :t and recipient_type = 'fund' and recipient_id = :f", t=t1, f=FUND_ID), 1)
        rc = (await req("GET", f"/public/transactions/{t1}")).json()
        check("receipt: fund 50, fixed", (int(rc["fund_amount"]), rc["split_model"]), (50, "fixed"))

        sid = await new_sale(700, photo=True)
        t2 = (await pay(sid, "mpesa", join=join))["id"]
        await callback(s, t2)
        check("fixed 700 + 10 photo: stored 570/105/35", await stored(s, t2), "fixed 570/105/35 total 710")
        check("...credited 570/105/35", await entries(s, t2), "driver 105 available, fund 35 available, maker 570 available")

        sid = await new_sale(1000)
        t3 = (await pay(sid, "mpesa", ref=False))["id"]
        await callback(s, t3)
        check("fixed 1000, no intermediary: 950/0/50, no driver entry", await entries(s, t3), "fund 50 available, maker 950 available")

        sid = await new_sale(333)
        t4 = (await pay(sid, "mpesa", join=join))["id"]
        await callback(s, t4)
        check("fixed 333: 268/49/16, sums to 333", (await stored(s, t4), await entries(s, t4)),
              ("fixed 268/49/16 total 333", "driver 49 available, fund 16 available, maker 268 available"))

        print("\n== Test 3: stored, never recomputed (made in fixed, credited in legacy) ==")
        # Late credit: an M-Pesa sale with no callback goes unresolved, the mode flips, then Safaricom says paid.
        sid = await new_sale(1000)
        tl = (await pay(sid, "mpesa", join=join))["id"]
        settings.split_model = "legacy"
        await sql(s, "update transactions set created_at = now() - interval '11 minutes' where id = :t", {"t": tl}, lambda r: None, commit=True)
        await verification.mark_unresolved()
        check("unresolved after 10 minutes, nobody credited", await entries(s, tl), "")
        state = await verification.check_payment(s, tl, query=paid)
        check("late credit in legacy mode -> 'paid_late' with the stored fixed split 800/150/50",
              (state, await entries(s, tl)), ("paid_late", "driver 150 available, fund 50 available, maker 800 available"))
        # Callback after the flip.
        settings.split_model = "fixed"
        sid = await new_sale(1000)
        tc = (await pay(sid, "mpesa", ref=False))["id"]
        settings.split_model = "legacy"
        await callback(s, tc)
        check("callback after switching to legacy: still 950/0/50", await entries(s, tc), "fund 50 available, maker 950 available")

        print("\n== Test 4: cash, fixed: debts to the intermediary and the fund ==")
        # The creator spends her M-Pesa balance first, so these debts can't settle yet:
        # freeze it with a dispute on each credited sale, and clear them later.
        credited = [t1, t2, t3, t4, tl, tc]
        for tid in credited:
            r = await req("POST", f"/admin/transactions/{tid}/dispute", headers=auth("coord"))
        check("the creator's M-Pesa balance is frozen for now (payable 0)", await payable_balance(s, "maker", PRODUCER), D(0))
        settings.split_model = "fixed"
        sid = await new_sale(1000)
        ca = (await pay(sid, "cash", join=join))["id"]
        settings.split_model = "legacy"  # confirmed after the flip: still the stored split
        check("Case A confirmed by both (after switching to legacy)", await confirm(ca, "driver", "maker"), "cash_confirmed")
        check("...stored fixed 800/150/50", await stored(s, ca), "fixed 800/150/50 total 1000")
        check("...creator's 800 held in cash, never payable", await entries(s, ca), "maker 800 cash_held")
        check("...two debts: intermediary 150, fund 50, both outstanding", await debts(s, ca), "driver 150 outstanding, fund 50 outstanding")
        settings.split_model = "fixed"
        sid = await new_sale(400)
        cb = await pay(sid, "cash", ref=False)
        await req("POST", f"/transactions/{cb['id']}/confirm", json={"tourist_token": cb["tourist_confirm_token"]})
        check("Case B (no intermediary) 400: tourist + creator confirm", await confirm(cb["id"], "maker"), "cash_confirmed")
        check("...one debt, to the fund: 20", await debts(s, cb["id"]), "fund 20 outstanding")
        me = (await req("GET", "/accounts/me", headers=auth("maker"))).json()
        check("the creator's payable stays 0 while she owes 220", D(str(me["payable"])), D(0))
        sidd = await new_sale(600)
        cd = (await pay(sidd, "cash", join=join))["id"]
        await confirm(cd, "driver", "maker")
        check("a third cash sale 600: debts 90 + 30", await debts(s, cd), "driver 90 outstanding, fund 30 outstanding")
        r = await req("POST", f"/admin/transactions/{cd}/dispute", headers=auth("coord"))
        check("...then disputed", r.json().get("status"), "disputed")

        print("\n== Test 5: settlement from M-Pesa earnings; a disputed sale's fund debt waits ==")
        # In legacy mode: the rollback path (flip SPLIT_MODEL back, keep this code) must still
        # settle the fund debts made in fixed mode, and keep the fund out of payouts (Test 7).
        settings.split_model = "legacy"
        for tid in credited:
            await req("POST", f"/admin/transactions/{tid}/resolve", headers=auth("coord"))
        sid = await new_sale(100)
        tt = (await pay(sid, "mpesa", ref=False))["id"]
        await callback(s, tt)  # any credit settles what the creator can cover
        check("Case A debts settled: intermediary 150, fund 50", await debts(s, ca), "driver 150 settled, fund 50 settled")
        check("Case B fund debt settled: 20", await debts(s, cb["id"]), "fund 20 settled")
        check("the disputed sale's debts wait, the fund's included", await debts(s, cd), "driver 90 outstanding, fund 30 outstanding")
        made = await scalar(s,
            "select string_agg(recipient_type || ' ' || amount::int, ', ' order by recipient_type, amount) from wallet_ledger_entries "
            "where settlement_id in (select id from cash_debts where transaction_id in (:a, :b)) and recipient_type <> 'maker'",
            a=ca, b=cb["id"])
        check("settlement in legacy mode credited the intermediary and the fund (M-Pesa money moved from the creator)", made, "driver 150, fund 20, fund 50")
        check("...and the legacy credit that settled them has no fund share", await stored(s, tt), "legacy 100/0/0 total 100")
        await req("POST", f"/admin/transactions/{cd}/resolve", headers=auth("coord"))
        sid = await new_sale(100)
        tu = (await pay(sid, "mpesa", ref=False))["id"]
        await callback(s, tu)
        check("once cleared, its debts settle too", await debts(s, cd), "driver 90 settled, fund 30 settled")

        print("\n== Test 6: legacy mode is exactly today's behaviour ==")
        settings.split_model = "legacy"
        pct = int(await scalar(s, "select default_split_driver_pct from producers where id = :p", p=PRODUCER))
        sid = await new_sale(500)
        qt = (await req("GET", f"/public/sales/{sid}", params={"ref": "james", "join": join})).json()
        exp_d = 500 * pct // 100
        check(f"legacy quote: the creator's {pct}%, no fund line",
              (qt["split_model"], int(qt["maker_amount"]), int(qt["driver_amount"]), int(qt["fund_amount"]), int(qt["driver_split_pct"])),
              ("legacy", 500 - exp_d, exp_d, 0, pct))
        t = (await pay(sid, "cash", join=join))["id"]
        check("legacy cash Case A: stored legacy, no fund", await stored(s, t), f"legacy {500 - exp_d}/{exp_d}/0 total 500")
        check("...confirmed by both", await confirm(t, "driver", "maker"), "cash_confirmed")
        check("...one debt only, to the intermediary, settled at once from her M-Pesa balance (as before)", await debts(s, t), f"driver {exp_d} settled")
        check("...the creator's share held in cash", await entries(s, t), f"maker {500 - exp_d} cash_held")

        print("\n== Test 7: the fund is never paid out ==")
        avail = await scalar(s, "select coalesce(sum(amount), 0) from wallet_ledger_entries where recipient_type = 'maker' and recipient_id = :p and status = 'available'", p=PRODUCER)
        owed = await scalar(s, "select coalesce(sum(d.amount), 0) from cash_debts d join transactions t on t.id = d.transaction_id where d.producer_id = :p and d.status = 'outstanding' and t.status <> 'disputed'", p=PRODUCER)
        me = (await req("GET", "/accounts/me", headers=auth("maker"))).json()
        check("creator's payable = her own available - her debts (the fund's money isn't in it)", D(str(me["payable"])), max(avail - owed, D(0)))
        fund_total = await scalar(s, "select coalesce(sum(amount), 0) from wallet_ledger_entries where recipient_type = 'fund' and status in ('pending','available','frozen')")
        check("the fund holds 50+35+50+16+50+50 (M-Pesa) + 50+20+30 (cash, settled in legacy mode) = 351", int(fund_total), 351)
        cands = {(c.recipient_type, str(c.recipient_id)) for c in await payouts.sweep_candidates(s)}
        check("the sweep never picks the fund", any(t == "fund" for t, _ in cands), False)
        try:
            await payouts.start_payout(s, "fund", FUND_ID, minimum=D(1))
            refused = "not refused"
        except payouts.PayoutRefused as exc:
            refused = str(exc)
        await s.rollback()
        check("a payout to the fund is refused before anything is sent", refused, "Only a creator or a site intermediary can be paid out.")
        try:
            await payouts._check_mpesa_cover(s, "fund", FUND_ID, D(1))
            capped = "passed"
        except payouts.PayoutCapExceeded:
            capped = "refused"
        check("...and the payout cap refuses it too", capped, "refused")
        # The cap keeps the fund's money out: a payout that fits within what M-Pesa collected,
        # but only by spending the fund's share, is refused before Daraja.
        collected = await scalar(s, "select coalesce(sum(total_amount), 0) from transactions where payment_method = 'mpesa' and status in ('confirmed','disputed')")
        committed = await scalar(s, "select coalesce(sum(amount), 0) from withdrawal_requests where status in ('requested','processing','paid')")
        own = await scalar(s, "select coalesce(sum(amount), 0) from wallet_ledger_entries where recipient_type = 'maker' and recipient_id = :p and status = 'available'", p=PRODUCER)
        filler = collected - fund_total - committed - own + 1   # leaves room for `own` only by using the fund's money
        await s.execute(text("insert into withdrawal_requests (recipient_type, recipient_id, amount, status) values ('driver', :d, :a, 'processing')"),
                        {"d": DRIVER, "a": filler})
        await s.commit()
        try:
            await payouts._check_mpesa_cover(s, "maker", PRODUCER, own)
            capped = "passed"
        except payouts.PayoutCapExceeded as exc:
            capped = "refused" if "Conservation fund" in str(exc) else f"refused for another reason: {exc}"
        check(f"payout cap: KSh {int(own)} fits in collected {int(collected)} but not in collected - fund {int(fund_total)}: refused", capped, "refused")
        await s.execute(text("delete from withdrawal_requests where recipient_id = :d and status = 'processing' and amount = :a and b2c_receipt is null"),
                        {"d": DRIVER, "a": filler})
        await s.commit()
        try:
            await payouts._check_mpesa_cover(s, "maker", PRODUCER, own)
            capped = "passed"
        except payouts.PayoutCapExceeded as exc:
            capped = f"refused: {exc}"
        check("...and without the in-flight payout it fits (the check only, nothing sent)", capped, "passed")
        await s.rollback()

        print("\n== Test 8: reconciliation ==")
        rec = (await req("GET", "/admin/reconciliation", headers=auth("coord"))).json()["totals"]
        c, cr, im, fd = (D(str(rec[k])) for k in ("collected", "creators", "intermediaries", "fund"))
        check("collected = creators + intermediaries + fund", c, cr + im + fd)
        check("fund line = the fund's ledger total (351)", int(fd), 351)
        check("balanced", rec["balanced"], True)
        check("no fund debt left outstanding", D(str(rec["fund_debts_outstanding"])), D(0))

    check("nothing tried to reach Daraja (no B2C, no STK Push Query, no token)", DARAJA_ATTEMPTS, [])
    await client.aclose()
    print(f"\n== Retried requests: {len(RETRIES)} ==")
    for line in RETRIES:
        print("  " + line)
    print(f"\n== Summary: {passed} passed, {failed} failed ==")
    sys.exit(1 if failed else 0)

asyncio.run(main())
PY
