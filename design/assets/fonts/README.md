# Bundled brand fonts (SIL Open Font License 1.1)

Self-hosted per DEV_HANDOFF_PROMPT §4/§8.3 — no runtime CDN in production.
Fetched from Google Fonts (latin subsets for web; hinted TTFs for native).

| File | Use |
| --- | --- |
| `JetBrainsMono-{Regular,Medium,Bold}.ttf` | **iOS**: add to bundle + `UIAppFonts` in `widowmaker-Info.plist` (PostScript names `JetBrainsMono-Regular` etc.). **Android**: copy to `res/font/` (lowercase names) + `FontFamily`. |
| `JetBrainsMono-{400,500,700}.latin.woff2` | **Web**: `@font-face` in the vendored `tokens/fonts.css` replacement. |
| `BricolageGrotesque-{400,600,800}.latin.woff2` | **Web only** (display font: marketing/headlines/big numbers). |
| `BricolageGrotesque-Variable.ttf` | Native display use IF ever needed (currently skipped per surface briefs). |

Both families are licensed under the SIL Open Font License 1.1
(JetBrains Mono © 2020 The JetBrains Mono Project Authors;
Bricolage Grotesque © 2022 The Bricolage Grotesque Project Authors).
Full license: https://openfontlicense.org — OFL permits bundling and
redistribution with attribution; it does NOT require open-sourcing the app.
