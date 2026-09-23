# Sawa Split — Implementation Plan

**Status:** Locked. Combines the pre-build planning checklist (Phases A–H) with the delivery roadmap (Phases 0–3) into one ordered build plan.

## Part 1 — Pre-build planning (complete before any code)

Work top to bottom. Finish all of one phase before starting the next — this is what stops the team coding against a data model that's still shifting underneath them.

- [x] **A — Scope Lock:** one-page in/out-of-scope list for the MVP demo, whole team agreed.
- [x] **B — User Flows:** documented in `APP_FLOW.md`.
- [x] **C — Data Model:** documented in `BACKEND_SCHEMA_AUTH.md`.
- [x] **D — Architecture & Stack:** documented in `TRD.md` and the Architecture reference.
- [ ] **E — Daraja Integration Plan:** register Safaricom Daraja sandbox app, obtain consumer key/secret, confirm STK Push + B2C endpoints, set up ngrok for local callback testing.
- [ ] **F — Wireframes:** price-transparency card, payment-confirmation screen, producer/driver dashboard, coordinator reconciliation view (per `UI_UX_DESIGN.md`'s screen list).
- [ ] **G — Environment & Tooling Setup:** GitHub repo, Render services (backend + frontend), Supabase project provisioned, `.python-version` pinned, Daraja + Supabase credentials stored as Render env vars (never committed).
- [ ] **H — Demo Script & Fallback Plan:** exact click-by-click script for the 7-minute pitch, a backup screen-recording of one full successful run, assign presenter vs. keyboard-driver roles.

## Part 2 — Delivery phases

### Phase 0 — Observation & Validation
Ground the desk research in direct evidence before building. Interview 3–5 producers and 2–3 drivers at one candidate site; observe 2–3 live transactions; compile a Field Validation Note; confirm named Phase 1 pilot partners.
**Definition of done:** a written validation note with a confirmed or adjusted split/fee range, and named willing pilot participants.

### Phase 1 — Pilot
Formalize a one-page agreement with the chosen maker and driver; co-design the price-transparency card; confirm the producer's M-Pesa Till; build the MVP (QR generation, Daraja sandbox split logic, transaction log); print the driver's QR; run the pilot for 2–3 weeks, logging every visit; debrief.
**Definition of done:** at least one real, end-to-end transaction — tourist pays, ledger credits, a successful withdrawal — logged and demonstrable.

### Phase 2 — Local Scale
Recruit additional producers toward ~10 (matching Kenya's cooperative minimum); onboard more drivers; introduce the rotating-host schedule; move the ledger to the shared live dashboard; open a conversation with one local partner (county tourism office, Ecotourism Kenya).
**Definition of done:** multiple producers and drivers transacting through the same system at one site.

### Phase 3 — Multi-Site / Formalize
Register a cooperative society for the pilot group (KSh 500 fee, minimum 10 members, ~90-day process); repeat Phase 0's observation method at 1–2 additional sites; approach a small grant/partnership for scale funding; open a conversation with the Tourism Regulatory Authority about a complementary trust-mark.
**Definition of done:** a registered cooperative and at least one additional validated site.

## Part 3 — What's deliberately sequenced last (not skipped, not rushed early)

- Production Daraja B2C approval — parallel-tracked starting in Phase 1, not required to demo the mechanism in sandbox.
- Dynamic, GPS/volume-scored referee commissions — a named Phase 3+ direction in the pitch, not built into the MVP.
- Dark mode — tokens are defined (`UI_UX_DESIGN.md`), implementation deferred past the pitch.
- Any platform fee or community-fund mechanism — explicitly rejected; not on this plan at all.

## Part 4 — Milestone checklist for the event

- [ ] MVP demonstrable end-to-end (real STK Push → real split → real ledger update) before the PPT is due (3 days pre-event).
- [ ] Pitch script rehearsed against the actual demo timing (`Sawa_Split_Pitch_Script.pdf`).
- [ ] PPT deck finalized from the locked slide content.
- [ ] Printed price-transparency card and QR sample ready as physical props.
- [ ] Backup screen-recording ready in case live demo connectivity fails during the pitch.
