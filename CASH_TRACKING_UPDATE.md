# Cash Tracking — Implementation Delta (2026-09-24)

**Purpose:** this is a delta spec for Claude Code. Give it this file plus the instruction at the bottom — it should update `APP_FLOW.md`, `BACKEND_SCHEMA_AUTH.md`, and the relevant screens/routes to match, then implement.

Supersedes any earlier "manual cash-entry log" idea. Design rationale lives in the project's `sawa-split-supervisor-feedback-2026-09-23.md` doc if more context is needed — this file is just the buildable delta.

## 1. Core change: cash sales split into two flows by whether a driver referred them

- **Case A — Referred cash sale:** driver + maker both confirm. Requires both parties' confirmation to post as settled.
- **Case B — Walk-up cash sale (no driver):** tourist + maker both confirm. Weaker (tourist has no financial stake) but still dual-party, and it's the same step that produces the tourist's itemized receipt / photo-consent record.

Both cases start from the same mandatory first step already in the design: the price-transparency card must be generated (via QR or driver/maker's own screen) *before* money changes hands — cash is no longer allowed to skip that step.

## 2. Schema changes (`BACKEND_SCHEMA_AUTH.md` / actual DB migration)

On the transaction/ledger table, add or change:

- `payment_method` enum: `mpesa` | `cash` (existing M-Pesa flow unaffected).
- `status` enum extended to include, for cash rows only: `cash_unconfirmed`, `cash_confirmed` (alongside the existing `pending` / `confirmed` / `disputed` used by M-Pesa rows).
- `driver_confirmed_at` timestamp, nullable — set when the driver taps confirm (Case A only).
- `maker_confirmed_at` timestamp, nullable — set when the maker taps confirm (both cases).
- `tourist_confirmed_at` timestamp, nullable — set when the tourist taps confirm (Case B only).
- `confirmation_deadline` timestamp — set at transaction creation to `created_at + CASH_CONFIRM_WINDOW_MINUTES` (config value, default 10).
- A row moves from `cash_unconfirmed` to `cash_confirmed` only when both required confirmations (driver+maker for Case A, tourist+maker for Case B) are present before `confirmation_deadline`. A background job (or a check-on-read) flips any row still `cash_unconfirmed` past its deadline to a terminal `cash_unconfirmed_expired` state — keep it visible in the ledger, don't delete it.

## 3. API/route changes

- Existing "create transaction" flow: accept `payment_method: cash` alongside `mpesa`. If `cash`, skip the Daraja STK Push call entirely and instead create the ledger row directly in `cash_unconfirmed` status with `confirmation_deadline` set.
- New endpoint (or reuse an existing generic "confirm" action parameterized by role): `POST /transactions/:id/confirm` — accepts the caller's role (driver/maker/tourist, inferred from auth session or a short-lived confirm token for the tourist, who isn't logged in). Sets the corresponding `*_confirmed_at` field. If all required confirmations for that transaction's case are now present, flip status to `cash_confirmed`.
- Tourist confirmation path needs no login — reuse whatever mechanism already exists for showing them the payment-confirmation screen (e.g. a link/token tied to the transaction, or an in-page "I paid" button shown right after they select Cash, since they're already on that screen).

## 4. Screen changes

- **Payment-entry screen (screen 2 in `UI_UX_DESIGN.md`):** add a "Cash" option alongside the existing "Pay [amount]" M-Pesa button. Selecting Cash creates the transaction immediately (per §3) and moves to a lightweight "waiting for confirmation" state rather than the M-Pesa STK polling state.
- **Payment confirmation screen (screen 3):** for cash, show a status reflecting `cash_unconfirmed` vs `cash_confirmed` rather than assuming success — the tourist should see "Marked as cash — confirming with [maker]" until confirmed, not a green checkmark prematurely. If it's a Case B walk-up sale, this is also where the tourist's own confirm action lives ("I paid").
- **Producer/Driver dashboard (screen 5):** recent-transactions list needs a fourth status indicator distinct from the existing three-state (pending/confirmed/disputed) — `cash_unconfirmed` should read visibly differently from a disputed M-Pesa transaction, since it's "still resolving," not "flagged as wrong." Add a "Confirm" action inline on any row awaiting this user's own confirmation.
- **Coordinator reconciliation view (screen 8):** the status column needs `cash_unconfirmed`, `cash_confirmed`, and `cash_unconfirmed_expired` as visibly distinct states — don't fold them into "pending." Expired-unconfirmed cash rows are the ones worth a coordinator's attention first.

## 5. Link into driver commission-increase gate (already-planned logic)

When computing a driver's "clean referral" streak for a commission-increase review (existing plan, screen 7 rate field), only count referred transactions where `payment_method = mpesa` OR (`payment_method = cash` AND `status = cash_confirmed`). A `cash_unconfirmed_expired` referral does not count toward the streak — this is what gives the driver a reason to chase confirmation rather than let it lapse.

## 6. Config

- `CASH_CONFIRM_WINDOW_MINUTES` — default 10, should be easy to change without a redeploy (env var or a settings row) since the right window is genuinely unknown until Phase 0/1 field testing.
- Geofencing (requiring driver+maker confirmation to happen at the same site) is explicitly **out of scope for this pass** — flagged as a Phase 2 hardening step, not a Phase 1 blocker.

---

## Prompt to give Claude Code

> Read `CASH_TRACKING_UPDATE.md` at the repo root. Update `APP_FLOW.md` and `BACKEND_SCHEMA_AUTH.md` to incorporate this design (don't just append — integrate it into the existing sections on payment flow and the transaction/ledger schema). Then implement the schema migration, the two confirm endpoints, and the screen changes described in §4, reusing existing components (three-state indicator, price-transparency card, payment-entry screen) rather than building parallel new ones. Ask me before changing anything about the M-Pesa/Daraja flow itself — this should only add a parallel cash path, not touch what's already working.
