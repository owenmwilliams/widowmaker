# Nexus Moves — Design System

**Nexus Moves** is an agentic moving-support product. An LLM assistant ("Nexus") walks a customer through cataloging their home room-by-room via chat, photos and video, then produces a clean, weight- and volume-estimated inventory that can be **shared with moving companies** for accurate quotes. Moving is stressful; the product's job is to make someone feel *calm, guided, and almost home*.

This design system consolidates three previously-divergent looks into **one brand**:

- **Mobile app (iOS/Android)** — dark, periwinkle-indigo, big soft chat bubbles.
- **Desktop chat** — dark, with a signature **blue→cyan "shimmer"** on the user's own messages and AI moments.
- **Desktop dashboard** — light, navy wordmark, shimmer-gradient data bars, teal/blue duotone icons.

The unifying decisions: a single **Nexus Blue** action color, the **shimmer** as the signature "intelligence" gradient, the logo's dot promoted to a single warm **"beacon"** accent (a calm coral-orange, used sparingly), and one type + spacing + radius system across every surface.

---

## Brand personality

**Warm & human + smart & capable (AI-forward).** Nexus is a knowledgeable friend who happens to be great at logistics — never a cold enterprise tool, never a gimmicky chatbot. Calm confidence over hype. The visual warmth (beacon orange, generous radii, soft bubbles) balances the intelligence signal (the cool shimmer, precise data).

---

## Sources given

- Screenshots: mobile app (chat, share sheet), desktop chat, desktop dashboard.
- Starter app icon (`AppLogo.png`) — blue N-route with an orange dot; refined here, concept kept.
- **No codebase or Figma was attached.** The "shimmer" and component values are inferred from the screenshots. If exact gradient stops / paddings matter, attach the repo and this system will be re-matched precisely. Component numeric values here are best-fit reconstructions, not extracted source truth.

---

## CONTENT FUNDAMENTALS — how Nexus writes

Voice is **first-person, warm, and specific**. The assistant refers to itself as "I"/"we" and addresses the user by name.

- **Person:** "I checked for duplicates…", "we still need photos of these large items", and it uses the customer's first name ("What else should we add to the Hallway, **Owen**?").
- **Tone:** encouraging and low-pressure. Celebrates progress ("Nice, the framed artwork is added!", "You're doing great with the inventory!") and frames gaps as gentle suggestions, never failures ("worth a second pass before sharing").
- **Casing:** sentence case everywhere in UI and chat. Room and feature names are Title Case ("Hallway", "Storage", "Get a Move Estimate", "Share inventory").
- **Numbers are concrete and honest.** "Added 8 of the 10 items from the scan.", "13 items across 9 rooms. 43 lbs, ~6 cu ft." Use `~` for estimates. Always pair a number with what it means.
- **Guidance is actionable.** Every nudge names the next step: "Catalog items in empty rooms: Bedroom 3, Bedroom 2, Living Room."
- **Emoji:** the current chat uses a few (📸 🎥) in suggestion chips. **Going forward, replace emoji with line icons** for a more premium, consistent feel (see Iconography). Keep the warmth in the *words*, not emoji.
- **Buttons/CTAs:** verb-first and plainspoken — "Share inventory", "Estimate weights", "Add a room", "Catalog Storage", "Get a Move Estimate".
- **Status messages:** short, past-tense confirmations — "Items reviewed · 8 added".

**Micro-copy examples**
- Empty state: "Building your inventory" · progress "0%"
- Ready state: "Ready to share" · "94%"
- Warning (honest, kind): "Only ~43 lbs logged for a 3-bedroom home, which usually totals around 8,000 lbs. You've likely missed rooms or items — worth a second pass before sharing."
- Success: "Every room has a walkthrough and the big items are photographed."

---

## VISUAL FOUNDATIONS

**Color.** One primary — **Nexus Blue** (`--blue-500 #4F5BF0`), a calm confident indigo-blue that bridges the mobile periwinkle and desktop navy. **Deep Navy** (`--navy-700 #152A5E`) is the ink for headings/wordmark on light. The **shimmer** (`--shimmer`, blue→cyan) is the signature and appears only on intelligence/hero moments — not on every button. The **beacon** (`--beacon-500 #F98D5B`, a calm warm coral-orange) is the one warm spark: streaks, arrival/"almost home" moments, the logo dot, the illustration rug — never body UI. It is the single warm color in the system. Semantics: green success, amber warning (on a cream card in light / deep-amber surface in dark), red danger.

**Themes.** Dark-first (the app), full light theme (the dashboard/marketing). Dark neutrals are warm-cool near-blacks (`#0B0B0F` canvas → `#26262C` cards); light neutrals are cool whites (`#F4F6FB` canvas → `#FFFFFF` cards) with navy ink.

**Type.** *Bricolage Grotesque* for display/marketing/deck headlines (warm character + modern intelligence). System stack for all product UI (SF Pro on iOS, Roboto on Android, system on web) — cheapest for devs and native-feeling. *JetBrains Mono* for eyebrows, data labels, and technical readouts. Display tracks tight (−0.02em); body is neutral. UI body floor is 15px; chat body is 17px; mobile titles 22px+.

**Spacing & layout.** 4px grid. Mobile column caps at 430px; web content at 1240px with a 20px gutter. Generous vertical rhythm — the brand breathes.

**Radii.** Soft and friendly. Chat bubbles & panels 22px, cards 18px, buttons/inputs 14px, sheets & app-icon squircle 28px, chips/pills fully rounded. Never sharp corners.

**Cards.** Light: white fill, `--shadow-sm`/`md`, 1px `--border` hairline, 18px radius, no colored left-border accents. Dark: `#26262C` fill, hairline `--d-line`, subtle lift shadow or none. Assistant chat bubble = a card; user bubble = solid `--blue-500` (mobile) or `--shimmer` (desktop).

**Backgrounds.** Mostly flat solids. The one expressive backdrop is the **aurora** wash (`--aurora`, faint cyan + blue radial glows) reserved for hero/marketing and the app header behind the assistant. No busy patterns, no stock-photo hero clutter. Imagery, when present, is the user's own room photos — warm, real, cool-neutral grade.

**Elevation.** Light theme uses soft cool-tinted shadows. Dark theme mostly uses *glow* (accent/beacon/shimmer) and faint lifts rather than heavy drop shadows.

**Motion.** Calm and reassuring. Standard ease `cubic-bezier(.22,.61,.36,1)`; a gentle overshoot (`--ease-emphasis`) for arrivals/confirmations only. Durations 120/220/380ms. Two signature loops: the **shimmer sweep** (a highlight traveling across shimmer surfaces while "Nexus is working") and the **beacon pulse** (slow heartbeat on the destination dot). No bounce-heavy or flashy animation.

**Interaction states.**
- *Hover* (web): buttons deepen one accent step (`--accent-hover`); ghost/quiet controls gain a faint `--accent-quiet` fill; cards lift by one shadow step.
- *Press* (all): scale 0.97 + slight darken. Tactile, quick (120ms).
- *Focus:* 3px `--focus-ring` (accent at 45%). Never remove focus outlines.
- *Disabled:* 45% opacity, no shadow, no pointer.

**Transparency & blur.** Sparing. iOS status/header areas and sheets use a subtle backdrop blur over the aurora. Quiet accent fills use `color-mix` alpha tints, not new opaque colors.

---

## ICONOGRAPHY

The current product **mixes** three icon vocabularies — iOS SF Symbols (share, plus, paper-plane, checkmark, ellipsis), duotone filled dashboard glyphs (box, folder, map-pin, weight, cube, warning), and a few **emoji** in chat chips (📸 🎥). This is exactly the inconsistency to consolidate.

**Standard going forward: [Lucide](https://lucide.dev)** — clean, rounded, consistent 2px stroke that matches the brand's soft, calm geometry. Loaded via CDN. This is a **substitution/standardization** (the source had no single icon set); swap to your production icon set if you have one, but keep one system across mobile + web.

- **Style:** line icons, 2px stroke, round caps/joins, 24px default (20px dense, 28px feature). Match text color; accent only for interactive/emphasis.
- **The assistant avatar** is the one filled mark: a `sparkles` glyph on a **shimmer** rounded-square (mobile) or shimmer circle (desktop).
- **No emoji in production UI.** Warmth lives in copy and the beacon, not emoji.
- **The beacon** (the one warm coral-orange — logo dot, streaks, arrival moments, the illustration rug) is a brand element, not an icon — reserve it. It is the *only* warm color in the system.
- Common glyphs: `sparkles` (Nexus), `share`/`upload`, `plus`, `send`, `pencil`/`edit-3`, `check`/`check-circle`, `circle` (unchecked step), `alert-triangle` (warning), `package`/`box`, `folder`, `map-pin`, `scale` (weight), `box`/`cube` (volume), `chevron-right`, `more-horizontal`.

CDN: `https://unpkg.com/lucide@latest` (or `lucide-static` SVGs). Do not hand-draw icons.

---

## INDEX / MANIFEST

**Root**
- `styles.css` — the single entry point consumers link (`@import`s all tokens + fonts).
- `readme.md` — this guide.
- `SKILL.md` — Agent-Skill wrapper for use in Claude Code.

**`tokens/`** — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `effects.css` (shadows, shimmer, motion).

**`assets/`** — `logo-mark.svg` (white, on color), `logo-mark-blue.svg` (on light), `app-icon.svg` (squircle), `logo-lockup-light.svg`, `logo-lockup-dark.svg`.

**`guidelines/`** — foundation specimen cards (Colors, Type, Spacing, Brand) shown in the Design System tab.

**`components/`** — reusable React primitives, grouped: `core/` (Button, IconButton, Badge, Chip), `forms/` (Input, Checklist), `feedback/` (Banner, ProgressBar, StatusPill), `data/` (StatCard), `chat/` (ChatBubble, SuggestionButton, AssistantAvatar), `surfaces/` (Card, Sheet).

**`ui_kits/`** — full-screen recreations:
- `mobile_app/` — iOS dark chat + "Get ready to share" sheet.
- `web_dashboard/` — light inventory dashboard.
- `marketing/` — landing page.
- `slides/` — deck template samples.
