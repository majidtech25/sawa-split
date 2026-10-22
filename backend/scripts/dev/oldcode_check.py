"""Old code (main) against the migrated TEST database (migration 0020), with fixed-split rows in it.

Phase "setup" runs with the BRANCH code on sys.path: creates a fixed M-Pesa sale (fund ledger entry),
freezes it with a dispute, then a fixed cash Case A sale whose two debts stay outstanding (a fund debt
has driver_id null). Phase "check" runs with MAIN's code on sys.path and exercises its reads: the
reconciliation endpoint, /accounts/me for maker and driver, the receipt, the maker's current sale, and
the browser's RLS reads through Supabase. Phase "probe" calls main's settle_debts and sweep candidate
selection in a transaction that is rolled back, to report (not hide) what old write paths would do.
Every Daraja function is blocked in-process; nothing is sent. TEST project only.

Usage (the TEST .env exported; SB_URL / SB_KEY from frontend/.env; OLDCODE_STATE a scratch file):
  setup:        cd backend && PYTHONPATH=. .venv/bin/python scripts/dev/oldcode_check.py setup
  check, probe: cd <a worktree of main>/backend && PYTHONPATH=. <repo>/backend/.venv/bin/python \\
                  <repo>/backend/scripts/dev/oldcode_check.py check   (then: probe)
Clean up afterwards like verify_split_model.sh does (this run's sales, ledger rows, debts, tour).
"""
import asyncio, json, os, sys, uuid

if "jmbktbcnwyshwobbkohl" not in os.environ.get("SUPABASE_URL", ""):
    sys.exit("FATAL: not the TEST project.")

import httpx
from sqlalchemy import text

from app import daraja
from app.db import async_session
from app.main import app

PHASE = sys.argv[1]
STATE = os.environ["OLDCODE_STATE"]
PINS = {"maker": ("+254708374149", "1111"), "driver": ("+254799999003", "2222"), "coord": ("+254799999001", "9999")}
ATTEMPTS = []


def blocked(name):
    async def _refuse(*a, **k):
        ATTEMPTS.append(name)
        raise RuntimeError(f"{name} blocked")
    return _refuse


async def fake_stk_push(**kw):
    return {"ResponseCode": "0", "CheckoutRequestID": f"SIM-{uuid.uuid4()}"}


daraja.stk_push = fake_stk_push
for n in ("b2c_payment", "stk_query", "get_access_token"):
    setattr(daraja, n, blocked(n))

client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=120)
TOK = {}
passed = failed = 0


def check(desc, actual, expected):
    global passed, failed
    ok = actual == expected
    passed += ok
    failed += not ok
    print(("PASS  " if ok else "FAIL  ") + desc + ("" if ok else f" (expected {expected!r}, got {actual!r})"))


async def login(who):
    phone, pin = PINS[who]
    for _ in range(3):
        r = await client.post("/auth/login", json={"phone": phone, "pin": pin})
        if r.status_code == 200:
            TOK[who] = r.json()
            return
        await asyncio.sleep(2)
    sys.exit(f"FATAL login {who}: {r.status_code} {r.text[:200]}")


def auth(who):
    return {"Authorization": f"Bearer {TOK[who]['access_token']}"}


async def setup():
    from app import links
    from app.config import settings
    settings.split_model = "fixed"
    for w in PINS:
        await login(w)
    tour = await client.post("/tours", json={"group_size": 5}, headers=auth("driver"))
    assert tour.status_code == 201, tour.text
    join = (await client.post("/public/drivers/JAMES/join")).json()["join_token"]
    # 1. A fixed M-Pesa sale, credited by a simulated callback: a 'fund' ledger entry.
    sid = (await client.post("/sales", json={"amount": 1000, "description": "oldcode check"}, headers=auth("maker"))).json()["id"]
    p = await client.post(f"/public/sales/{sid}/pay", json={"payment_method": "mpesa", "phone": "254700000001", "referral_code": "JAMES", "join_token": join})
    assert p.status_code == 201, p.text
    t1 = p.json()["id"]
    async with async_session() as s:
        crid = (await s.execute(text("select checkout_request_id from transaction_secrets where transaction_id = :t"), {"t": t1})).scalar_one()
    cb = {"Body": {"stkCallback": {"CheckoutRequestID": crid, "ResultCode": 0, "CallbackMetadata": {"Item": [
        {"Name": "Amount", "Value": 1000}, {"Name": "MpesaReceiptNumber", "Value": "SIMOLD" + uuid.uuid4().hex[:6].upper()}]}}}}
    r = await client.post(f"/daraja/stk-callback/{links.callback_token(t1)}", json=cb)
    assert r.status_code == 200, r.text
    # 2. Freeze it, so the cash sale's debts stay outstanding.
    r = await client.post(f"/admin/transactions/{t1}/dispute", headers=auth("coord"))
    assert r.status_code == 200, r.text
    # 3. A fixed cash Case A sale, confirmed: debts to the intermediary and to the fund (driver_id null).
    sid = (await client.post("/sales", json={"amount": 600, "description": "oldcode check"}, headers=auth("maker"))).json()["id"]
    c = await client.post(f"/public/sales/{sid}/pay", json={"payment_method": "cash", "referral_code": "JAMES", "join_token": join})
    assert c.status_code == 201, c.text
    t2 = c.json()["id"]
    await client.post(f"/transactions/{t2}/confirm", json={}, headers=auth("driver"))
    st = (await client.post(f"/transactions/{t2}/confirm", json={}, headers=auth("maker"))).json()["status"]
    async with async_session() as s:
        await s.execute(text("update stk_verifications set next_check_at = now() + interval '1 hour' where transaction_id = :t"), {"t": t1})
        await s.commit()
        rows = (await s.execute(text("select creditor_type, driver_id is null as no_driver, amount, status from cash_debts where transaction_id = :t order by 1"), {"t": t2})).all()
        fund = (await s.execute(text("select count(*) from wallet_ledger_entries where recipient_type = 'fund'"))).scalar_one()
    print("setup:", st, [tuple(r) for r in rows], "fund entries:", fund)
    json.dump({"t1": t1, "t2": t2}, open(STATE, "w"))


async def check_old():
    st = json.load(open(STATE))
    for w in PINS:
        await login(w)
    r = await client.get("/admin/reconciliation", headers=auth("coord"))
    check("main: GET /admin/reconciliation answers 200 with fund rows and a null-driver debt present", r.status_code, 200)
    tot = r.json().get("totals", {}) if r.status_code == 200 else {}
    check("main: reconciliation still balanced (fund entries count in 'still owed')", tot.get("balanced"), True)
    debts = r.json().get("debts", []) if r.status_code == 200 else []
    check("main: debt list loads (main's inner join to drivers omits the fund debt, it doesn't crash)", isinstance(debts, list), True)
    for who in ("maker", "driver"):
        m = await client.get("/accounts/me", headers=auth(who))
        check(f"main: GET /accounts/me ({who}) answers 200", m.status_code, 200)
    for t in (st["t1"], st["t2"]):
        rc = await client.get(f"/public/transactions/{t}")
        check(f"main: receipt of a fixed-split sale answers 200 ({t[:8]})", rc.status_code, 200)
    cur = await client.get("/sales/current", headers=auth("maker"))
    check("main: the maker's current-sale endpoint answers", cur.status_code in (200,), True)
    tx = await client.get("/transactions", headers=auth("maker")) if any(rt.path == "/transactions" for rt in app.routes if hasattr(rt, "path")) else None
    if tx is not None:
        check("main: GET /transactions (maker) answers 200", tx.status_code, 200)
    # The browser's reads (RLS), with the publishable key, as each role.
    sb_url, sb_key = os.environ["SB_URL"], os.environ["SB_KEY"]
    async with httpx.AsyncClient(timeout=60) as sb:
        def h(w):
            return {"apikey": sb_key, "Authorization": f"Bearer {TOK[w]['access_token']}"}
        for table in ("wallet_ledger_entries", "cash_debts", "transactions"):
            for w in ("maker", "driver", "coord"):
                rr = await sb.get(f"{sb_url}/rest/v1/{table}?select=*", headers=h(w))
                check(f"RLS read {table} as {w}: 200", rr.status_code, 200)
        fund_seen = {}
        for w in ("maker", "driver", "coord"):
            rr = await sb.get(f"{sb_url}/rest/v1/wallet_ledger_entries?select=id&recipient_type=eq.fund", headers=h(w))
            fund_seen[w] = len(rr.json()) > 0
        check("RLS: fund ledger rows visible to the coordinator only", fund_seen, {"maker": False, "driver": False, "coord": True})
        rr = await sb.get(f"{sb_url}/rest/v1/cash_debts?select=creditor_type&transaction_id=eq.{st['t2']}", headers=h("driver"))
        check("RLS: the driver sees his own debt, not the fund's", sorted(x["creditor_type"] for x in rr.json()), ["driver"])
        rr = await sb.get(f"{sb_url}/rest/v1/cash_debts?select=creditor_type&transaction_id=eq.{st['t2']}", headers=h("maker"))
        check("RLS: the maker sees both debts she owes", sorted(x["creditor_type"] for x in rr.json()), ["driver", "fund"])
    check("nothing tried to reach Daraja", ATTEMPTS, [])


async def probe_old():
    """What main's write paths would do with these rows. Rolled back; reported, not asserted."""
    from app import ledger, payouts
    st = json.load(open(STATE))
    async with async_session() as s:
        await s.execute(text("update transactions set status = 'confirmed' where id = :t"), {"t": st["t1"]})
        await s.execute(text("update wallet_ledger_entries set status = 'available' where transaction_id = :t and status = 'frozen'"), {"t": st["t1"]})
        maker = (await s.execute(text("select producer_id from transactions where id = :t"), {"t": st["t2"]})).scalar_one()
        try:
            n = await ledger.settle_debts(s, maker)
            print(f"PROBE main settle_debts with a fund debt present: settled {n}")
            rows = (await s.execute(text("select recipient_type, recipient_id is null, amount from wallet_ledger_entries where settlement_id in (select id from cash_debts where transaction_id = :t)"), {"t": st["t2"]})).all()
            print("PROBE   entries it wrote:", [tuple(r) for r in rows])
        except Exception as exc:
            print(f"PROBE main settle_debts with a fund debt present: ERROR {type(exc).__name__}: {str(exc).splitlines()[0][:160]}")
        await s.rollback()
    async with async_session() as s:
        try:
            rows = (await s.execute(text(
                "select recipient_type, recipient_id, sum(amount) as balance from wallet_ledger_entries "
                "where status = 'available' group by recipient_type, recipient_id having sum(amount) >= 1"))).all()
            print("PROBE main's sweep query (threshold lowered to 1) would pick:", sorted({r.recipient_type for r in rows}))
        finally:
            await s.rollback()


async def main():
    if PHASE == "setup":
        await setup()
    elif PHASE == "check":
        await check_old()
        print(f"== Summary: {passed} passed, {failed} failed ==")
    elif PHASE == "probe":
        await probe_old()
    await client.aclose()
    sys.exit(1 if failed else 0)


asyncio.run(main())
