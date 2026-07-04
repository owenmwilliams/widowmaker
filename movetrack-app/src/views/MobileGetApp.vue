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
      <img src="/favicon.ico" alt="" class="get-app__logo" />
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
  padding: 24px;
  background: linear-gradient(160deg, #f5f3ff 0%, #ffffff 55%);
}
.get-app__card {
  max-width: 420px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.get-app__logo {
  width: 72px;
  height: 72px;
  border-radius: 18px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
}
.get-app__title {
  font-size: 1.8rem;
  font-weight: 800;
  margin: 8px 0 0;
}
.get-app__tagline {
  color: #6b7280;
  margin: 0;
}
.get-app__body {
  margin: 14px 0 6px;
  color: #374151;
  line-height: 1.5;
}
.get-app__cta {
  display: inline-block;
  margin-top: 8px;
  padding: 14px 28px;
  border-radius: 14px;
  background: #6d28d9;
  color: #fff;
  font-weight: 700;
  text-decoration: none;
}
.get-app__beta {
  margin-top: 8px;
  padding: 14px 18px;
  border-radius: 14px;
  background: #ede9fe;
}
.get-app__beta-title {
  font-weight: 700;
  color: #4c1d95;
  margin: 0 0 4px;
}
.get-app__beta-body {
  color: #6b7280;
  font-size: 0.9rem;
  margin: 0;
}
.get-app__android {
  color: #6b7280;
  font-size: 0.9rem;
  margin: 10px 0 0;
}
.get-app__note {
  margin-top: 18px;
  font-size: 0.85rem;
  color: #6b7280;
  line-height: 1.45;
}
.get-app__web-link {
  margin-top: 6px;
  background: none;
  border: none;
  color: #9ca3af;
  font-size: 0.8rem;
  text-decoration: underline;
  cursor: pointer;
}
</style>
