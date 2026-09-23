# Sawa Split — Product Requirements Document

**Status:** Locked for MVP build · Future Leaders Challenge Eastern Africa

## 1. One-line summary

A transparent, point-of-sale value-split app that routes tourist payments — including photo-consent compensation — directly to the women and PWD producers and drivers who created the value, at the moment of payment.

## 2. Problem statement

Money and cultural/image value already flow through Kenya's tourism economy toward women and PWD producers — it is intercepted before it reaches them.

- **Money leakage:** an informal, undisclosed commission chain (drivers, guides, shop owners) captures most of what a tourist pays for a craft, meal, or cultural visit before the maker sees it. Documented case: village boma entrance-fee share fell from ~50% (early 1990s) to roughly 1/17th of a $20 fee (mid-2000s), with drivers openly steering pricing and sales.
- **Image/cultural leakage:** tourists photograph Maasai beadwork/dance, coastal cooking, and other cultural labor for free — no consent mechanism, no compensation, even where a site already collects an entrance/photo fee at the operator level.

Both are one pattern: value tourists already pay for is created by women and PWDs, and the current transaction structure routes it around them.

## 3. Target users / personas

| Persona | Who | Primary need |
|---|---|---|
| Tourist | Visitor paying for an experience/craft | See exactly where money goes; pay easily via M-Pesa |
| Producer (Maker) | Woman or PWD artisan/cook/performer | Guaranteed, transparent share; choice of which components (product, photo, or both) they charge for; no negotiation dependency on a driver |
| Driver / Guide | Referral intermediary | A disclosed, guaranteed fee that's faster/easier than pressuring a sale |
| Coordinator (Admin) | Team member, later a cooperative/local partner | Onboard participants, monitor the ledger, resolve disputes |

## 4. Goals & success metrics (pilot)

- A working transaction: tourist pays → maker and driver balances credited → at least one successful withdrawal, end to end, on real (sandbox) Daraja.
- A live, honest ledger a judge can inspect during Q&A.
- Zero disputes left unresolved at demo time; reconciliation total always balances (collected = disbursed + pending).
- Field-validated pricing/split assumptions from Phase 0 observation, not desk research alone.

## 5. User stories

- As a **tourist**, I want to see a clear price breakdown before I pay, so I know my money reaches the maker, not just a middleman.
- As a **tourist**, I want to pay with M-Pesa in one step, so the flow feels familiar, not foreign.
- As a **producer**, I want to see my earnings credited immediately after a sale, so I'm not dependent on a driver handing over cash later.
- As a **producer**, I want to withdraw my balance once it clears a minimum, so I control when I get paid.
- As a **driver**, I want a guaranteed, disclosed referral fee, so I don't have to pressure sales or hide my cut.
- As a **coordinator**, I want to onboard producers/drivers with a phone number and PIN, so setup doesn't require self-service signup infrastructure.
- As a **producer**, I want to switch product and photo-consent charges on or off independently, so I only charge for what actually applies to my work.
- As a **coordinator**, I want to see collected vs. disbursed vs. pending totals, so I can prove the ledger is honest.
- As a **coordinator**, I want to freeze a disputed transaction's payout, so a disagreement doesn't result in a wrong payment.

## 6. Functional requirements (MVP scope)

1. Public payment-initiate flow (no login) — STK Push, rate-limited per phone number.
2. Price-transparency card showing each active component (product, photo consent) as its own priced card, never merged — only the components a producer has switched on appear, and each is split independently (product: maker/driver; photo: maker only, no split).
3. Driver identification via QR scan at point of sale.
4. Automatic ledger crediting on Daraja payment confirmation (pending balance).
5. On-demand withdrawal (full balance, ≥ KES 500) and a daily 18:00 EAT batch sweep, both via Daraja B2C.
6. Producer/Driver login (coordinator-issued phone + PIN) and a dashboard showing balance + transaction history.
7. Coordinator dashboard: registration, reconciliation view, dispute flagging, manual payout retry.
8. Offline cash-transaction logging, recorded for evidence only, synced when connectivity returns.

## 7. Non-goals (explicitly out of scope for MVP)

- Platform fee / revenue share for Sawa Split itself — every shilling is the maker's or the driver's.
- Dynamic, GPS/volume-scored referee commissions — fixed per-producer split only; dynamic scoring is a named Phase 3+ direction, not built now.
- Public self-registration for producers/drivers.
- Multi-currency, KYC, or tax handling.
- Partial withdrawals (always full available balance).
- Automatic dispute resolution (a human coordinator always decides).

## 8. Assumptions & dependencies

- Safaricom Daraja sandbox access (STK Push + B2C) is available during the build; production B2C requires separate business approval (parallel-tracked, not a build blocker).
- Supabase project (managed Postgres, Auth, Realtime, Storage) provisioned before Phase 1.
- Render hosting for both backend and frontend services.
- Field validation (Phase 0) happens before or alongside Phase 1 pilot setup, not after.

## 9. Related documents

`TRD.md` · `APP_FLOW.md` · `UI_UX_DESIGN.md` · `BACKEND_SCHEMA_AUTH.md` · `IMPLEMENTATION_PLAN.md` — plus the published Design, Architecture, and Rulebook references.
