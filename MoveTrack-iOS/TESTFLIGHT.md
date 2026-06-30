# Shipping Nexus Moves to TestFlight

A click‑by‑click for getting the native app onto testers' phones. Do the
**one‑time setup** once; after that each beta build is **Archive → Upload →
testers get it**.

The repo side is already prepped:
- ✅ App icon asset catalog with a **placeholder** 1024 icon (`MoveTrack/Assets.xcassets/AppIcon.appiconset`) — replace it with the real one (see step 2).
- ✅ Privacy manifest (`PrivacyInfo.xcprivacy`) declaring photos/videos → AI use.
- ✅ Export‑compliance key (`ITSAppUsesNonExemptEncryption = false`) so uploads don't prompt about encryption.
- ✅ Automatic signing, bundle id `we3kings.dev.widowmaker`, version `1.0 (1)`.

---

## Prerequisites (one time)

1. **Apple Developer Program membership** for the `we3kings.dev` team — enrolled and active ($99/yr). Check at <https://developer.apple.com/account>.
2. **Xcode signed in** with that Apple ID: Xcode → Settings → Accounts → add the Apple ID → it should list the `we3kings.dev` team.

## One‑time setup

### 1. Create the app record in App Store Connect
1. Go to <https://appstoreconnect.apple.com> → **Apps** → **+** → **New App**.
2. Platform **iOS**; Name **Nexus Moves**; Primary language **English (U.S.)**; Bundle ID **`we3kings.dev.widowmaker`** (pick it from the dropdown — if it's not there, register it first at developer.apple.com → Identifiers); SKU anything (e.g. `nexusmoves`).
3. Create. You don't need to fill in screenshots/pricing for TestFlight — only for public App Store release.

### 2. Drop in the real app icon
The placeholder is a plain indigo box so the first build is uploadable. To replace:
- Make a **1024×1024 PNG, no transparency, no rounded corners** (Apple rounds it).
- In Xcode, open `Assets.xcassets` → **AppIcon** → drag your PNG onto the 1024 "App Store" slot.
  (Or just overwrite `MoveTrack/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` with the same filename.)

### 3. Set the signing team
- Open `MoveTrack-iOS/widowmaker/widowmaker.xcodeproj`.
- Select the **widowmaker** target → **Signing & Capabilities**.
- **Automatically manage signing** ✔, **Team = we3kings.dev**. Xcode creates the provisioning profile for you.

---

## Each beta build

### 1. Bump the build number
Every upload needs a unique build number for the same version.
- Target → **General** → **Identity**, or **Build Settings → `CURRENT_PROJECT_VERSION`**: increment it (1 → 2 → 3…). Keep `MARKETING_VERSION` at `1.0` until you ship a real new version.

### 2. Archive
- Set the run destination to **Any iOS Device (arm64)** (not a simulator — you can't archive for the simulator).
- **Product → Archive**. When it finishes, the **Organizer** opens.

### 3. Upload to App Store Connect
- In Organizer, select the archive → **Distribute App** → **TestFlight & App Store** (or "App Store Connect") → **Upload**.
- Accept the defaults (automatic signing, symbols on). It uploads and you'll get a "Upload Successful."

### 4. Wait for processing, then add testers
- In App Store Connect → your app → **TestFlight** tab. The build shows **"Processing"** for ~5–15 min, then becomes available.
- Export compliance is already answered by the Info.plist key, so it shouldn't ask.
- **Internal testing** (fastest, up to 100 users on your team, no review): create/select an internal group → enable the build → add testers by Apple ID email. They install the **TestFlight** app and accept.
- **External testing** (up to 10,000, needs a one‑time Beta App Review, usually <24h): add an external group, fill in **Test Information** (what to test, contact email), submit for beta review.

### 5. What testers do
- Install **TestFlight** from the App Store → open the invite email / link → install Nexus Moves → log in with the email code.

---

## Test Information to paste (TestFlight "What to Test")

> Nexus Moves builds a moving inventory by talking to an AI assistant. Log in
> with the emailed code, tell Nexus about your home, add a few room photos or a
> walkthrough video, then tap Share to get a mover‑ready inventory link.
> Please report anything confusing, slow, or wrong in the detected items.

---

## Common upload rejections & fixes

| Symptom | Fix |
|---|---|
| "Missing app icon" / invalid icon | Icon must be 1024×1024, **opaque** (no alpha), no rounded corners. The placeholder is valid; a transparent PNG will fail. |
| "Missing compliance" prompt | Already handled by `ITSAppUsesNonExemptEncryption=false`. If it still asks, answer **No** (standard HTTPS only). |
| "Invalid signature" / no profile | Signing & Capabilities → Automatic + correct Team; let Xcode regenerate the profile. |
| Build number already used | Increment `CURRENT_PROJECT_VERSION` and re‑archive. |
| Privacy/data questions at submit | The app collects photos/videos, email, and typed text, sent to AI for app functionality — matches `PrivacyInfo.xcprivacy`. |

## Optional: automate it later
For repeatable command‑line uploads, add **fastlane** (`fastlane pilot upload`) or
use `xcodebuild -exportArchive` with an `ExportOptions.plist`. Not needed for the
first few builds — the Organizer GUI is simplest.
