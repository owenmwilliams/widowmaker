/*!
 * Nexus Moves — embeddable "Get a quote" widget (F1, issue #98).
 *
 * A moving company pastes ONE line into its own website:
 *
 *   <script src="https://app…/widget.js" data-nexus-token="THEIR_TOKEN" async></script>
 *
 * and this file renders a small branded panel (or just a button with
 * data-variant="button") that opens their Nexus Moves capture link
 * /c/{token}?src=widget in a new tab. See docs/widget-README.md.
 *
 * Constraints (deliberate):
 *   - Served AS-IS from public/ — no build step, no imports, ES5-safe syntax.
 *   - Renders into shadow DOM: the host page's CSS cannot bleed in, ours
 *     cannot bleed out. Browsers without attachShadow get a plain link.
 *   - Zero config beyond the token: every URL is derived from this script's
 *     own src, so the same line works against staging and prod.
 *   - Third-party pages cannot load our stylesheets, so the few design-system
 *     values used here are TRANSCRIBED below with their token names. If the
 *     design system changes, update these too (source of truth:
 *     movetrack-app/src/styles/design-system/tokens/*.css, light theme).
 */
(function () {
  'use strict';

  // ── Locate our own <script> tag ─────────────────────────────────────────
  // document.currentScript covers normal + async execution; the fallback scan
  // covers exotic loaders. A processed-marker keeps double-execution safe.
  var script = document.currentScript;
  if (!script || !script.getAttribute || !script.getAttribute('data-nexus-token')) {
    var candidates = document.querySelectorAll('script[data-nexus-token]');
    for (var i = candidates.length - 1; i >= 0; i--) {
      if (!candidates[i].getAttribute('data-nexus-widget-init')) { script = candidates[i]; break; }
    }
  }
  if (!script || script.getAttribute('data-nexus-widget-init')) return;
  script.setAttribute('data-nexus-widget-init', '1');

  var token = script.getAttribute('data-nexus-token');
  if (!token) {
    if (window.console && console.warn) console.warn('[nexus-widget] data-nexus-token is required');
    return;
  }

  var variant = script.getAttribute('data-variant') === 'button' ? 'button' : 'card';

  // Transcribed design tokens (light theme) — names from the Nexus design system:
  var ACCENT = script.getAttribute('data-accent') || '#4F5BF0'; // --blue-500 / --accent (Nexus Blue)
  var TEXT_PRIMARY = '#16204A';   // --l-text-1 (navy ink)
  var TEXT_SECONDARY = '#5A6379'; // --l-text-2
  var SURFACE_CARD = '#FFFFFF';   // --l-card
  var BORDER = '#E4E8F1';         // --l-line
  var ON_ACCENT = '#FFFFFF';      // --on-accent
  var RADIUS_MD = '14px';         // --r-md (buttons, inputs)
  var RADIUS_LG = '18px';         // --r-lg (cards)
  var SHADOW_XS = '0 1px 2px rgba(22, 32, 74, 0.06)'; // --shadow-xs

  // Every URL derives from this script's own src — zero host-page config.
  var srcUrl = script.src || '';
  var m = /^(https?:\/\/[^\/]+)/.exec(srcUrl);
  var origin = m ? m[1] : (window.location.protocol + '//' + window.location.host);

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function captureUrl(email) {
    var url = origin + '/c/' + encodeURIComponent(token) + '?src=widget';
    // Loose shape check only — the capture page re-validates properly; a typo
    // here just means no prefill.
    if (email && email.length <= 255 && EMAIL_RE.test(email)) {
      url += '&email=' + encodeURIComponent(email);
    }
    return url;
  }

  // ── Host + shadow root ──────────────────────────────────────────────────
  var host = document.createElement('div');
  host.style.display = 'block';
  if (script.parentNode) script.parentNode.insertBefore(host, script.nextSibling);
  else document.body.appendChild(host);

  var root = null; // shadow root, once attached

  function renderAnchorFallback() {
    // Used when shadow DOM is unavailable, and when the token turns out to be
    // dead (the capture page explains "link not active" politely). When a
    // shadow root exists it renders there (light-DOM children of a shadow
    // host don't paint).
    var target = root || host;
    while (target.firstChild) target.removeChild(target.firstChild);
    var a = document.createElement('a');
    a.href = captureUrl('');
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Get an accurate moving quote — film your home with your phone';
    target.appendChild(a);
  }

  if (!host.attachShadow) { renderAnchorFallback(); return; }
  root = host.attachShadow({ mode: 'open' });

  // ── Styles (inside the shadow root — isolated both ways) ────────────────
  var style = document.createElement('style');
  style.textContent =
    ':host{all:initial;display:block}' +
    '.nx{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
      'color:' + TEXT_PRIMARY + ';line-height:1.45;box-sizing:border-box;max-width:340px}' +
    '.nx *{box-sizing:border-box;margin:0}' +
    '.nx-card{background:' + SURFACE_CARD + ';border:1px solid ' + BORDER + ';' +
      'border-radius:' + RADIUS_LG + ';box-shadow:' + SHADOW_XS + ';padding:20px}' +
    '.nx-head{font-size:18px;font-weight:800;letter-spacing:-0.01em;color:' + TEXT_PRIMARY + '}' +
    '.nx-for{font-weight:600;color:' + TEXT_SECONDARY + '}' +
    '.nx-body{font-size:14px;color:' + TEXT_SECONDARY + ';margin-top:6px}' +
    '.nx-label{display:block;font-size:14px;font-weight:600;color:' + TEXT_SECONDARY + ';margin:14px 0 4px}' +
    '.nx-input{width:100%;min-height:44px;padding:10px 14px;font-size:15px;font-family:inherit;' +
      'color:' + TEXT_PRIMARY + ';background:' + SURFACE_CARD + ';border:1px solid ' + BORDER + ';' +
      'border-radius:' + RADIUS_MD + '}' +
    '.nx-input:focus{outline:2px solid ' + ACCENT + ';outline-offset:1px;border-color:' + ACCENT + '}' +
    '.nx-cta{display:block;width:100%;min-height:44px;margin-top:14px;padding:12px 18px;' +
      'font-size:15px;font-weight:700;font-family:inherit;color:' + ON_ACCENT + ';' +
      'background:' + ACCENT + ';border:0;border-radius:' + RADIUS_MD + ';cursor:pointer;' +
      'transition:filter 120ms ease,transform 120ms ease}' +
    '.nx-cta:hover{filter:brightness(0.92)}' +
    '.nx-cta:active{transform:scale(0.97)}' +
    '.nx-cta:focus-visible{outline:2px solid ' + ACCENT + ';outline-offset:2px}' +
    '.nx--button .nx-cta{margin-top:0;width:auto}' +
    '.nx-foot{font-size:14px;color:' + TEXT_SECONDARY + ';margin-top:10px}' +
    '.nx-foot a{color:' + TEXT_SECONDARY + ';font-weight:600;text-decoration:underline}' +
    '.nx-foot a:focus-visible{outline:2px solid ' + ACCENT + ';outline-offset:2px}' +
    '@media (prefers-reduced-motion:reduce){.nx-cta{transition:none}.nx-cta:active{transform:none}}';
  root.appendChild(style);

  // ── Markup (built with createElement/textContent — no HTML injection) ───
  var wrap = document.createElement('div');
  wrap.className = 'nx nx--' + variant;

  var box = document.createElement('div');
  box.className = variant === 'card' ? 'nx-card' : '';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Get a moving quote with Nexus Moves');
  wrap.appendChild(box);

  var forSpan = null;
  var emailInput = null;

  if (variant === 'card') {
    var head = document.createElement('h2');
    head.className = 'nx-head';
    head.appendChild(document.createTextNode('Get an accurate quote'));
    forSpan = document.createElement('span');
    forSpan.className = 'nx-for';
    head.appendChild(forSpan); // becomes " for {Company}" once the name loads
    box.appendChild(head);

    var body = document.createElement('p');
    body.className = 'nx-body';
    body.textContent = 'Film your home with your phone — takes about 10 minutes. No app needed.';
    box.appendChild(body);

    var label = document.createElement('label');
    label.className = 'nx-label';
    label.htmlFor = 'nx-email';
    label.textContent = 'Email (optional)';
    box.appendChild(label);

    emailInput = document.createElement('input');
    emailInput.className = 'nx-input';
    emailInput.id = 'nx-email';
    emailInput.type = 'email';
    emailInput.autocomplete = 'email';
    emailInput.placeholder = 'you@example.com';
    box.appendChild(emailInput);
  }

  var cta = document.createElement('button');
  cta.className = 'nx-cta';
  cta.type = 'button';
  cta.textContent = 'Start your video walkthrough';
  box.appendChild(cta);

  var foot = document.createElement('div');
  foot.className = 'nx-foot';
  foot.appendChild(document.createTextNode('Powered by '));
  var brand = document.createElement('a');
  brand.href = origin;
  brand.target = '_blank';
  brand.rel = 'noopener';
  brand.textContent = 'Nexus Moves';
  foot.appendChild(brand);
  box.appendChild(foot);

  root.appendChild(wrap);

  function openCapture() {
    var email = emailInput ? emailInput.value.replace(/^\s+|\s+$/g, '') : '';
    window.open(captureUrl(email), '_blank', 'noopener');
  }
  cta.addEventListener('click', openCapture);
  if (emailInput) {
    emailInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.keyCode === 13) { ev.preventDefault(); openCapture(); }
    });
  }

  // ── Company name lookup (optional garnish; the widget renders without it) ─
  // data-name skips the network entirely (used by the /widget-demo page).
  // 404 = the token is dead → degrade to the plain-link fallback so movers
  // never show visitors a slick button into a dead end. Anything else
  // (network error, HTML from an SPA host, timeout) fails OPEN: keep the
  // widget, just without the name.
  var presetName = script.getAttribute('data-name');
  if (presetName) {
    if (forSpan) forSpan.textContent = ' for ' + presetName;
  } else {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', origin + '/api/capture/' + encodeURIComponent(token), true);
      xhr.timeout = 5000;
      xhr.onload = function () {
        if (xhr.status === 404) { renderAnchorFallback(); return; }
        if (xhr.status !== 200) return;
        try {
          var data = JSON.parse(xhr.responseText);
          if (data && data.name && forSpan) forSpan.textContent = ' for ' + data.name;
        } catch (e) { /* not JSON (SPA fallback page) — fine without a name */ }
      };
      xhr.onerror = function () { /* fail open */ };
      xhr.send();
    } catch (e) { /* fail open */ }
  }
})();
