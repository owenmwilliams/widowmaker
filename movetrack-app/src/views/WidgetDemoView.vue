<script setup lang="ts">
import { ref, onMounted } from 'vue'

/* ============================================================
   /widget-demo — the pitch page for the embeddable widgets
   (F1 #98, redesigned for the hero CHAT widget in #112). A fake
   mover website ("Acme Van Lines") with the REAL widgets
   embedded via the actual <script> tag mechanism a moving
   company would paste.

   The chat panel is the HERO now: big, right of the hero copy,
   above the fold, LIVE against the `demo` vendor token — the
   buyer can chat to a real quote and a (simulated-deposit)
   reservation without leaving this page. Card + button variants
   remain below as the secondary story. Public route, no auth.

   Deliberately styled like a generic third-party mover site (its
   own literal styles, not our design tokens) so the widgets'
   isolation — shadow DOM for card/button, an iframe for chat —
   is demonstrated honestly.
   ============================================================ */

const DEMO_TOKEN = 'demo'
const DEMO_NAME = 'Acme Van Lines'

const chatSlot = ref<HTMLElement | null>(null)
const cardSlot = ref<HTMLElement | null>(null)
const buttonSlot = ref<HTMLElement | null>(null)
const copied = ref(false)

// The one-liners a company pastes (shown with a placeholder token; the mint
// response's embedSnippet carries their real one).
const chatSnippet = ref('')
const snippet = ref('')
const buttonSnippet = ref('')
const anchorSnippet = ref('')

function embedWidget(slot: HTMLElement, variant: 'chat' | 'card' | 'button') {
  // The real mechanism: a plain script tag, exactly like a mover's site.
  // data-name skips the company-name lookup (the demo token isn't minted).
  const s = document.createElement('script')
  s.src = '/widget.js'
  s.async = true
  s.setAttribute('data-nexus-token', DEMO_TOKEN)
  s.setAttribute('data-name', DEMO_NAME)
  if (variant !== 'card') s.setAttribute('data-variant', variant)
  slot.appendChild(s)
}

async function copySnippet() {
  try {
    await navigator.clipboard.writeText(chatSnippet.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* clipboard blocked — the text is selectable */ }
}

onMounted(() => {
  const origin = window.location.origin
  chatSnippet.value = `<script src="${origin}/widget.js" data-nexus-token="YOUR_COMPANY_TOKEN" data-variant="chat" async><\/script>`
  snippet.value = `<script src="${origin}/widget.js" data-nexus-token="YOUR_COMPANY_TOKEN" async><\/script>`
  buttonSnippet.value = `<script src="${origin}/widget.js" data-nexus-token="YOUR_COMPANY_TOKEN" data-variant="button" async><\/script>`
  anchorSnippet.value = `<a href="${origin}/c/YOUR_COMPANY_TOKEN?src=widget" target="_blank" rel="noopener">Get an accurate moving quote — film your home with your phone<\/a>`
  if (chatSlot.value) embedWidget(chatSlot.value, 'chat')
  if (cardSlot.value) embedWidget(cardSlot.value, 'card')
  if (buttonSlot.value) embedWidget(buttonSlot.value, 'button')
})
</script>

<template>
  <div class="wd">
    <!-- Fake mover site chrome -->
    <header class="wd__nav">
      <span class="wd__logo">ACME VAN LINES</span>
      <nav class="wd__links" aria-hidden="true">
        <span>Services</span><span>Pricing</span><span>About</span><span>Contact</span>
      </nav>
    </header>

    <!-- HERO: mover pitch left, the LIVE chat agent right, above the fold -->
    <section class="wd__hero">
      <div class="wd__hero-copy">
        <h1>Moving families across the state since 1987</h1>
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Full-service
          packing, careful crews, and honest quotes — sed do eiusmod tempor
          incididunt ut labore et dolore magna aliqua.
        </p>
        <p class="wd__lorem">
          Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris
          nisi ut aliquip ex ea commodo consequat.
        </p>
        <p class="wd__hero-hint" aria-hidden="true">
          Try it — the assistant on the right quotes and books against this
          demo company's real rate card. &rarr;
        </p>
      </div>

      <!-- The REAL chat widget, hero-sized, live against the demo vendor -->
      <div class="wd__chat-slot" ref="chatSlot" aria-label="Nexus chat widget — live demo"></div>
    </section>

    <!-- Secondary: the classic card + button variants -->
    <section class="wd__strip">
      <div class="wd__strip-copy">
        <h2>Prefer the classic widgets?</h2>
        <p>
          The card and button variants open the film-your-home capture flow in
          a new tab — excepteur sint occaecat cupidatat non proident. Ready
          when you are —
        </p>
        <!-- The REAL widget, button variant -->
        <div class="wd__widget-slot" ref="buttonSlot" aria-label="Nexus quote widget — button variant"></div>
      </div>
      <!-- The REAL widget, card variant -->
      <div class="wd__widget-slot" ref="cardSlot" aria-label="Nexus quote widget — card variant"></div>
    </section>

    <!-- The pitch: how a company gets this on their site -->
    <section class="wd__embed">
      <h2>Put this on your website</h2>
      <p>
        Paste one line where you want your AI quote assistant to appear. Your
        company token comes with your Nexus Moves account — the same agent
        also answers any MCP-speaking AI client, out of the box.
      </p>

      <div class="wd__code-row">
        <pre class="wd__code"><code>{{ chatSnippet }}</code></pre>
        <button type="button" class="wd__copy" @click="copySnippet">
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>

      <details class="wd__more">
        <summary>Card and button variants, and the no-JavaScript fallback</summary>
        <p>The classic quote card (opens the capture flow in a new tab):</p>
        <pre class="wd__code"><code>{{ snippet }}</code></pre>
        <p>Just the button (for a navbar or footer):</p>
        <pre class="wd__code"><code>{{ buttonSnippet }}</code></pre>
        <p>Plain link — works everywhere, no script at all:</p>
        <pre class="wd__code"><code>{{ anchorSnippet }}</code></pre>
      </details>
    </section>

    <footer class="wd__foot">
      Demo page — “Acme Van Lines” is not a real company. The widgets above are
      live: the chat quotes and reserves against a demo rate card (deposits are
      simulated — nothing is ever charged), and the card/button open the Nexus
      Moves capture flow in a new tab.
    </footer>
  </div>
</template>

<style scoped>
/* Generic third-party-mover-site look on purpose (see header comment). */
.wd {
  min-height: 100vh;
  background: #f7f5f0;
  color: #2b2b2b;
  font-family: Georgia, 'Times New Roman', serif;
}
.wd__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 40px;
  background: #1f2d24;
  color: #f3efe6;
}
.wd__logo { font-weight: 700; letter-spacing: 0.12em; font-size: 18px; }
.wd__links { display: flex; gap: 28px; font-size: 14px; opacity: 0.85; }

/* Hero: copy left, LIVE chat right — the chat is the hero. */
.wd__hero {
  display: flex;
  gap: 56px;
  align-items: flex-start;
  max-width: 1120px;
  margin: 0 auto;
  padding: 56px 40px 48px;
}
.wd__hero-copy { flex: 1; min-width: 0; padding-top: 8px; }
.wd__hero h1 { font-size: 40px; line-height: 1.15; margin: 0 0 18px; color: #1f2d24; }
.wd__hero p { font-size: 17px; line-height: 1.6; margin: 0 0 14px; }
.wd__lorem { color: #6b6b60; }
.wd__hero-hint { color: #8a8778; font-style: italic; font-size: 15px; }
.wd__chat-slot {
  flex: none;
  width: 420px;
  max-width: 100%;
}

/* Secondary strip: card + button variants */
.wd__strip {
  max-width: 1120px;
  margin: 0 auto;
  padding: 8px 40px 48px;
  display: flex;
  align-items: flex-start;
  gap: 48px;
  flex-wrap: wrap;
  border-top: 1px solid #e2ded2;
  padding-top: 40px;
}
.wd__strip-copy { flex: 1; min-width: 280px; }
.wd__strip-copy h2 { font-size: 24px; margin: 0 0 10px; color: #1f2d24; }
.wd__strip-copy p { font-size: 16px; line-height: 1.6; margin: 0 0 18px; }
.wd__widget-slot { flex: none; }

.wd__embed {
  max-width: 1120px;
  margin: 0 auto 48px;
  padding: 32px 40px;
  background: #ffffff;
  border: 1px solid #e2ded2;
  border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.wd__embed h2 { margin: 0 0 8px; font-size: 22px; }
.wd__embed > p { margin: 0 0 16px; color: #55554c; font-size: 15px; line-height: 1.55; }
.wd__code-row { display: flex; gap: 12px; align-items: stretch; }
.wd__code {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 14px 16px;
  background: #1e1e28;
  color: #d6e4ff;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre;
}
.wd__copy {
  flex: none;
  align-self: center;
  padding: 10px 18px;
  border: 1px solid #c9c4b4;
  border-radius: 6px;
  background: #f3efe6;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.wd__copy:hover { background: #eae4d5; }
.wd__copy:focus-visible { outline: 2px solid #4F5BF0; outline-offset: 2px; }
.wd__more { margin-top: 18px; font-size: 15px; }
.wd__more summary { cursor: pointer; font-weight: 600; }
.wd__more p { margin: 14px 0 8px; color: #55554c; }
.wd__more .wd__code { margin-bottom: 4px; }
.wd__foot {
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 40px 48px;
  font-size: 13px;
  color: #8a8778;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
@media (max-width: 900px) {
  .wd__hero { flex-direction: column; gap: 32px; }
  .wd__chat-slot { width: 100%; }
  .wd__strip { align-items: flex-start; }
}
@media (max-width: 560px) {
  .wd__nav { padding: 16px 20px; }
  .wd__links { display: none; }
  .wd__hero, .wd__strip, .wd__embed, .wd__foot { padding-left: 20px; padding-right: 20px; }
  .wd__hero h1 { font-size: 30px; }
}
</style>
