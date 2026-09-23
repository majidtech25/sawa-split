# Sawa Split — UI/UX Design

**Status:** Locked. Full interactive reference (live swatches, type samples, component states) is published separately — see the Design Reference artifact. This file is the text summary Claude Code should read as source of truth for tokens.

## 1. Philosophy

Minimal, fintech-restrained — quiet confidence, not startup energy. Two accent colors with single jobs, one radius, one spacing grid, no gradients, no stock imagery, no icon without a text label. Tourism theme comes through in what colors already mean (green = landscape + success, terracotta = soil + error, ochre = sand/spice + the one CTA), not through illustration.

## 2. Design tokens

```css
--sawa-bg: #FAFAF8;
--sawa-surface: #FFFFFF;
--sawa-text: #1A1A1A;
--sawa-text-muted: #6B6B63;
--sawa-border: #E4E2DA;
--sawa-green: #1E5B3A;      /* confirmed payments, maker's share, primary links */
--sawa-terracotta: #8C1D1D; /* errors only */
--sawa-ochre: #B97A22;      /* the "Pay" button — nowhere else */
--sawa-radius: 8px;         /* one value, everywhere a corner rounds */
--sawa-space: 8px;          /* multiples: 8/16/24/32 */
```

Dark mode tokens (deferred past the pitch, defined for a trivial future flip):
`bg #141310` · `text #F2F0EA` · `border #2B2A24` · `green #4CA377` · `terracotta #CB6B5E` · `ochre #D89A44`.

## 3. Typography

- UI text: **Inter** (or IBM Plex Sans) — headings, labels, body.
- Numbers only: **IBM Plex Mono** — amounts, transaction IDs, the QR reference. Tabular-nums wherever digits line up.
- Type scale: transaction amount 32–40px bold mono · H1 24px semibold · H2 18px semibold · body 15–16px regular · meta/timestamps 13px regular, muted.

## 4. Layout rules

- Mobile-first, single column, card-centered, max content width ~420px — even on desktop, the payment flow never stretches wider.
- Exception: the coordinator ledger/dashboard is the one screen allowed to use full width past 768px, as a plain table (not a chart-heavy dashboard).
- 8px spacing grid throughout. One corner radius (8px) on every card, button, input, and the QR frame.
- Shadow is a signal, not decoration: flat at rest, a subtle `shadow-active` only on the live "payment in progress" card.

## 5. Components

- **Buttons:** filled primary (ochre, "Pay" only) with a darken-on-active state, 40% opacity when disabled; outline secondary (green border/text) for everything else.
- **Inputs:** 1px border at rest, 2px green border on focus (doubles as the accessible focus ring), 1px terracotta border + inline message on error.
- **Status:** exactly three states — pending (grey pulsing dot), confirmed (green checkmark), failed (terracotta triangle) — never more.
- **Icons:** simple line icons (Lucide/Feather style), always paired with a text label, never alone.

## 6. Screens (map to `APP_FLOW.md`)

1. Price-transparency card (public, pre-payment) — one card per active component (product, photo consent), never a merged list; total sums only what's switched on
2. Payment confirmation screen (public, post-payment)
3. Producer/Driver login (phone + PIN)
4. Producer/Driver dashboard (balance, history, Withdraw button)
5. Coordinator login
6. Coordinator registration screen (new Producer/Driver + QR generation + per-producer "charges for" toggle: product, photo consent, or both)
7. Coordinator reconciliation view (full-width table)
8. Coordinator dispute-flagging screen

## 7. The one cultural motif

A circular "stamp" mark — thin double-ring, green, mono text inside ("VERIFIED · amount · timestamp") — used *only* on confirmed transactions. A restrained nod to a passport/entry stamp; the only place the tourism theme becomes a literal shape rather than a color choice.

## 8. What to avoid (do not reintroduce)

Gradients, glassmorphism/blur, safari-animal or kitenge-pattern decoration, stock tourist photography, confetti/celebration effects on payment success, a fourth accent color, icons without labels, exclamation marks in UI copy.

## 9. Accessibility

WCAG AA contrast minimum (push toward AAA where possible — this app is used outdoors, in direct sunlight). Visible 2px green focus ring on every interactive element, never removed, never the browser default blue.
