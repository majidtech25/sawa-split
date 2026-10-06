# Sawa Split — Demo Script & Fallback Plan

**Status:** Locked for the pitch. This is the physical, click-by-click choreography behind the "live demo" beat already written into `Sawa_Split_Pitch_Script.pdf`'s Section 3 (Solution, 2–2.5 min). Read alongside that script, not instead of it — this file is the mechanics, the pitch script is the words.

> **Every live STK Push costs real money.** Confirmed during stage 5: a sandbox STK Push to a real Safaricom number charged real money (KES 60, non-refundable). The demo price here is KSh 110 (product KSh 100 + photo consent KSh 10), so every dry run, rehearsal and live attempt costs the presenter KSh 110.
> - **Narration must stay accurate.** Say that *the split is recorded and each share is credited to their balance*. Never say or imply that the maker received money: in sandbox, B2C only pays Safaricom's test number, never a real maker's or driver's phone.
> - **Prefer the recorded fallback (Section 5) over paid live retries.** If the first live attempt fails, cut to the recording as Section 4 says. Don't pay for a second attempt on stage.

## 1. Roles

- **Presenter** — talks throughout, holds the printed price-transparency card and QR card as physical props, initiates the M-Pesa confirmation on their **own phone**. Never touches the laptop.
- **Driver** — seated at the laptop, drives the browser on cue, watches for the fallback triggers in Section 4 below, and makes the cut-to-backup call without waiting for the presenter to notice something's wrong.

Rehearse this as a duet, not a solo with an assistant — the driver's judgment call in Section 4 is the single highest-leverage thing to practice.

## 2. Pre-demo setup (before judges are seated)

- Laptop connected to the projector; browser zoomed to ~150% so the price-transparency card and dashboard numbers read from the back of the room.
- **Tab 1:** tourist payment-entry screen pre-loaded for "Talek gate · beadwork" — price-transparency card visible, showing the two locked components separately: Product KSh 100 (maker KSh 70, driver referral KSh 30), Photo consent KSh 10 (maker only), Total KSh 110. These are the demo producer's real configured split (30% driver), so the card shows exactly what the STK Push charges and the ledger records.
- **Tab 2:** coordinator reconciliation/dashboard view, already logged in, ledger table visible without scrolling.
- **Tab 3 (hidden until needed):** the backup screen recording, cued to 0:00, paused, audio level checked.
- Presenter's own Safaricom phone: charged, on vibrate (the buzz is part of the moment — don't mute it), M-Pesa PIN known cold. Confirm in a dry run *before* the event that this exact number is registered and receiving Daraja sandbox STK prompts reliably.
- Confirm venue connectivity in advance, not day-of. Bring a personal hotspot as the primary connection and venue WiFi as the fallback (or the reverse, whichever tested more reliably) — both tested ahead of time, not assumed.

## 3. Click-by-click sequence

Keyed to the pitch script's own stage directions in Section 3.

1. Presenter finishes the QR-card beat: *"This isn't a mockup. Watch."*
2. Driver switches to **Tab 1** (already loaded — no navigating live).
3. Driver clicks the phone number field, types the presenter's number, taps **Pay KSh 110**.
4. Presenter's phone buzzes (~2–4 sec). Presenter picks it up, enters their M-Pesa PIN — no need to hide this from the room, a PIN pad isn't sensitive to show, but keep the phone screen angled naturally away from the camera out of habit.
5. Driver stays on Tab 1 until the confirmation screen lands — shown as the two separate component breakdowns (Product: maker/driver split; Photo consent: maker only), holds 2 seconds.
6. Driver switches to **Tab 2** — the new row appears via Supabase Realtime, status flips pending → confirmed, the split is visible: maker's product share, driver referral, and the separate photo-consent line to the maker.
7. **Pause. No narration over this moment** — the pitch script calls this out explicitly; let the ledger update speak for itself.
8. Presenter: *"That transaction you just watched — the split is recorded and each share is credited to their balance. No one had to take our word for it."*

## 4. Fallback triggers — the driver's call, not the presenter's

The presenter keeps talking no matter what happens on screen. The driver decides silently and acts.

- STK prompt hasn't buzzed the phone within **~8 seconds** of tapping Pay → cut to Tab 3 immediately. Don't wait it out live.
- Phone buzzes, PIN is entered, but the ledger doesn't update within **~10 seconds** → same, cut to Tab 3.
- WiFi/hotspot drops entirely, at any point → cut to Tab 3, no attempt to reconnect live on stage.
- **Never narrate the failure.** The cut to backup should read as a deliberate part of the demo, not a recovery — no "hmm, one sec," no apologetic tone.

## 5. Backup recording requirements

- One full, real, successful sandbox transaction, screen-captured start to finish — no face or live audio needed, since the presenter's own narration carries the moment either way.
- **Re-recorded within 48 hours of the event** — not an old capture that might not match the current build (especially now that the price card shows two separate components rather than the earlier merged version).
- Stored locally on the demo laptop (not dependent on live internet to play) and duplicated on a second laptop or USB as a second-layer backup.

## 6. Rehearsal checklist

- Full run-through of all five pitch sections at least twice, timed against the pitch script's own labels: 60–90s Open, 90s Problem, 2–2.5min Solution (this demo lives inside it), 1–1.5min Impact, 30s Close.
- Run it once assuming everything works, and once where you **deliberately trigger the fallback mid-rehearsal** — so the driver's cut-to-backup reflex is trained by feel, not just read on paper.
- Confirm the printed price-transparency card and QR card in hand match exactly what's on screen — no stale numbers from an earlier draft of the design.
