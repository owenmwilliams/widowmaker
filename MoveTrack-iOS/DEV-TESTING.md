# iOS — developing & testing through Xcode

The app (`MoveTrack-iOS/widowmaker/widowmaker.xcodeproj`) is **fully native**
SwiftUI. You log in with a 6-digit email code, then land in a native chat with
the **Nexus** agent: describe your home, add room photos/videos, and share a
mover-ready inventory. There is **no web view** and there are no dashboards —
the agent is the whole app.

## TL;DR

1. Build & run on the **Simulator** (Xcode ▶). DEBUG already points at
   **production**, so no local server is needed and real emails send.
2. Enter your email → **"Email me a code"**. You'll get a 6-digit code by email.
3. Type the code → **"Log In"**. You're dropped straight into the Nexus chat.

That's it — no `simctl openurl`, no deep links. The OTP flow works identically
on the Simulator and a real device.

## Configuration

`MoveTrack/Utils/Constants.swift` controls where the app points. DEBUG defaults
to prod; switch to a local backend by toggling the commented line:

| Mode | `apiBaseURL` | When |
|---|---|---|
| **Prod test** (default) | `https://movetrack-api-…run.app` | Just test the iOS app against live |
| **Local dev** | `http://127.0.0.1:3050` | Changing the backend alongside iOS |

ATS already allows insecure `localhost` loads (`widowmaker-Info.plist`), so local
HTTP works on the Simulator without extra config.

## Local backend setup (only for "Local dev" mode)

```sh
# API on :3050
cd movetrack-api && npm install && npm start
```

In local mode there are usually **no email credentials**, so the backend logs
the 6-digit code to the API console instead of emailing it. Copy it from there
and type it into the app.

## Real device (vs Simulator)

- **Prod mode** works on a real device as-is (it talks to the live API).
- **Local mode on a device**: `127.0.0.1` is the *phone*, not your Mac. Use your
  Mac's LAN IP in `Constants.swift` (e.g. `http://192.168.1.20:3050`), put both on
  the same network, and add that host to the ATS exception domains — or just use
  the prod build for device testing.
- **Camera / room-video capture requires a real device** — the Simulator has no
  camera. On the Simulator, use **Choose from Library** (drag a photo/video into
  the Simulator first to populate Photos).

## Adding files

The Xcode project uses a synchronized file group, so any `.swift` file added
under `MoveTrack/` is picked up automatically — no manual "Add Files to…" step.
