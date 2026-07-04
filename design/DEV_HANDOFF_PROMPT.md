# Nexus Moves — Design System Implementation Brief (for the Lead Developer Agent)

You are the lead developer agent responsible for coordinating the implementation of the **Nexus Moves design system** across our surfaces. Your job is to turn the design-system repository into working, consistent, production code on every platform, and to keep our dev teams aligned to it. Read this brief in full before assigning any work. Everything you need is in the design-system project; explicit locations are below.

---

## 1. Mission & principles

Nexus Moves is an agentic moving assistant. The brand's job is to make a stressful move feel **calm, guided, and "almost home."** Two personality poles drive every decision: **warm & human** + **smart & capable (AI-forward)**.

Non-negotiable principles — enforce these in review:

1. **Tokens are the single source of truth.** No hard-coded hex, font, radius, spacing, or shadow values in feature code — ever. Everything resolves to a token.
2. **One action color** (Nexus Blue), **one signature** (the shimmer, reserved for intelligence/hero moments), **one warm accent** (the beacon). Do not introduce new colors.
3. **Semantic aliases, not raw ramps, in UI code.** Components consume `--accent`, `--surface-card`, `--text-primary`, etc. — not `--blue-500` directly. This is what makes theming work.
4. **Dark-first, with a real light theme.** The app is dark; the dashboard and marketing are light. Both must be correct.
5. **Restraint.** No gradient soup, no emoji in product UI, no decorative stats/icons, one shimmer CTA per screen, one illustration scene per page.

---

## 2. Where the source materials live

All paths are relative to the design-system project root.

**Start here (read in this order):**
1. `readme.md` — the full brand guide: voice, visual foundations, iconography, index. This is the canonical narrative.
2. `SKILL.md` — the quick-reference summary.
3. `styles.css` — the entry point. It only `@import`s the token files. **This is the file consumers link.**

**Design tokens — the source of truth (`tokens/`):**
- `tokens/colors.css` — base ramps (blue, navy, cyan, beacon, semantic hues), dark + light neutrals, and the **semantic aliases** (`--accent`, `--surface`, `--text-primary`, `--bubble-self`, …). Light theme overrides live under `[data-theme="light"]`.
- `tokens/typography.css` — font families, weights, the type scale (`--fs-*`), line heights, tracking.
- `tokens/fonts.css` — the Google Fonts import (Bricolage Grotesque, JetBrains Mono).
- `tokens/spacing.css` — 4px spacing scale (`--sp-*`), radii (`--r-*`), layout maxes, focus ring, min tap target.
- `tokens/effects.css` — shadows (light + dark), glows, **the shimmer gradients** (`--shimmer`, `--shimmer-v`, `--aurora`), motion easings/durations, and the `@keyframes` (`nx-shimmer-sweep`, `nx-beacon-pulse`).

**Brand assets (`assets/`):**
- `logo-mark.svg` (white mark, on color), `logo-mark-blue.svg` (on light), `app-icon.svg` (squircle), `logo-lockup-light.svg`, `logo-lockup-dark.svg`, `hero-inventory.svg` (the illustration).
- Ship these as-is. Do not recolor or redraw. Generate raster/PDF/PNG exports from these SVGs for native app icons and stores.

**Component library (`components/`)** — the canonical component API. Grouped: `core/` (Button, IconButton, Badge, Chip), `forms/` (Input, ChecklistItem), `feedback/` (Banner, ProgressBar, StatusPill), `data/` (StatCard, ItemCard), `chat/` (ChatBubble, SuggestionButton, AssistantAvatar), `surfaces/` (Card, Sheet). Each component has three files you must read:
- `Name.jsx` — reference implementation (React, inline styles reading CSS vars).
- `Name.d.ts` — **the prop contract.** Match these prop names, types, variants, and defaults on every platform.
- `Name.prompt.md` — usage rules and correct examples.
- (`*.card.html` files are gallery specimens for the design-system viewer — not app code.)

**UI kits (`ui_kits/`)** — full-surface composition references (layout, hierarchy, spacing, behavior):
- `mobile_app/index.html` — the dark iOS/Android chat + share sheet.
- `web_dashboard/index.html` — the light owner/mover dashboard.
- `marketing/index.html` — the light landing page (hero illustration + item cards).
- `slides/` — deck templates (`title`, `section`, `content`, `stat`).

> **Important:** the UI kits sometimes inline simplified copies of components for standalone preview. Treat the kits as **layout & behavior reference**, and `components/**/*.{jsx,d.ts,prompt.md}` as the **API source of truth**. Where they differ, the component files win.

**Guidelines specimens (`guidelines/`)** — visual references for colors, type, spacing, elevation, logo, shimmer-in-use, voice, and illustration style. Use these to sanity-check your output against intent.

---

## 3. Token pipeline — do this first, before any component work

The tokens are authored in CSS. Web can consume them directly; native cannot. **Step 1 of the whole program is to establish a single machine-readable token source and a generator**, so all three platforms derive from the same numbers.

1. **Create `tokens/tokens.json`** as the canonical, platform-neutral token set, transcribed exactly from the `tokens/*.css` files (same names, same values, dark + light). This becomes the build input.
2. **Adopt a token generator** (e.g. Style Dictionary or equivalent) that emits:
   - **Web:** the existing CSS custom properties (keep `styles.css` as the shipped artifact; verify it matches `tokens.json`).
   - **iOS:** a Swift file of semantic tokens (Color/Font/spacing constants), with dark/light via asset catalogs or a theme resolver.
   - **Android:** Compose `Color`/`Typography`/`Shape`/`Dp` definitions (or XML resources), with dark/light theme resources.
3. **Expose semantic aliases as the public API on every platform** (e.g. `NexusColor.accent`, `NexusColor.surfaceCard`, `NexusColor.textPrimary`). Feature engineers use aliases; only the theme layer references raw ramps.
4. **Theming:** dark is the default. Light is `[data-theme="light"]` on web; on native it is the light theme resolver. Every semantic alias must have both values.
5. Any token change happens in `tokens.json` → regenerate → all platforms update. Never edit generated files by hand.

**Key values to verify carry through (spot-check these):**
- Action color **Nexus Blue** `--blue-500 = #4F5BF0`; use via `--accent`.
- **Shimmer** `--shimmer = linear-gradient(115deg, #3B6FE0 → #2F8FE0 → #34C8E0)`. Native: implement as a gradient fill; add the looping highlight (`nx-shimmer-sweep`) only where specified.
- **Beacon** (the one warm color) `--beacon-500 = #F98D5B`.
- **Navy ink** `--navy-700 = #152A5E` (headings/wordmark on light; `--text-primary` in light theme is `#16204A`).
- Spacing = 4px grid; radii: buttons/inputs 14, cards 18, chat bubbles/panels 22, sheets/app-icon 28, pills 999.

---

## 4. Typography & icons

**Type** (`tokens/typography.css`):
- **Display font — Bricolage Grotesque** — marketing, headlines, deck, big numbers only. Bundle the font with apps; don't rely on the CDN in production.
- **UI font — system stack** — SF Pro on iOS, Roboto on Android, system on web. All product UI text. Cheapest and native-feeling; do not override with a webfont in-app.
- **Mono — JetBrains Mono** — eyebrows (uppercase, letter-spaced), data readouts (weights/volumes), technical labels.
- Respect the scale and the floors: **UI body never below 15px; chat body 17px; mobile titles 22px+.** Honor OS Dynamic Type / font-scaling — map our scale to scalable text styles, don't hard-lock px on native.

**Icons:** standardize on **Lucide** (line, 2px stroke, rounded caps). No emoji in production UI. No hand-drawn one-off icons. The assistant avatar (sparkles on shimmer) is the single filled brand mark — see `components/chat/AssistantAvatar.jsx`. The beacon dot is a brand element, not an icon.

---

## 5. How to incorporate onto each surface

Build the shared token layer + component library first, then compose surfaces. For each surface, the layout/behavior reference is the named UI kit; the components are from `components/`.

### A. Mobile app (iOS + Android) — dark-first
Reference: `ui_kits/mobile_app/index.html`. This is the core product.
- **Theme:** dark by default; wire the light theme but the app ships dark.
- **Components used:** `AssistantAvatar`, `ChatBubble` (assistant = card surface; self = solid `--accent`, or shimmer on desktop), `SuggestionButton` (full-width `block` variant), `ProgressBar` (shimmer fill, in the header readiness card), `Banner` (the cream/amber "honest nudge"), `Sheet` (the "Get ready to share" bottom sheet), `ChecklistItem` ("Next steps"), `Input` (`composer` variant), `IconButton`, `StatusPill`, `Badge`, `ItemCard` (captured items).
- **Rules:** minimum 44px tap targets; the shimmer appears on the assistant avatar, the readiness progress fill, and at most one hero CTA (e.g. "Share inventory") — not on every button. Beacon is reserved for arrival/streak moments. Follow the voice guide: first-person, uses the customer's name, concrete honest numbers, sentence case.

### B. Web dashboard (owner + mover-facing) — light
Reference: `ui_kits/web_dashboard/index.html`.
- **Theme:** light (`[data-theme="light"]`).
- **Components used:** top nav with `logo-lockup-light.svg`, `Button` (primary + secondary), `StatCard` (metric tiles — Items, Weight, Volume, Fragile…), `Card` (panels), `Badge`, `ItemCard`, the shimmer-fill **Packing Streak** chart (`--shimmer-v`), and the Data Quality Watchlist (semantic bar colors).
- **Rules:** white cards, hairline `--border`, soft cool shadows (`--shadow-sm/md`) — never colored left-border accents. Data bars use the vertical shimmer or semantic colors only.

### C. Marketing / landing — light, expressive
Reference: `ui_kits/marketing/index.html`.
- **Theme:** light hero; the bottom CTA is a dark aurora (`--navy-800` + `--aurora`) for contrast.
- **Assets:** `logo-lockup-light.svg` in the nav/footer; `hero-inventory.svg` as the hero, with floating `ItemCard`s (Box 44 lb, Lamp 7 lb, Chair 15 lb).
- **Rules:** headlines in Bricolage Grotesque; shimmer only on hero CTAs; one illustration scene. This surface may be a separate marketing codebase — still consume the same tokens (ship `styles.css`).

### D. Slides / deck template
Reference: `ui_kits/slides/*.html`. Aurora title, numbered section divider, content+visual, big shimmer-gradient stat. For internal/investor decks; same tokens and fonts.

---

## 6. Component build order & definition of done

**Build order:** token layer → `core/` → `surfaces/` → `forms/` → `feedback/` → `data/` → `chat/` → assemble surfaces.

A component is **done** when:
- Prop names/types/variants/defaults match its `.d.ts` exactly (parity across platforms).
- It reads only semantic tokens (no literals); dark + light both correct.
- Interaction states implemented per `readme.md` → "Interaction states": hover (web) deepens one step / adds quiet fill; press scales ~0.97; focus shows the 3px `--focus-ring` (never removed); disabled at 45% opacity.
- Motion uses `--ease-standard` (overshoot `--ease-emphasis` only for arrivals/confirmations) and the standard durations; the shimmer sweep and beacon pulse only where specified.
- Accessible: AA contrast, focus order, labels on icon-only controls (`IconButton` requires `aria-label`/`contentDescription`), respects reduced-motion (disable the sweep/pulse when the user opts out), and honors font scaling.
- Matches its `guidelines/` specimen and the relevant UI kit.

---

## 7. Governance — keep the system coherent

- **Adding/changing a token:** edit `tokens/tokens.json`, regenerate, PR with a rationale. Never fork values into feature code.
- **New component:** it must have a real prop contract and appear ≥3× or have genuine state before it becomes shared. Author `.d.ts` + usage notes; add a specimen. Otherwise compose from existing primitives.
- **Do NOT:** introduce a new hue; use the shimmer as a generic button style; put two shimmer CTAs on one screen; use the beacon for body UI; add emoji to product UI; hard-code hex/px; use colored left-border accent cards; add filler content or decorative stats.
- **Versioning:** semver the token package and the component library; changelog every token change; pin app consumers to a version.

---

## 8. Resolve these before kickoff (raise with the design owner)

1. **Native strategy:** fully native (SwiftUI + Jetpack Compose) or cross-platform (React Native / Flutter)? This decides how components are authored and how the token generator targets platforms.
2. **Icon set:** confirm Lucide, or supply the production icon set to standardize on.
3. **Fonts:** licensing/bundling plan for Bricolage Grotesque in apps (self-host; no runtime CDN).
4. **Exact shimmer values:** these are reconstructed from screenshots. If the desktop app's real gradient stops matter, get the source repo and reconcile `tokens/effects.css`.
5. **Analytics/telemetry, localization, and RTL** expectations for components (affects API surface).

---

### TL;DR for the teams
Link `styles.css` (web) or the generated token package (native). Consume **semantic tokens only**. Build components to their `.d.ts` contracts. Compose surfaces per the matching `ui_kits/` reference. Dark-first; light theme real. Shimmer = AI/hero only; beacon = one warm spark; no new colors, no emoji, no hard-coded values.
