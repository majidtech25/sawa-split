# Sawa Split — Demo Script & Fallback Plan

**Status:** Locked for the pitch. This is the physical, click-by-click choreography behind the "live demo" beat already written into `Sawa_Split_Pitch_Script.pdf`'s Section 3 (Solution, 2–2.5 min). Read alongside that script, not instead of it — this file is the mechanics, the pitch script is the words.

> **Every live STK Push costs real money.** Confirmed during stage 5: a sandbox STK Push to a real Safaricom number charged real money (KES 60, non-refundable). The demo price here is KSh 110 (product KSh 100 + photo consent KSh 10), so every dry run, rehearsal and live attempt costs the presenter KSh 110.
> - **Narration must stay accurate.** Say that *the split is recorded and each share is credited to their balance*. Never say or imply that the creator received money: in sandbox, B2C only pays Safaricom's test number, never a real creator's or site intermediary's phone.
> - **Prefer the recorded fallback (Section 5) over paid live retries.** If the first live attempt fails, cut to the recording as Section 4 says. Don't pay for a second attempt on stage.

## 1. Roles

- **Presenter** — talks throughout, holds the printed price-transparency card and QR card as physical props, initiates the M-Pesa confirmation on their **own phone**. Never touches the laptop.
- **Driver** — seated at the laptop, drives the browser on cue, watches for the fallback triggers in Section 4 below, and makes the cut-to-backup call without waiting for the presenter to notice something's wrong.

Rehearse this as a duet, not a solo with an assistant — the driver's judgment call in Section 4 is the single highest-leverage thing to practice.

## 2. Pre-demo setup (before judges are seated)

- Laptop connected to the projector; browser zoomed to ~150% so the price-transparency card and dashboard numbers read from the back of the room.
- **Live URLs:** site https://sawa-split.onrender.com, API https://sawa-split-api.onrender.com (Render, Frankfurt; the demo Supabase project). Logins (coordinator, Wanjiru, James, Amina, Hassan) are in the git-ignored `DEMO_CREDENTIALS.local.md`; never put the coordinator PIN on screen.
- **Wake the API first:** Render's free tier sleeps after 15 minutes idle and takes about a minute to wake. Open https://sawa-split-api.onrender.com/health and log in once, about 5 minutes before going on (or keep an uptime pinger on `/`).
- **Tab 1 (v1 flow, the fallback):** tourist payment-entry screen pre-loaded for "Talek gate · beadwork" from the signed live demo card:
  - Payment entry: `https://sawa-split.onrender.com/#/pay/2cfa6cbd-4b61-4f71-a632-907f511be41f/checkout?product=100&photo=10&driver=QR-DRIVER-001&sig=906b04a97b5e2debdcb88fa8ff77b028151690632037b31eb30c6251b09799d7`
  - Price card first (the homepage's "See it work" button): `https://sawa-split.onrender.com/#/pay/2cfa6cbd-4b61-4f71-a632-907f511be41f?product=100&photo=10&driver=QR-DRIVER-001&sig=906b04a97b5e2debdcb88fa8ff77b028151690632037b31eb30c6251b09799d7`
  - Price-card links are signed with the backend's `CHECKOUT_LINK_SECRET`, so this link only works against an API using the same secret it was signed with. If the secret, producer, prices or driver change, make a new link from the coordinator's Price cards screen. Changing any value in the link by hand makes the card show "This price card isn't valid — ask the seller for a new one."
  - The price-transparency card shows the two locked components separately: Product KSh 100 (Creator · Wanjiru KSh 70, Intermediary · James KSh 30), Photo consent KSh 10 (creator only), Total KSh 110. These are the demo creator's real configured split (30% to the site intermediary), so the card shows exactly what the STK Push charges and the ledger records.
- **Tab 2:** coordinator reconciliation/dashboard view, already logged in, ledger table visible without scrolling.
- **v2 flow props (SCOPE_V2):** James's referral QR (his dashboard → "Show full screen", or the printed QR-DRIVER-001 card, which still works) and Wanjiru's printed stand QR (her dashboard → "Print my stand QR", opens `#/stand/WANJIRU`). Wanjiru's dashboard open on a second device for "New sale".
- **Start the tour before every demo (v2 flow).** Since tours (SCOPE_V2 MUST 17), an intermediary code earns a referral only for a tourist who joined that site intermediary's running tour. Log in as James (and Hassan, if he's in the demo) → dashboard → **Start tour**, group size = how many tourist phones the demo uses (1–30). A tour ends at midnight EAT, so start it again on each demo day. Without one, the checkout says "James isn't running a tour right now" and the sale pays the creator 100%. If the demo is re-run, tap **End tour** and start a fresh one so joins from the last run don't fill it. The v1 signed card (Tab 1) doesn't need a tour: its site intermediary is part of the signed card.
- **Tab 3 (hidden until needed):** the backup screen recording, cued to 0:00, paused, audio level checked.
- Presenter's own Safaricom phone: charged, on vibrate (the buzz is part of the moment — don't mute it), M-Pesa PIN known cold. Confirm in a dry run *before* the event that this exact number is registered and receiving Daraja sandbox STK prompts reliably.
- Confirm venue connectivity in advance, not day-of. Bring a personal hotspot as the primary connection and venue WiFi as the fallback (or the reverse, whichever tested more reliably) — both tested ahead of time, not assumed.

## 3. Click-by-click sequence

Keyed to the pitch script's own stage directions in Section 3.

1. Presenter finishes the QR-card beat: *"This isn't a mockup. Watch."*
2. Driver switches to **Tab 1** (already loaded — no navigating live).
3. Driver clicks the phone number field, types the presenter's number, taps **Pay KSh 110**.
4. Presenter's phone buzzes (~2–4 sec). Presenter picks it up, enters their M-Pesa PIN — no need to hide this from the room, a PIN pad isn't sensitive to show, but keep the phone screen angled naturally away from the camera out of habit.
5. Driver stays on Tab 1 until the confirmation screen lands — shown as the two separate component breakdowns (Product: creator/intermediary split; Photo consent: creator only), holds 2 seconds.
6. Driver switches to **Tab 2** — the new row appears via Supabase Realtime, status flips pending → confirmed, the split is visible: the creator's product share, the intermediary's referral, and the separate photo-consent line to the creator.
7. **Pause. No narration over this moment** — the pitch script calls this out explicitly; let the ledger update speak for itself.
8. Presenter: *"That transaction you just watched — the split is recorded and each share is credited to their balance. No one had to take our word for it."*

## 3a. v2 sequence: tour pass → stall QR → pay

Each beat is tagged with the matching step of the `/#/demo` walkthrough (section 3b), so the live run and the walkthrough can be shown side by side.

0. *(demo step 2)* **James's dashboard → Start tour** (see section 2), done before judges sit down. The card shows "0 of N joined".
1. *(demo step 3)* Tourist phone scans James's referral QR → "Registered Sawa Split site intermediary · driver", "James · Active" → tap **Use James as my site intermediary today**. The join is counted on the server (James's card: "1 of N joined") and the phone keeps it until midnight EAT.
2. *(demo step 4)* Wanjiru's dashboard → **New sale**: agreed amount (whole KSh, numeric keypad), optional description, optional photo consent (+KSh 10) → **Start the sale**. Status: *Waiting for the tourist to pay*.
3. *(demo step 5)* Tourist phone scans Wanjiru's stand QR (`#/stall/WANJIRU`) → **Still with James?** → **Yes, still with James**. The sale appears with **Intermediary code JAMES** filled in and "Intermediary · James". The breakdown comes from the server: James gets 30% of the agreed amount, rounded down to whole shillings; Wanjiru gets the rest plus the photo fee; total adds up exactly. ("No, not with James" removes James and clears the tour pass: Wanjiru gets 100%.)
4. *(demo steps 6–7)* Pay by M-Pesa (the KSh charge is real, see the warning at the top) or cash. For cash, the tourist sees *Waiting for the seller and site intermediary to confirm*. Wanjiru confirms in her sale card ("Cash received? Confirm sale. Your share: KSh X"), and James confirms on his dashboard ("Confirm this sale. You earn KSh Y"). Only then does the tourist's receipt say *Cash payment confirmed*.
5. *(demo steps 8 and 10)* Coordinator Tab 2: the sale and the split, plus Site intermediaries (JAMES, Driver: sales and commission) and Tours (James: group size, joined, sales, commission) update.
6. Paying the same sale again, or an expired or cancelled one, is refused with a plain message. A full tour refuses another join ("James's tour is full"), and that tourist pays with no referral.

## 3b. The walkthrough at `/#/demo` (no API, no payment)

A click-through of one sale with sample data, entirely in the browser: it calls no API and stores nothing, so it works without the backend and costs nothing. Every step has its own "What's happening" panel; Back/Next and the step bar move between them. Link a step directly with `/#/demo?step=N` (1–11); add `&guide=no` for the path where the tourist is no longer with James.

| Step | Screen | What it shows |
|---|---|---|
| 1 | Coordinator | Registers Wanjiru (creator, 30% referral share, KSh 10 photo fee) and James (site intermediary · driver) in person, each with a PIN |
| 2 | James | Starts a tour for a group of 4 |
| 3 | Tourist | Scans James's QR: tour pass for the day |
| 4 | Wanjiru | New sale: KSh 700, photo consent on (+KSh 10) |
| 5 | Tourist | Scans the stall: "Still with James?" Yes / No, then the breakdown |
| 6 | Tourist | Pays by M-Pesa (simulated); a note on cash and its two confirmations |
| 7 | Tourist | Receipt |
| 8 | Wanjiru, James | Split credited: Wanjiru KSh 500, James KSh 210 (No path: Wanjiru KSh 710) |
| 9 | Wanjiru | Payouts: KSh 500 threshold or the 18:00 sweep; Wanjiru withdraws (simulated) |
| 10 | Coordinator | Reconciliation: collected = credited; Sawa Split keeps nothing |
| 11 | Tourist | Coming next: find a verified site intermediary, one-scan check-in, 5% conservation contribution on top (preview, not built) |

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
