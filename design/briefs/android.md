# Android surface brief — Nexus Moves design language

Read `design/briefs/COMMON.md` first. Branch: `claude/android-design` from
latest `origin/main`. Scope: `MoveTrack-Android/` only. Reference kit:
`design/ui_kits/mobile_app/index.html`. Your advantage: CI compiles you —
`assembleDebug` must be green on every commit.

**Sequencing:** if the parity follow-ups (tappable Next Steps, updatedCount
wording, picker cap, launcher icon — see issue #72 and the #74 review
comment) are not yet merged, land those in their own small PR FIRST, then
start this restyle on top. Do not mix parity fixes and restyle in one PR.

## 1. Theme layer (first commit)
Rebuild `ui/theme/Theme.kt` as the generated layer over
`design/tokens/tokens.json`:
- Material3 `darkColorScheme` as DEFAULT + a correct `lightColorScheme`:
  primary/`accent` #4F5BF0, surface/surfaceCard/background, on-colors from
  `textPrimary`/`textSecondary`, outline from `border`, error from semantic
  danger, plus non-M3 extension tokens (beacon #F98D5B, bubbleSelf, warn
  cream) via a `NexusColors` CompositionLocal. Names 1:1 with tokens.json.
- **Shimmer**: `Brush.linearGradient` (#3B6FE0 → #2F8FE0 → #34C8E0, 115°).
  ONLY: assistant avatar, readiness progress fill, one hero CTA (Share
  inventory). Sweep animation optional and off when animator scale is 0 /
  reduced motion.
- **Shapes**: 14 (buttons/inputs), 18 (cards), 22 (bubbles/panels),
  28 (sheets), pill. **Tap targets ≥48dp** (platform floor; design min 44).
- **Type**: Roboto/system for all UI, sp-based (respect font scale; body
  ≥15sp, chat 17sp, titles 22sp+); bundle JetBrains Mono (OFL) for data
  readouts/eyebrows; skip Bricolage in v1 (system bold for display moments).

## 2. Screen-by-screen (match the .d.ts contracts)
- `ChatScreen`: assistant bubble = surfaceCard r22, self = solid accent;
  SuggestionButton block chips; ProgressBar (shimmer) for uploads; Banner
  for errors; StatusPill for scan pills; composer per Input `composer`
  variant + IconButton with contentDescription.
- `ReadinessSheet`: ModalBottomSheet r28, ChecklistItem rows (keep/port the
  tap-to-send behavior), shimmer progress, Banner warning, single shimmer
  Share CTA.
- `ReviewSheet`/`DuplicateSheet`: Sheet + ItemCard/ChecklistItem; commit
  button solid accent, not shimmer.
- `LoginScreen`/`SplashScreen`: `design/assets/` logo (mark on dark), dark
  surfaces; behavior untouched (401-only logout stays sacred).
- AssistantAvatar per its component spec — the only filled brand mark.
- Icons: Material Symbols OUTLINED (closest to Lucide line style) in v1;
  no emoji in UI (audit labels/placeholders).
- Launcher icon: adaptive icon from `design/assets/app-icon.svg` (SVG →
  vector drawable is feasible in-code; do it if clean, else flag).

## 3. Definition of done
COMMON.md §5 plus: both themes screenshot-tested on the emulator if your
environment allows; TalkBack labels on all icon-only controls; assembleDebug
green.
