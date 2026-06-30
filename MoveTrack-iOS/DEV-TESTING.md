# iOS — developing & testing through Xcode

The native app (`MoveTrack-iOS/widowmaker/widowmaker.xcodeproj`) does magic-link
login, then embeds the web agent flow (onboarding → room-video capture → sharing)
in a `WKWebView`. This guide gets a working login + test loop in Xcode.

## TL;DR

1. Build & run on the **Simulator** (Xcode ▶). DEBUG already points at **production**, so no local server is needed and real magic-link emails send.
2. Enter your email → "Send code". You'll get an email with a link like
   `https://…/login?token=ABC123`.
3. Copy the **token** (the `token=` value) and complete login by feeding it to the app:
   ```sh
   xcrun simctl openurl booted "movetrack://login?token=ABC123"
   ```
4. The app verifies the token and drops you into the embedded agent flow.

> Why step 3? Magic-link emails contain a **web** URL, but the app listens for the
> `movetrack://login?token=…` custom scheme. Until we add Universal Links or an OTP
> code (see "Production auth" below), `simctl openurl` is the dev bridge. On the
> Simulator it's one command; no email parsing of deep links required.

## Configuration

`MoveTrack/Utils/Constants.swift` controls where the app points. DEBUG defaults to
prod; switch to local by toggling the commented lines:

| Mode | `apiBaseURL` | `webAppBaseURL` | When |
|---|---|---|---|
| **Prod test** (default) | `https://movetrack-api-…run.app` | `https://reloprep.com` | Just test the iOS app against live |
| **Local dev** | `http://127.0.0.1:3050` | `http://localhost:5173` | Changing backend/web alongside iOS |

ATS already allows insecure `localhost` loads (`widowmaker-Info.plist`), so local
HTTP works on the Simulator without extra config.

## Local backend setup (only for "Local dev" mode)

```sh
# API on :3050
cd movetrack-api && npm install && npm start
# Web on :5173 (for the embedded WebView)
cd movetrack-app && npm install && npm run dev
```

In local mode there are usually **no email credentials**, so the backend doesn't
send an email — it **logs the magic link to the API console**:
```
Magic Link: http://localhost:5173/login?token=ABC123
```
Copy that token and run the same `xcrun simctl openurl booted "movetrack://login?token=ABC123"`.

## Real device (vs Simulator)

- **Prod mode**: works on a real device as-is (it talks to the live API).
- **Local mode on a device**: `127.0.0.1` is the *phone*, not your Mac. Use your
  Mac's LAN IP in `Constants.swift` (e.g. `http://192.168.1.20:3050`) and ensure
  both are on the same network. Add that host to the ATS exception domains, or use
  the prod build for device testing.
- `simctl openurl` is Simulator-only. On a device, paste the token via a Universal
  Link or the OTP flow below (the device can't easily receive a `movetrack://` link
  from an email).
- **Camera/room-video capture requires a real device** — the Simulator has no camera.

## Production auth (the proper fix — pick one)

`simctl openurl` is a dev crutch. For a shippable login on device, choose:

- **OTP code** *(recommended for mobile)* — email a 6-digit code instead of a link;
  the user types it in the app; the app verifies it. No deep links, works
  identically on Simulator and device, and is the cleanest mobile UX. Requires a
  small backend addition (issue/verify a numeric code) + a code-entry screen.
- **Universal Links** — host an `apple-app-site-association` file on the web domain,
  add the Associated Domains entitlement, and make the magic link an `https://` URL
  the app intercepts (then inject the token into the WebView). Keeps the existing
  magic-link UX but needs domain + entitlement setup.
