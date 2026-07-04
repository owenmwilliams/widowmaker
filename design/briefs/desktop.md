# Desktop web surface brief — Nexus Moves design language

Read `design/briefs/COMMON.md` first. Branch: `design/web` from latest
`origin/main`. Scope: `movetrack-app/` only. Reference kits:
`design/ui_kits/web_dashboard/index.html` (workspace/dashboard — LIGHT) and
the chat components for the DesktopNexus pane. `marketing/index.html` styles
the public-facing pages. Verify with `npm run build` AND
`npm run check:api-routes` on every commit.

## 1. Token layer (first commit) — you consume the CSS directly
- Vendor `design/styles.css` + `design/tokens/*.css` into the app (import
  once in `main.ts`). `[data-theme="light"]` on `<html>` is the DEFAULT for
  the whole web app; dark-theme correctness matters only where you use
  chat components.
- **Self-host fonts**: replace the Google-CDN import in `tokens/fonts.css`
  with bundled woff2 (Bricolage Grotesque + JetBrains Mono, both OFL). No
  runtime CDN in production.
- Map Quasar's brand variables (`quasar-variables.sass`) to the tokens
  (primary = var accent, etc.) so Quasar components inherit; then remove
  hard-coded hex/px from feature components as you touch them. The 25-file
  `API_BASE_URL` cleanup precedent applies: kill locals, import the source.

## 2. Surface application
- **Workspace / dashboard** (`components/inventory/desktop/**`,
  `views/Items.vue`): per web_dashboard kit — white cards, hairline
  `--border`, soft cool shadows (`--shadow-sm/md`); StatCard tiles for
  Items/Weight/Volume/Fragile; Badge/ItemCard contracts; the Packing Streak
  chart uses `--shimmer-v` fill; Data Quality bars use semantic colors only.
  **Remove every colored left-border accent card** — that pattern is banned.
- **DesktopNexus chat** (`components/nexus/NexusChat.vue`): chat component
  contracts in their light-theme values; assistant bubble = card surface,
  self bubble = solid accent (shimmer self-bubble is allowed on desktop per
  the kit — at most that plus ONE hero CTA per screen); AssistantAvatar
  spec; SuggestionButton; Banner for errors.
- **Public pages** (`MobileGetApp.vue`, `ShareView.vue`, Login): marketing
  kit language — light, `logo-lockup-light.svg`, headlines in Bricolage,
  hero CTA may shimmer; ShareView is mover-facing: calm, honest numbers,
  zero gimmicks.
- Top nav: `logo-lockup-light.svg`; sentence case labels everywhere.
- Icons: adopt Lucide (`lucide-vue-next`) as you touch components; no emoji
  in UI.
- **Do NOT restyle** `views/Mobile*`, `components/inventory/mobile/`,
  `components/settings/mobile/` — they are scheduled for deletion (#71).
  Also leave `experimental/`, `PdfInventoryTest`, and admin lab pages alone.

## 3. Definition of done
COMMON.md §5 plus: vite build + route-drift checker green; a
screenshot-per-page set in the PR; AA contrast on the light theme verified
for text on `--surface`/`--surface-card`; focus rings visible on every
interactive element (Quasar sometimes strips them — restore with
`--focus-ring`).
