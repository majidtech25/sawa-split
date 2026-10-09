# Sawa Split — App Flow

**Status:** Locked for MVP build. One flow per persona; each step names the screen/action and what state changes.

## 1. Tourist — payment flow (no login)

1. Arrives at a participating stall/site. Sees the printed or on-screen **price-transparency card** — one card per component this maker has switched on (product, photo consent, or both), each showing its own breakdown, plus a combined total. This card must be generated before money changes hands either way — cash doesn't get to skip this step.
2. Agrees to pay, chooses a payment method: **M-Pesa** or **Cash**. Driver's QR is scanned (by the driver or coordinator) at the same moment if there is a driver referral, identifying the referral recipient — nullable, since a photo-only visit or a walk-up cash sale can have no driver.
3. **M-Pesa:** enters phone number on the public pay screen. App calls `POST /transactions/initiate` with `payment_method: mpesa` → Daraja STK Push fires to the tourist's phone. Tourist confirms the STK prompt on their own phone (PIN entry, native M-Pesa UI — outside the app). Daraja fires `POST /daraja/stk-callback` → backend writes pending `WalletLedgerEntry` rows for maker and driver, marks `Transaction.status = confirmed`.
4. **Cash:** app calls `POST /transactions/initiate` with `payment_method: cash` → no Daraja call; the transaction is created directly in `cash_unconfirmed` status with a `confirmation_deadline` (`created_at + CASH_CONFIRM_WINDOW_MINUTES`, default 10 min). If a driver referred the sale (**Case A**), it needs both the driver's and the maker's confirmation before it settles. If it's a walk-up sale with no driver (**Case B**), it needs both the tourist's own confirmation and the maker's — her confirmation needs no login: a short-lived signed token tied to the transaction (an in-page "I paid" button on the confirmation screen, or an SMS link if she's moved on). Once confirmed, the cash is recorded, not paid out: the maker already holds it (section 5).
5. Tourist sees a confirmation screen. For M-Pesa: amount paid, each enabled component's breakdown shown again for reassurance (product's maker/driver split; photo consent's maker-only amount, clearly not split). For cash: an honest `cash_unconfirmed` / `cash_confirmed` state rather than a premature checkmark — "Marked as cash — confirming with [maker]" until confirmed — and, for a Case B walk-up sale, this is also where she taps her own "I paid" confirmation.
6. **Failure paths:** M-Pesa STK times out or fails → `Transaction.status = failed`, no ledger entry written, tourist sees a plain retry message, must manually re-initiate. A cash sale still `cash_unconfirmed` past its `confirmation_deadline` → `Transaction.status = cash_expired`, kept visible in the ledger and reconciliation view, never deleted, never silently retried — and, like the M-Pesa failure path, no ledger entry is ever written for it.

## 2. Producer (Maker) — onboarding + ongoing use

1. **Onboarding (coordinator-led, in person):** coordinator creates the Producer record (name, phone, Till, site, default split, and which components they charge for — product, photo consent, or both) and a Supabase Auth account (phone + 4-digit PIN) via the admin flow.
2. Producer logs in (phone + PIN) → lands on their dashboard.
3. Dashboard shows: current available balance (large, mono numerals: the payable M-Pesa-sourced balance, after any cash-sale debt to drivers), what they still owe drivers from cash sales and the cash already in their hands, pending balance, recent transaction history (read directly from Supabase via RLS) — the cash states (`cash_unconfirmed`, `cash_confirmed`, `cash_expired`) render visibly distinct from the M-Pesa pending/confirmed/disputed states, since an unconfirmed cash sale is still resolving, not flagged as wrong. Any row awaiting the maker's own confirmation (Case A or Case B, rule 12) carries an inline **Confirm** action.
4. When the payable balance ≥ KES 500, a **Withdraw** button becomes active. A maker who still owes drivers from cash sales has a payable balance of 0 until their M-Pesa earnings cover the debt (section 5).
5. Producer taps Withdraw → `POST /withdrawals/request` → full available balance is queued for B2C payout.
6. If not manually withdrawn, the daily 18:00 EAT batch sweep processes it automatically.
7. Producer sees payout confirmation (or, on failure, a "we're retrying" state — funds remain visible as available, never disappear).

## 3. Driver / Guide — onboarding + ongoing use

1. **Onboarding (coordinator-led):** coordinator creates the Driver record (name, phone, Till) and generates a unique QR code (stored in the `qr-codes` Supabase Storage bucket), printed and laminated for the driver to carry.
2. Same login pattern as Producer (phone + PIN).
3. Dashboard mirrors the Producer dashboard, but leads with **referral count and balance** rather than "amount received" — same components, different information hierarchy (per the design system's two-persona rule). Any Case A referred-cash-sale row awaiting the driver's own confirmation (rule 12) carries the same inline **Confirm** action as the Producer dashboard. The driver's share of a confirmed cash sale shows as "owed by makers" until the maker's M-Pesa earnings cover it, then lands in the driver's available balance.
4. Withdrawal flow identical to Producer's.

## 4. Coordinator / Admin — ongoing operation

1. Logs in via Supabase Auth with an `is_admin` claim.
2. **Registration:** creates new Producer/Driver accounts, generates QR codes, sets each producer's default split (capped so the maker's share never falls below 60% of the product component) and which components they charge for (product, photo consent, or both — at least one required).
3. **Reconciliation view:** `GET /admin/reconciliation` — M-Pesa collected vs. disbursed vs. still owed. These always sum exactly and match the real M-Pesa account balance, because cash never enters it. Cash recorded and outstanding maker → driver cash debts are shown beside these totals, with a list of the debts. The status column shows `cash_unconfirmed`, `cash_confirmed`, and `cash_expired` as distinct, visible states rather than folding them into "pending" — expired-unconfirmed cash rows are what a coordinator should notice first.
4. **Dispute handling:** flags a `Transaction` as disputed → its associated `WalletLedgerEntry` rows move to `frozen`, excluded from any withdrawal or batch calculation until the coordinator resolves it.
5. **Manual payout retry:** if a B2C payout fails twice (one automatic retry already attempted), the coordinator manually retries from this screen.
6. **Driver commission review (future gate, logic already planned):** when computing a driver's clean-referral streak, only `mpesa` referrals and `cash_confirmed` referrals count — a `cash_expired` referral does not, which is what gives the driver a reason to chase confirmation rather than let it lapse.

## 5. Cash flow — dual confirmation

Cash is a first-class second payment method, tracked via dual confirmation — not an offline afterthought and not evidence-only (supersedes an earlier, explicitly rejected "manual cash-entry log" design). Split into two cases by whether a driver is attached, because the enforcement mechanism differs:

1. **Case A — referred cash sale** (`driver_id` set): requires BOTH `driver_confirmed_at` and `maker_confirmed_at` to be set before the transaction moves from `cash_unconfirmed` to `cash_confirmed`.
2. **Case B — walk-up cash sale** (no `driver_id`): requires BOTH `tourist_confirmed_at` and `maker_confirmed_at`.
3. Both cases start from the same mandatory first step as M-Pesa: the price-transparency card must be generated (via QR or the driver's/maker's own screen) *before* money changes hands.
4. Confirmation happens via `POST /transactions/:id/confirm`, called once per required party — the driver and maker from their authenticated dashboard session (Case A), the tourist via her short-lived signed token needing no login alongside the maker's own dashboard confirmation (Case B).
5. A `cash_unconfirmed` transaction still unconfirmed past its `confirmation_deadline` (default 10 min, `CASH_CONFIRM_WINDOW_MINUTES`) flips to a terminal `cash_expired` state — kept visible in the ledger and reconciliation view, never deleted, never silently retried.
6. **Only `cash_confirmed` transactions write `WalletLedgerEntry` rows.** A `cash_expired` transaction never does.
7. **Cash is never paid out by B2C** *(revised 2026-10-09).* The cash is in the maker's hands, not the M-Pesa account. Paying it out again would pay the maker twice, and a faked cash sale would be paid out of other tourists' M-Pesa money. At `cash_confirmed`:
   - The maker's share is recorded as received (`cash_held`), never payable.
   - The driver's share (Case A) becomes a debt the maker owes the driver (`cash_debts`). It's settled internally, with no B2C call, by moving the amount from the maker's available M-Pesa-sourced balance to the driver's: at confirmation if it's covered, otherwise as soon as it is (the maker's next M-Pesa credit, a payout attempt, or the 18:00 sweep). Debts settle whole. A disputed sale's debt waits for the dispute. From there the driver is paid by the normal rules.
   - Result: a fake Case A sale nets the colluding pair zero, and a fake Case B sale moves no money. Case B's tourist token can still be self-confirmed by the maker (it's returned to whoever starts the sale); that's now a records issue for Phase 2, not a money issue.

Note: `SyncQueueItem` (`sync_queue_items`) is unrelated to cash tracking and remains unbuilt — it's reserved for a separate, still-hypothetical concern (true offline/no-connectivity capture, e.g. a fully offline PWA sync queue), not for cash payments, which are tracked directly on `transactions` via `payment_method` and the fields above.

## 6. Cross-cutting rules referenced by every flow above

- No transaction can be initiated against an unregistered driver QR or an inactive producer — rejected at scan time with a plain error.
- Every Daraja webhook (STK or B2C) is idempotent on its reference — a redelivered callback never double-credits or double-pays.
- Withdrawals are always full-balance, never partial, and only of M-Pesa-sourced money: a maker's payable balance is their available balance minus what they owe drivers from cash sales.
- B2C never pays out more than M-Pesa collected: every payout is checked first, and refused with a critical log if it would.
- A `cash_unconfirmed` transaction expires to `cash_expired` at its `confirmation_deadline` if not confirmed by both required parties — no ledger entries are ever written for an expired cash transaction, and it is never deleted or silently retried.
