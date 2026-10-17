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

12. Referrer page (/#/driver/<code>): clear badge "<First name> · <type> · Active" or
    "Not active" (suspended/closed; no reason shown).
13. Cash confirm buttons show the person's own share: "Confirm sale of KSh <total>.
    Your share: KSh <share>" for the maker and the referrer.
14. Navbar: "Log in" when there's no valid session (expired/missing token = logged
    out); "Dashboard · Log out" only when logged in. Check the homepage too.
15. Registration types (additive):
    - referrer_type: driver | tour_guide | agent. The coordinator picks it; shown on the
      referrer page, the referrer dashboard and Reconciliation's per-referrer table.
      Existing: James = driver, Hassan = agent.
    - business_type for makers: product | service. Product: photo fee optional per sale
      (as now). Service: photography is included free in the price: no photo line, no
      toggle, checkout shows "Photography included"; the whole price is split normally
      (maker + referrer). No photo fee needed at registration for services.
      Existing: Wanjiru = product, Amina = product.
16. Checkout with a tour pass asks "Still with <name>?": Yes keeps it; "No, I'm done"
    removes the referral AND clears the tour pass from the phone.
17. Tours (anti code-farming):
    - Referrer dashboard: "Start tour" with group size (1-30); one active tour per
      referrer; it ends at midnight EAT or when he taps "End tour".
    - A tourist JOINS by scanning the referrer QR ("Use X as my guide today") or by
      typing the code at checkout. Joins are counted SERVER-SIDE; the tour pass stores
      a server-issued join token, not just the code.
    - Refused when there's no active tour ("X isn't running a tour right now") or the
      tour is full ("X's tour is full"); the tourist then pays with no referral
      (maker 100%).
    - A sale earns a referral only with a valid join for an active tour.
    - Reconciliation: tours list (referrer, date, group size, joined, sales, commission).
    - Plan + effort estimate first; say so if large.
18. UI pass (wording and layout only, no new business rules):
    a) BUG CHECK FIRST: a cash sale with a referrer must not show "Cash payment
       confirmed" to the tourist until BOTH referrer and maker have confirmed. Until
       then the tourist sees "Waiting for the seller and guide to confirm".
    b) Maker dashboard: "New sale" first and prominent; amount input uses a numeric
       keypad (inputmode="numeric"); the sale card shows "You get X · <Guide> Y"
       instead of repeating the total; the Confirm button sits inside the sale card:
       "Cash received? Confirm sale. Your share: KSh X". Summary at the top: Today's
       sales, Cash in hand, Owed to guides, Available to withdraw.
    c) Referrer dashboard: confirm button reads "Confirm this sale. You earn KSh X"
       (never "cash received"); summary: "Today: N referrals · KSh X waiting for
       confirmation" and "Owed to you: KSh Y".
    d) Tourist pages (stall, checkout, receipt, referrer page): no "Log in" link, just
       the logo + "Verified checkout"; the referrer is called "Guide · <name>"; the
       receipt shows a receipt number, "Nothing was taken out for Sawa Split" and
       "Tip: screenshot this receipt".
    e) Every status names the next step ("Waiting for Hassan to confirm", not
       "confirming"). Replace the bare "Live" dot with "Updates live" or remove it.
    Tests (TEST project): extend verify_v2.sh (tours full/inactive/no-tour, types,
    service = no photo line, "No, I'm done"); re-run security + Stage 4. Push code
    before any demo DB change. Live check with CASH only (start tour, join, sale,
    confirm buttons show shares, full tour refuses), clean up, report, stop.
    New columns must be nullable or have a default (old and new code side by side).

19. Homepage roadmap preview (V3 shown, not built). Frontend only: no API, DB or
    npm changes.
    - Roadmap: the "Next:" line becomes three columns. Now (live): transparent split,
      M-Pesa + cash, tours, batched payouts. Next: Find a verified guide near you.
      Later: more sites, Kiswahili, multiple referrers per payment.
    - Before/after strip above the roadmap: "Today: guides wait at the gate and
      approach tourists." / "Next: tourists find verified guides — and every shilling
      still has an address."
    - /#/demo: new first step "Find your guide — coming next" (?step numbers shift so
      step=0 is this one). Static sample list: James · Driver, Hassan · Agent, each
      "Coordinator-verified"; no ratings, map or reviews; labelled "Preview — not live
      yet". Tapping James continues to the tour-pass step. The demo banner stays.

20. Installable PWA (not offline payments). Frontend only: hand-written manifest and
    service worker, no npm install, no API or DB changes.
    - manifest.webmanifest: "Sawa Split", start_url "/#/", scope "/", standalone,
      theme #1B2A41; icons 192, 512 and a 512 maskable, rendered from logo.svg.
    - sw.js: never caches or intercepts the API, Supabase or any non-GET; navigations
      network-first (cached copy only offline); hashed assets and icons cache-first;
      an offline page saying payments and balances need a connection; versioned
      cache, old caches deleted on activate. Registered only in production builds.
    - Accessibility pass on the pages touched (lang, labels, button names, 44px tap
      targets); anything bigger is listed, not fixed, without asking.

STRETCH (only after MUST passes live, ask me first): per-person "ticket" sale: price
per person, many payments, "N paid", maker closes, auto-close after 2 h.

OUT OF SCOPE (don't build): paying each group member individually; multiple referrers
per payment; instant per-party B2C; commission caps or tiers; driver photo; signed B2C
result URL; self-registration; partial withdrawals; offline mode; adding a referral
after the sale (coordinator-assisted, both parties confirm); Kiswahili toggle (roadmap).

UNCHANGED: the coordinator registers everyone; referral % fixed by the coordinator;
cash = two confirmations, maker's share recorded as cash held, referrer's share becomes
a debt settled from the maker's M-Pesa earnings as soon as they cover it (at
confirmation, the next M-Pesa credit, a payout attempt, or the 18:00 sweep); payouts batched, never above M-Pesa
collected, one auto retry, pause on 8006; no platform fee.

PROCESS: send me a plan of at most 10 lines FIRST and wait for my OK. Additive
migrations only. Ask before any npm install. No STK or B2C in tests. Push code before
any demo DB change. Commit without attribution. When done: push, wait for Render Live,
test on the LIVE site with Amina + Hassan using CASH only (tour pass -> new sale ->
stand QR -> code pre-filled -> cash confirm -> balances + reconciliation; no-code sale
-> maker 100%; expired/cancelled/paid refuse), clean the demo test rows, report, stop.
