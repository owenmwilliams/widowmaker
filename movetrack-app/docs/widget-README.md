# Nexus Moves — embeddable "Get a quote" widget

One line of HTML that a moving company pastes into its own website. It renders
a small branded panel (or just a button) that opens the company's Nexus Moves
capture link — `/c/{token}?src=widget` — in a new tab, where the customer films
their home room-by-room and the company gets the quote-ready inventory by
email. (F1, issue #98; capture flow is #96/#97.)

The script is `movetrack-app/public/widget.js`, served as-is from the app
origin (no build step, no dependencies). Live demo: `/widget-demo`.

## Chat variant — the hero embed (#112)

```html
<script src="https://YOUR_APP_ORIGIN/widget.js" data-nexus-token="YOUR_COMPANY_TOKEN" data-variant="chat" async></script>
```

Renders a HERO-sized chat panel (up to 420px wide on desktop, full-width on
phones, starting at 560px tall) that iframes the company's Nexus agent —
`/agent/{token}?src=widget` — directly in-page. The buyer never leaves the
mover's site: the deterministic assistant asks the intake battery, gates the
quote range behind an email, and reserves a move date behind a clearly-marked
SIMULATED deposit (companies with `payments_mode` other than `simulated` get
no card sheet at all). The chat page is MCP client #1 against the per-vendor
agent server (`POST /api/agent/{token}/mcp`, see
`movetrack-api/docs/vendor-agent-mcp.md`) — the same agent any MCP-speaking
AI client can call.

Chat needs no camera, so the new-tab constraint that applies to the capture
variants does not apply here. The iframe posts its content height
(`{ type: 'nexus-agent-height', height }`); the widget listens with an
origin + source check and grows the panel (clamped 560–1400px).

## Embed (card variant, default)

```html
<script src="https://YOUR_APP_ORIGIN/widget.js" data-nexus-token="YOUR_COMPANY_TOKEN" async></script>
```

The widget appears immediately after the script tag. `YOUR_COMPANY_TOKEN` is
the company's capture token — the same one in their `/c/…` link; the admin
mint response (`POST /api/capture/companies`) returns the exact snippet as
`embedSnippet`.

The card shows a headline ("Get an accurate quote", plus "for {Company}" once
the name loads), a one-line explainer, an optional email field that prefills
the capture page, the CTA button, and a "Powered by Nexus Moves" footer.

## Button-only variant

```html
<script src="https://YOUR_APP_ORIGIN/widget.js" data-nexus-token="YOUR_COMPANY_TOKEN" data-variant="button" async></script>
```

Just the CTA button + powered-by line — for navbars, footers, or alongside the
company's own copy.

## No-JavaScript / anchor fallback

For plain-HTML sites, email signatures, or as a `<noscript>` companion — no
script at all, same attribution:

```html
<a href="https://YOUR_APP_ORIGIN/c/YOUR_COMPANY_TOKEN?src=widget" target="_blank" rel="noopener">
  Get an accurate moving quote — film your home with your phone
</a>
```

## Data attributes

| Attribute          | Required | Values                | Default              | Notes |
|--------------------|----------|-----------------------|----------------------|-------|
| `data-nexus-token` | yes      | company capture token | —                    | Without it the widget renders nothing (console warning). |
| `data-variant`     | no       | `card` \| `button` \| `chat` | `card`        | `chat` embeds the vendor agent in-page (iframe); card/button open capture in a new tab. |
| `data-accent`      | no       | any CSS color         | `#4F5BF0` Nexus Blue | CTA background + focus ring, so the button can match the host site's palette. |
| `data-name`        | no       | display name          | (looked up)          | Skips the company-name lookup and shows this name. Used by `/widget-demo`; real embeds normally omit it. |

## Behavior notes

- **Style isolation.** The widget renders into a shadow root: host-page CSS
  can't restyle it, its CSS can't leak out. Browsers without shadow DOM get
  the plain anchor fallback.
- **Zero config URLs.** All links derive from the script's own `src`, so the
  same snippet works against staging and production.
- **Company name lookup.** The widget calls `GET {origin}/api/capture/{token}`
  (that endpoint sends `Access-Control-Allow-Origin: *`; it returns the
  display name and nothing else). A hard 404 — dead/revoked token — collapses
  the widget to the plain anchor fallback; any other failure (network error,
  the app origin answering with the SPA page instead of the API) fails open
  and just renders without the name.
- **Email prefill.** A loosely-valid email typed in the card is passed as
  `?email=` (URL-encoded) and prefills the capture landing form. Invalid input
  is simply dropped — never blocks the click-through.
- **Attribution.** The link carries `?src=widget`; the capture page forwards
  it to `POST /api/capture/:token/start`, which stores it on
  `company_capture_sessions.source` (`widget` | `link` | `email`, anything
  else → NULL). That's how widget-driven sessions are counted.
- **Accessibility.** Real `<button>`, visible focus ring, text ≥14px, AA
  contrast in both variants, no animation beyond hover (and transitions are
  disabled under `prefers-reduced-motion`).
- **Size.** Self-contained, no imports, < 18KB unminified.
