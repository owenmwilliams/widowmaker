# Nexus Moves — Android

A 1:1 Kotlin/Jetpack Compose port of the iOS app (`MoveTrack-iOS/`), against
the exact same `movetrack-api` contract. **This is scaffolding** — screens and
repositories are stubs with `TODO(android-port)` markers; the porting
checklist, definition of done, and Play Store notes live in the
"Android app: populate the scaffold to iOS parity" GitHub issue.

- `MoveTrack-iOS/widowmaker/MoveTrack/` is the source of truth for behavior:
  port `NexusService.swift`/`NexusModels.swift` (wire contract),
  `NexusViewModel.swift` (flows), and the Views one-to-one.
- Build: `./gradlew :app:assembleDebug` (Android SDK 35). No gradle wrapper is
  committed yet — generate with `gradle wrapper --gradle-version 8.11.1` on
  first local setup, and add an `assembleDebug` CI job in the same change.
- Package: `dev.we3kings.nexusmoves` (chosen clean — do NOT reuse the legacy
  `widowmaker` naming; the Play listing is keyed to this forever).
