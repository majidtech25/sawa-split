# Sawa Split v2 — Scope Lock
Principle: transparent split-settlement engine. Tourist scans a stall QR, sees where
every shilling goes, pays; engine splits and credits instantly. Payouts batched
(KES 500 / 18:00). Split engine stays maker + ONE referrer.

MUST:
1. Tag current commit v1-demo and push the tag. Coordinator price cards and the
   signed demo card keep working unchanged.
2. Referral codes: every driver/referrer gets a short unique code (case-insensitive)
   + personal QR on their dashboard, with "Show full screen". Demo: JAMES, HASSAN.
   Existing QR-DRIVER-001 keeps working.
3. Tour pass: the referrer page (/#/driver/<code>) offers "Use <first name> as my guide
   today"; the code is saved on the tourist's phone until midnight EAT (localStorage,
   tolerate unavailability).
4. New sale (maker dashboard): agreed amount (whole KSh > 0), optional description,
   photo-consent toggle (maker's existing photo fee; hidden if none). Server-stored
   open sale: single use, 30-min expiry, cancellable, one open sale per maker.
5. Stall QR stand: one static QR per maker (/#/stall/<maker code>), printable from the
   dashboard. Page polls a public API endpoint and shows the current open sale or
   "Waiting for the seller to enter the amount". No browser table access.
6. Checkout: referral code pre-filled from the tour pass, editable/removable; a valid
   ACTIVE code shows the referrer's first name. Breakdown computed SERVER-SIDE: the
   maker's coordinator-set % (max 40% to referrer); no code = maker 100%; photo fee a
   separate line to the maker; whole shillings with documented rounding that always
   adds up. Then the existing M-Pesa STK flow or cash flow.
7. Paid / expired / cancelled sales can't be paid and say so clearly.
8. Groups: separate sales per tourist (each with referral), or one tourist pays a total
   the maker typed. No other group logic.
9. Reconciliation: sales count and commission per referrer.
10. Tests + docs: verify tests on the TEST project; CLAUDE.md and DEMO_SCRIPT.md updated.
11. Login: PIN field autocomplete off (no autofill of another account's PIN); log every
    login outcome without secrets; Supabase sign-in failure -> 503 'Couldn't sign you in
    right now, try again in a moment'; one retry on 429/5xx; verify test: a
    coordinator-registered account can log in with its PIN.

STRETCH (only after MUST passes live, ask me first): per-person "ticket" sale: price
per person, many payments, "N paid", maker closes, auto-close after 2 h.

OUT OF SCOPE (don't build): paying each group member individually; multiple referrers
per payment; instant per-party B2C; commission caps or tiers; driver photo; signed B2C
result URL; self-registration; partial withdrawals; offline mode.

UNCHANGED: the coordinator registers everyone; referral % fixed by the coordinator;
cash = two confirmations, maker's share recorded as cash held, referrer's share a debt
settled from maker M-Pesa earnings at 18:00; payouts batched, never above M-Pesa
collected, one auto retry, pause on 8006; no platform fee.

PROCESS: send me a plan of at most 10 lines FIRST and wait for my OK. Additive
migrations only. Ask before any npm install. No STK or B2C in tests. Push code before
any demo DB change. Commit without attribution. When done: push, wait for Render Live,
test on the LIVE site with Amina + Hassan using CASH only (tour pass -> new sale ->
stand QR -> code pre-filled -> cash confirm -> balances + reconciliation; no-code sale
-> maker 100%; expired/cancelled/paid refuse), clean the demo test rows, report, stop.
