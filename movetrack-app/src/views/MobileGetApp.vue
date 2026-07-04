<script setup lang="ts">
// Phones get the native app, not a squeezed-down web app. The core loop —
// narrated walkthrough videos, multi-photo capture, background uploads — is
// materially better native, so mobile browsers land here instead of the chat.
// Movers' share links (/share/:token) and legal pages stay reachable on any
// device; see the router guard.

// Set VITE_IOS_APP_URL to the TestFlight PUBLIC link during the beta
// (App Store Connect → TestFlight → group → enable public link), then the
// App Store link after launch. When unset, the page shows a private-beta
// notice instead of a dead button.
const iosAppUrl: string = import.meta.env.VITE_IOS_APP_URL || ''

function continueToWeb () {
  // Escape hatch for tablets/edge cases — remembered for this tab only.
  sessionStorage.setItem('nexus-force-web', '1')
  window.location.href = '/'
}
</script>

<template>
  <div class="get-app">
    <div class="get-app__card">
      <img src="../assets/brand/app-icon.svg" alt="" class="get-app__logo" />
      <h1 class="get-app__title">Nexus Moves</h1>
      <p class="get-app__tagline">Smart inventory for your move</p>

      <p class="get-app__body">
        On your phone, Nexus Moves is a native app — walk through a room,
        talk through your stuff, and your moving inventory builds itself.
      </p>

      <a v-if="iosAppUrl" :href="iosAppUrl" class="get-app__cta">
        Get the iPhone app
      </a>
      <div v-else class="get-app__beta">
        <p class="get-app__beta-title">We're in private beta on iPhone.</p>
        <p class="get-app__beta-body">
          Have an invite? Open your TestFlight link on this phone to install.
        </p>
      </div>

      <p class="get-app__android">Android is on the way.</p>

      <p class="get-app__note">
        Received an inventory link from someone? Just open that link — it
        works right here in your browser.
      </p>

      <button class="get-app__web-link" @click="continueToWeb">
        Continue to the web version anyway
      </button>
    </div>
  </div>
</template>

<style scoped>
.get-app {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-7);
  background: var(--bg);
}
.get-app__card {
  max-width: 420px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-4);
}
.get-app__logo {
  width: 72px;
  height: 72px;
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-md);
}
.get-app__title {
  font-family: var(--font-display);
  font-size: var(--fs-title-l);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-display);
  color: var(--text-primary);
  margin: var(--sp-3) 0 0;
}
.get-app__tagline {
  color: var(--text-secondary);
  font-size: var(--fs-body);
  margin: 0;
}
.get-app__body {
  margin: var(--sp-5) 0 var(--sp-2);
  color: var(--text-secondary);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
/* The ONE shimmer CTA on this page — the primary hero action. */
.get-app__cta {
  display: inline-block;
  margin-top: var(--sp-3);
  padding: var(--sp-4) var(--sp-7);
  border-radius: var(--r-md);
  background: var(--shimmer);
  color: var(--on-accent);
  font-size: var(--fs-body-l);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
  text-decoration: none;
  transition: box-shadow var(--dur-base) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.get-app__cta:hover {
  box-shadow: var(--glow-shimmer);
}
.get-app__cta:active {
  transform: scale(0.97);
}
.get-app__cta:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.get-app__beta {
  margin-top: var(--sp-3);
  padding: var(--sp-5) var(--sp-6);
  border-radius: var(--r-md);
  background: var(--accent-quiet);
  border: 1px solid var(--border);
}
.get-app__beta-title {
  font-weight: var(--fw-bold);
  color: var(--text-primary);
  margin: 0 0 var(--sp-2);
}
.get-app__beta-body {
  color: var(--text-secondary);
  font-size: var(--fs-label);
  margin: 0;
}
.get-app__android {
  color: var(--text-secondary);
  font-size: var(--fs-label);
  margin: var(--sp-4) 0 0;
}
.get-app__note {
  margin-top: var(--sp-6);
  font-size: var(--fs-label);
  color: var(--text-secondary);
  line-height: var(--lh-body);
}
.get-app__web-link {
  margin-top: var(--sp-2);
  background: none;
  border: none;
  border-radius: var(--r-xs);
  color: var(--text-tertiary);
  font-size: var(--fs-label);
  text-decoration: underline;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.get-app__web-link:hover {
  color: var(--text-secondary);
}
.get-app__web-link:active {
  transform: scale(0.97);
}
.get-app__web-link:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
