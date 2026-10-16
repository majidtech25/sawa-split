#!/usr/bin/env bash
# Verifies payments with no final result (migration 0019, app/verification.py) on the TEST
# project, with simulated callbacks and simulated Safaricom answers only: no STK Push, no
# STK Push Query to Daraja, no B2C.
#   - "still processing" (4999) is never "not paid", in flag and enforce mode;
#   - a held open sale whose payment has no final result is released after 10 minutes
#     (not before), and the payment is flagged 'unresolved' and asked about again;
#   - a later "paid" credits it as normal (split, ledger, sale paid): 'paid_late';
#   - a later "not paid" closes it as failed: 'failed_late';
#   - a late callback still credits it and pays the released sale;
#   - Reconciliation lists unresolved and paid-late payments under Payment checks.
# The functions are called directly, so no API server is needed, and none may run: its
# scheduler would act on the same rows. Rows are found by their open sales' description.
# Usage (from backend/): (set -a; source .env; set +a; bash scripts/verify_unresolved.sh)
set -uo pipefail

MARK="verify_unresolved"
if curl -s -m 3 -o /dev/null http://127.0.0.1:8000/; then
  echo "FATAL: a local API is running on :8000. Stop it first: its scheduler would act on this test's rows."; exit 1
fi
q() { psql "$DATABASE_URL" -tAc "$1"; }
PRODUCER_ID=$(q "select id from producers where phone = '+254708374149';")
DRIVER_ID=$(q "select id from drivers where phone = '+254799999003';")
[ -n "$PRODUCER_ID" ] && [ -n "$DRIVER_ID" ] || { echo "FATAL: test fixtures not found."; exit 1; }
BUSY=$(q "select (select count(*) from open_sales where producer_id = '$PRODUCER_ID' and status in ('open','paying'))
  + (select count(*) from wallet_ledger_entries where recipient_id in ('$PRODUCER_ID','$DRIVER_ID') and status in ('pending','available','frozen'))
  + (select count(*) from cash_debts where status = 'outstanding');")
[ "$BUSY" = "0" ] || { echo "FATAL: the fixtures already hold an open sale, a balance or a debt."; exit 1; }

cleanup() {
  echo
  echo "== Cleanup: this run's sales, payments and ledger rows =="
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
    begin;
    delete from wallet_ledger_entries where transaction_id in
      (select t.id from transactions t join open_sales s on s.id = t.open_sale_id where s.description = '$MARK');
    delete from transactions where open_sale_id in (select id from open_sales where description = '$MARK');
    delete from open_sales where description = '$MARK';
    commit;" && echo "cleanup ok" || { echo "cleanup FAILED: rows marked '$MARK' may be left"; exit 1; }
}
trap cleanup EXIT

PRODUCER_ID="$PRODUCER_ID" DRIVER_ID="$DRIVER_ID" MARK="$MARK" PYTHONPATH=. .venv/bin/python - <<'PY'
import asyncio, os, sys, uuid
from decimal import Decimal
from sqlalchemy import text
from app import links, sales, verification
from app.db import async_session
from app.routers import admin

PRODUCER, DRIVER, MARK = os.environ["PRODUCER_ID"], os.environ["DRIVER_ID"], os.environ["MARK"]
passed = failed = 0

def check(desc, actual, expected):
    global passed, failed
    if actual == expected:
        print(f"PASS  {desc}"); passed += 1
    else:
        print(f"FAIL  {desc} (expected {expected!r}, got {actual!r})"); failed += 1

# Simulated Safaricom answers (STK Push Query): nothing here reaches Daraja.
async def processing(_):  return {"ResponseCode": "0", "ResultCode": "4999", "ResultDesc": "The transaction is still under processing"}
async def paid(_):        return {"ResponseCode": "0", "ResultCode": "0", "ResultDesc": "The service request is processed successfully."}
async def cancelled(_):   return {"ResponseCode": "0", "ResultCode": "1032", "ResultDesc": "Request cancelled by user"}

async def new_sale(s, amount=200, expires_in=-1):
    """An open sale held by an M-Pesa payment that's 'initiated' (STK Push sent, no callback
    yet). A maker has one open or held sale at a time, so by default the sale's 30 minutes
    are already over: released, it becomes 'expired' and the next one can start."""
    sale = (await s.execute(text(
        "insert into open_sales (producer_id, amount, description, status, expires_at) "
        "values (:p, :a, :m, 'paying', now() + make_interval(mins => :e)) returning id"),
        {"p": PRODUCER, "a": amount, "m": MARK, "e": expires_in})).scalar_one()
    pct = (await s.execute(text("select default_split_driver_pct from producers where id = :p"), {"p": PRODUCER})).scalar_one()
    split = sales.compute_sale_split(Decimal(amount), None, Decimal(pct), True)
    tid = (await s.execute(text(
        "insert into transactions (producer_id, driver_id, payment_method, product_enabled, product_amount, "
        "product_maker_amount, product_driver_amount, photo_enabled, total_amount, maker_amount, driver_amount, status, open_sale_id) "
        "values (:p, :d, 'mpesa', true, :a, :pm, :pd, false, :t, :m, :dd, 'initiated', :s) returning id"),
        {"p": PRODUCER, "d": DRIVER, "a": amount, "pm": split["product_maker_amount"], "pd": split["product_driver_amount"],
         "t": split["total_amount"], "m": split["maker_amount"], "dd": split["driver_amount"], "s": sale})).scalar_one()
    crid = f"SIM-{uuid.uuid4()}"
    await s.execute(text("insert into transaction_secrets (transaction_id, checkout_request_id) values (:t, :c)"), {"t": tid, "c": crid})
    await s.commit()
    return sale, tid, crid

def callback(crid, amount, ok=True):
    return {"Body": {"stkCallback": {"CheckoutRequestID": crid, "ResultCode": 0 if ok else 1032,
            "CallbackMetadata": {"Item": [{"Name": "Amount", "Value": amount}, {"Name": "MpesaReceiptNumber", "Value": "SIM" + crid[4:14]}]}}}}

async def age(s, tid, minutes):
    await s.execute(text("update transactions set created_at = now() - make_interval(mins => :m) where id = :t"), {"m": minutes, "t": tid})
    await s.commit()

async def look(s, tid):
    r = (await s.execute(text(
        "select t.status as txn, coalesce(v.state, '-') as check, o.status as sale, "
        "(select count(*) from wallet_ledger_entries e where e.transaction_id = t.id) as entries "
        "from transactions t left join stk_verifications v on v.transaction_id = t.id "
        "left join open_sales o on o.id = t.open_sale_id where t.id = :t"), {"t": tid})).one()
    return f"{r.txn} {r.check} {r.sale} {r.entries}"

async def hold_off(s, tid):
    # Nothing else may check these rows: this script asks Safaricom (simulated) itself.
    await s.execute(text("update stk_verifications set next_check_at = now() + interval '1 hour' where transaction_id = :t"), {"t": tid})
    await s.commit()

async def main():
    print("== Test 1: \"still processing\" is never \"not paid\" ==")
    check("4999 reads as unknown", verification.classify(await processing(None))[0], "unknown")
    check("any 'still processing' wording reads as unknown",
          verification.classify({"ResultCode": "1", "ResultDesc": "Transaction is being processed"})[0], "unknown")
    check("1032 (cancelled) and 1037 (no response) are still 'not paid'",
          (verification.classify(await cancelled(None))[0], verification.classify({"ResultCode": "1037", "ResultDesc": "No response from user."})[0]),
          ("not_paid", "not_paid"))
    async with async_session() as s:
        # flag mode: the callback credits at once; a 4999 query must not flag it as "not paid".
        _, t1, c1 = await new_sale(s)
        code, _ = await verification.handle_stk_callback(s, links.callback_token(t1), callback(c1, 200), mode="flag")
        await hold_off(s, t1)
        check("flag: the callback credits it", f"{code} {await look(s, t1)}", "200 confirmed pending paid 2")
        check("flag: Safaricom says 4999 -> still pending, asked again, not a mismatch",
              await verification.check_payment(s, t1, query=processing), "pending")
        # enforce mode: verifying stays verifying on 4999, and nobody is credited.
        _, t2, c2 = await new_sale(s)
        await verification.handle_stk_callback(s, links.callback_token(t2), callback(c2, 200), mode="enforce")
        await hold_off(s, t2)
        check("enforce: Safaricom says 4999 -> still pending, not failed",
              f"{await verification.check_payment(s, t2, query=processing)} {await look(s, t2)}", "pending verifying pending paying 0")

        print("\n== Test 2: a held sale with no final result is released after 10 minutes ==")
        # enforce: a verifying sale Safaricom never confirms is released too (its 30 minutes are over: expired).
        await age(s, t2, 11)
        await verification.mark_unresolved()
        await hold_off(s, t2)
        check("enforce: verifying for 11 minutes -> unresolved, sale released, nobody credited", await look(s, t2), "verifying unresolved expired 0")
        sa, ta, ca = await new_sale(s, expires_in=30)
        await age(s, ta, 9)
        await verification.mark_unresolved()
        check("at 9 minutes nothing changes: still held, no check", await look(s, ta), "initiated - paying 0")
        await age(s, ta, 11)
        await verification.mark_unresolved()
        await hold_off(s, ta)
        check("at 11 minutes: payment 'unresolved', sale released (open again), nobody credited", await look(s, ta), "initiated unresolved open 0")
        check("Safaricom says 4999 -> stays unresolved, nobody credited",
              f"{await verification.check_payment(s, ta, query=processing)} {await look(s, ta)}", "unresolved initiated unresolved open 0")
        nxt = (await s.execute(text("select round(extract(epoch from next_check_at - now()) / 60) from stk_verifications where transaction_id = :t"), {"t": ta})).scalar_one()
        check("...and is asked again in 15 minutes", int(nxt), 15)
        await hold_off(s, ta)

        recon = await admin.reconciliation({}, s)
        mine = {c.transaction_id: c for c in recon.payment_checks}
        check("Reconciliation lists the unresolved payment under Payment checks", mine.get(str(ta)) and mine[str(ta)].state, "unresolved")

        print("\n== Test 3: a later \"paid\" is credited as normal ==")
        check("Safaricom says paid -> 'paid_late': confirmed, split written (maker + guide), sale paid",
              f"{await verification.check_payment(s, ta, query=paid)} {await look(s, ta)}", "paid_late confirmed paid_late paid 2")
        split = (await s.execute(text(
            "select string_agg(recipient_type || ' ' || amount::text || ' ' || status, ', ' order by recipient_type) "
            "from wallet_ledger_entries where transaction_id = :t"), {"t": ta})).scalar_one()
        check("...with the normal split: driver 60, maker 140, available as for any callback", split, "driver 60 available, maker 140 available")
        check("enforce: a verifying one paid late is credited from verifying",
              f"{await verification.check_payment(s, t2, query=paid)} {await look(s, t2)}", "paid_late confirmed paid_late paid 2")
        check("asking again changes nothing (no double credit)",
              f"{await verification.check_payment(s, ta, query=paid, force=True)} {await look(s, ta)}", "paid_late confirmed paid_late paid 2")
        recon = await admin.reconciliation({}, s)
        mine = {c.transaction_id: c for c in recon.payment_checks}
        check("Reconciliation shows it as paid late", mine.get(str(ta)) and mine[str(ta)].state, "paid_late")

        print("\n== Test 4: a later \"not paid\" closes it as failed ==")
        sb, tb, cb = await new_sale(s)
        await age(s, tb, 11)
        await verification.mark_unresolved()
        await hold_off(s, tb)
        check("Safaricom says cancelled -> 'failed_late': failed, nobody credited, the released sale stays released",
              f"{await verification.check_payment(s, tb, query=cancelled)} {await look(s, tb)}", "failed_late failed failed_late expired 0")
        recon = await admin.reconciliation({}, s)
        check("...and it leaves Payment checks", str(tb) in {c.transaction_id for c in recon.payment_checks}, False)

        print("\n== Test 5: a late callback still settles an unresolved payment ==")
        sc, tc, cc = await new_sale(s)
        await age(s, tc, 11)
        await verification.mark_unresolved()
        await hold_off(s, tc)
        code, _ = await verification.handle_stk_callback(s, links.callback_token(tc), callback(cc, 200), mode="flag")
        check("flag: a late successful callback credits it and pays the released sale", f"{code} {(await look(s, tc)).split()[0]} {(await look(s, tc)).split()[2:]}",
              "200 confirmed ['paid', '2']")
        sd, td, cd = await new_sale(s)
        await age(s, td, 11)
        await verification.mark_unresolved()
        await hold_off(s, td)
        await verification.handle_stk_callback(s, links.callback_token(td), callback(cd, 200, ok=False), mode="flag")
        check("a late failed callback: failed; the next check records it without asking Safaricom",
              f"{await verification.check_payment(s, td, query=paid)} {await look(s, td)}", "failed_late failed failed_late expired 0")

    print(f"\n== Summary: {passed} passed, {failed} failed ==")
    sys.exit(1 if failed else 0)

asyncio.run(main())
PY
