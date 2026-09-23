# Sawa Split — App Flow

**Status:** Locked for MVP build. One flow per persona; each step names the screen/action and what state changes.

## 1. Tourist — payment flow (no login)

1. Arrives at a participating stall/site. Sees the printed or on-screen **price-transparency card** — one card per component this maker has switched on (product, photo consent, or both), each showing its own breakdown, plus a combined total.
2. Agrees to pay. Enters phone number on the public pay screen.
3. App calls `POST /transactions/initiate` → Daraja STK Push fires to the tourist's phone.
4. Driver's QR is scanned (by the driver or coordinator) at the same moment, identifying the referral recipient.
5. Tourist confirms the STK prompt on their own phone (PIN entry, native M-Pesa UI — outside the app).
6. Daraja fires `POST /daraja/stk-callback` → backend writes pending `WalletLedgerEntry` rows for maker and driver, marks `Transaction.status = confirmed`.
7. Tourist sees a confirmation screen: amount paid, each enabled component's breakdown shown again for reassurance (product's maker/driver split; photo consent's maker-only amount, clearly not split).
8. **Failure path:** STK times out or fails → `Transaction.status = failed`, no ledger entry written, tourist sees a plain retry message, must manually re-initiate.

## 2. Producer (Maker) — onboarding + ongoing use

1. **Onboarding (coordinator-led, in person):** coordinator creates the Producer record (name, phone, Till, site, default split, and which components they charge for — product, photo consent, or both) and a Supabase Auth account (phone + 4-digit PIN) via the admin flow.
2. Producer logs in (phone + PIN) → lands on their dashboard.
3. Dashboard shows: current available balance (large, mono numerals), pending balance, recent transaction history (read directly from Supabase via RLS).
4. When available balance ≥ KES 500, a **Withdraw** button becomes active.
5. Producer taps Withdraw → `POST /withdrawals/request` → full available balance is queued for B2C payout.
6. If not manually withdrawn, the daily 18:00 EAT batch sweep processes it automatically.
7. Producer sees payout confirmation (or, on failure, a "we're retrying" state — funds remain visible as available, never disappear).

## 3. Driver / Guide — onboarding + ongoing use

1. **Onboarding (coordinator-led):** coordinator creates the Driver record (name, phone, Till) and generates a unique QR code (stored in the `qr-codes` Supabase Storage bucket), printed and laminated for the driver to carry.
2. Same login pattern as Producer (phone + PIN).
3. Dashboard mirrors the Producer dashboard, but leads with **referral count and balance** rather than "amount received" — same components, different information hierarchy (per the design system's two-persona rule).
4. Withdrawal flow identical to Producer's.

## 4. Coordinator / Admin — ongoing operation

1. Logs in via Supabase Auth with an `is_admin` claim.
2. **Registration:** creates new Producer/Driver accounts, generates QR codes, sets each producer's default split (capped so the maker's share never falls below 60% of the product component) and which components they charge for (product, photo consent, or both — at least one required).
3. **Reconciliation view:** `GET /admin/reconciliation` — Till collected vs. disbursed vs. still-pending; should always sum correctly.
4. **Dispute handling:** flags a `Transaction` as disputed → its associated `WalletLedgerEntry` rows move to `frozen`, excluded from any withdrawal or batch calculation until the coordinator resolves it.
5. **Manual payout retry:** if a B2C payout fails twice (one automatic retry already attempted), the coordinator manually retries from this screen.

## 5. Offline / cash fallback flow

1. At a site with no connectivity, a cash transaction happens directly between tourist and maker/driver (money already changes hands physically).
2. Coordinator or producer logs the transaction in the app anyway, offline — amount, maker, driver, timestamp — stored as a `SyncQueueItem` in local IndexedDB.
3. When connectivity returns, the app calls `POST /transactions/sync`.
4. Backend writes the record as `recorded_offline` — for evidence/reconciliation only. It never enters the withdrawal pipeline, since the cash was already paid directly.

## 6. Cross-cutting rules referenced by every flow above

- No transaction can be initiated against an unregistered driver QR or an inactive producer — rejected at scan time with a plain error.
- Every Daraja webhook (STK or B2C) is idempotent on its reference — a redelivered callback never double-credits or double-pays.
- Withdrawals are always full-balance, never partial.
