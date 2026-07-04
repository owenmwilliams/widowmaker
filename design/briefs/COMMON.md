# Design-system rollout — rules common to every surface

Read `design/DEV_HANDOFF_PROMPT.md` in full first, then `design/readme.md`,
then your surface brief. The design source lives in `design/` and is the only
authority. Coordination and token governance run through the main dev thread.

## Ground rules (enforced at review)
1. **Presentation only.** No behavior, flow, API, or state-machine changes.
   A TestFlight beta and a golden-set evaluation are running: capture and
   upload parameters (video preset/quality, JPEG compression) are FROZEN, and
   `movetrack-api/` + `db/` are untouchable from design branches.
2. **Tokens only.** `design/tokens/tokens.json` is canonical. Your platform
   theme layer is the ONE place token values are transcribed; feature code
   consumes semantic aliases (`accent`, `surfaceCard`, `textPrimary`, …),
   never raw ramps, never literals. If a value seems missing, ask the main
   thread — do not invent or fork one.
3. **Component contracts.** Match `design/components/**/*.d.ts` prop names,
   variants, and defaults. `*.jsx` shows intent; `*.prompt.md` has usage
   rules; the `ui_kits/` page for your surface is the layout reference.
   Where kits and component files differ, component files win.
4. **Restraint list (hard fails):** no new hues; shimmer is NOT a generic
   button style (one shimmer CTA per screen, plus assistant avatar and
   readiness progress fill only); beacon `#F98D5B` only for arrival/streak
   moments; no emoji in product UI; no colored left-border accent cards; no
   decorative stats or filler.
5. **Definition of done** per DEV_HANDOFF §6: interaction states (press ~0.97
   scale, visible focus ring, disabled 45%), AA contrast in BOTH themes,
   labels on icon-only controls, reduced-motion respected (shimmer sweep and
   beacon pulse disabled when the OS asks), font scaling honored (UI body
   ≥15, chat body 17, mobile titles 22+).

## Process
- Work in your own worktree on the branch named in your brief, cut from
  latest `origin/main` (the `design/` directory is already on main).
- Small, reviewable commits — theme layer first, then component-by-component,
  then screens. Keep existing tests/builds green at every commit.
- One DRAFT PR per surface. The main thread reviews as arbiter; the repo
  owner decides merges. Never push to main; never touch another surface's
  directory.
- Before/after screenshots (or the closest your environment allows) in the PR
  description for every screen you restyle.
