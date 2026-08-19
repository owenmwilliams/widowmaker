<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { Mail, CircleAlert, MailCheck } from 'lucide-vue-next'
import { API_BASE_URL } from '../config/api'
import { setCompanySession, getCompanySessionToken } from '../utils/companyAuth'
// Inline (not <img>): the lockup's wordmark is SVG <text> in Bricolage, and
// SVG-as-image can't load webfonts — inlining lets the bundled font apply.
import logoSvg from '../assets/brand/logo-lockup-light.svg?raw'

/* ============================================================
   /mover/login — magic-link login for MOVING COMPANIES (F2, #99).
   Public route. Two jobs:
     1. Email form → POST /api/company/auth/request-link →
        "check your email" state. The server always answers a
        neutral 200 (no account enumeration), so the UI shows the
        same calm message either way.
     2. ?token=… callback (from the emailed link) → POST
        /api/company/auth/verify → store the COMPANY session
        (distinct localStorage keys from user auth) → /mover.
   ============================================================ */

const route = useRoute()
const router = useRouter()
const core_url = API_BASE_URL

const email = ref('')
const emailError = ref('')
const isSubmitting = ref(false)
const linkSent = ref(false)
const sentMessage = ref('')

const hasTokenInUrl = !!route.query.token
const isVerifying = ref(hasTokenInUrl)
const verifyError = ref('')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

onMounted(async () => {
  const token = route.query.token as string | undefined
  if (token) {
    await verifyToken(token)
    return
  }
  // Already logged in as a company → straight to the dashboard.
  if (getCompanySessionToken()) {
    router.replace('/mover')
  }
})

async function requestLink() {
  emailError.value = ''
  const value = email.value.trim()
  if (!value || !EMAIL_RE.test(value)) {
    emailError.value = 'Enter the contact email for your company.'
    return
  }
  isSubmitting.value = true
  try {
    const { data } = await axios.post(`${core_url}/api/company/auth/request-link`, { email: value })
    sentMessage.value = data?.message || 'If that email manages a company on Nexus Moves, a login link is on its way.'
    linkSent.value = true
  } catch (e: any) {
    emailError.value = e?.response?.data?.error || 'Could not send the link. Please try again.'
  } finally {
    isSubmitting.value = false
  }
}

async function verifyToken(token: string) {
  isVerifying.value = true
  verifyError.value = ''
  try {
    const { data } = await axios.post(`${core_url}/api/company/auth/verify`, { token })
    setCompanySession(data.sessionToken, data.company)
    // Drop ?token= from history so a back-press doesn't retry a used link.
    router.replace('/mover')
  } catch (e: any) {
    verifyError.value = e?.response?.data?.error || 'This login link is invalid or has expired. Request a fresh one.'
    isVerifying.value = false
  }
}

function tryAgain() {
  verifyError.value = ''
  linkSent.value = false
  // Clear the dead token from the URL.
  if (route.query.token) router.replace({ path: '/mover/login' })
}
</script>

<template>
  <div class="ml-page">
    <div class="ml-card">
      <div class="ml-logo-row">
        <span class="ml-logo" v-html="logoSvg"></span>
      </div>
      <p class="ml-eyebrow">Mover dashboard</p>

      <!-- Verifying the emailed link -->
      <div v-if="isVerifying" class="ml-state" aria-live="polite">
        <div class="ml-spinner" aria-hidden="true"></div>
        <h1 class="ml-title">Logging you in…</h1>
        <p class="ml-sub">Checking your login link.</p>
      </div>

      <!-- Link failed -->
      <div v-else-if="verifyError" class="ml-state">
        <CircleAlert :size="40" class="ml-error-icon" aria-hidden="true" />
        <h1 class="ml-title">That link didn't work</h1>
        <p class="ml-sub">{{ verifyError }}</p>
        <button class="ml-btn" @click="tryAgain">Request a new link</button>
      </div>

      <!-- "Check your email" -->
      <div v-else-if="linkSent" class="ml-state" aria-live="polite">
        <MailCheck :size="40" class="ml-sent-icon" aria-hidden="true" />
        <h1 class="ml-title">Check your email</h1>
        <p class="ml-sub">{{ sentMessage }}</p>
        <p class="ml-hint">The link works once and expires in 15 minutes. Nothing arrived after a couple of minutes? Check spam, or make sure you used your company's contact email.</p>
        <button class="ml-btn ml-btn--quiet" @click="tryAgain">Use a different email</button>
      </div>

      <!-- Email form -->
      <form v-else class="ml-form" @submit.prevent="requestLink">
        <h1 class="ml-title">Log in to your dashboard</h1>
        <p class="ml-sub">
          Enter your company's contact email and we'll send you a one-time login link — no password.
        </p>

        <label class="ml-label" for="mover-email">Company contact email</label>
        <div class="ml-input-wrap" :class="{ 'ml-input-wrap--error': emailError }">
          <Mail :size="18" class="ml-input-icon" aria-hidden="true" />
          <input
            id="mover-email"
            v-model="email"
            class="ml-input"
            type="email"
            name="email"
            autocomplete="email"
            placeholder="ops@yourcompany.com"
            :disabled="isSubmitting"
            @input="emailError = ''"
          />
        </div>
        <p v-if="emailError" class="ml-error" role="alert">{{ emailError }}</p>

        <button class="ml-btn" type="submit" :disabled="isSubmitting">
          {{ isSubmitting ? 'Sending…' : 'Email me a login link' }}
        </button>

        <p class="ml-hint">
          This is the dashboard for moving companies. Moving yourself?
          <router-link class="ml-link" to="/login">Log in here</router-link> instead.
        </p>
      </form>
    </div>
  </div>
</template>

<style scoped>
.ml-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-6);
  background: var(--bg);
  font-family: var(--font-ui);
  color: var(--text-primary);
}

.ml-card {
  width: 100%;
  max-width: 440px;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  padding: var(--sp-8) var(--sp-7);
}

.ml-logo-row { display: flex; justify-content: center; margin-bottom: var(--sp-5); }
.ml-logo { display: block; line-height: 0; }
.ml-logo :deep(svg) { height: 34px; width: auto; display: block; }

.ml-eyebrow {
  margin: 0 0 var(--sp-6);
  text-align: center;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--accent);
}

.ml-title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: var(--fw-bold);
  font-size: var(--fs-title-m);
  letter-spacing: var(--ls-title);
  color: var(--text-primary);
  text-align: center;
}
.ml-sub {
  margin: var(--sp-3) 0 0;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--text-secondary);
  text-align: center;
}

.ml-state { display: flex; flex-direction: column; align-items: center; padding: var(--sp-4) 0 var(--sp-2); }
.ml-state .ml-btn { margin-top: var(--sp-6); }

.ml-error-icon { color: var(--danger); margin-bottom: var(--sp-4); }
.ml-sent-icon { color: var(--success); margin-bottom: var(--sp-4); }

.ml-spinner {
  width: 36px; height: 36px;
  border-radius: var(--r-pill);
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  animation: ml-spin 0.9s linear infinite;
  margin-bottom: var(--sp-5);
}
@keyframes ml-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .ml-spinner { animation: none; }
}

.ml-form { display: flex; flex-direction: column; }
.ml-label {
  margin: var(--sp-6) 0 var(--sp-2);
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.ml-input-wrap {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  border: 1.5px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface-card);
  padding: 0 var(--sp-4);
  transition: border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
}
.ml-input-wrap:focus-within { border-color: var(--accent); box-shadow: var(--focus-ring); }
.ml-input-wrap--error { border-color: var(--danger); }
.ml-input-icon { color: var(--text-tertiary); flex: none; }
.ml-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  padding: 12px 0;
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  color: var(--text-primary);
}
.ml-input::placeholder { color: var(--text-tertiary); }
.ml-input:disabled { opacity: 0.45; }

.ml-error { margin: var(--sp-2) 0 0; font-size: var(--fs-label); color: var(--danger); }

.ml-btn {
  margin-top: var(--sp-5);
  width: 100%;
  border: 0;
  border-radius: var(--r-md);
  background: var(--accent);
  color: var(--text-on-accent);
  font-family: var(--font-ui);
  font-weight: var(--fw-bold);
  font-size: var(--fs-body);
  letter-spacing: var(--ls-title);
  padding: 12px 20px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.ml-btn:hover { background: var(--accent-hover); }
.ml-btn:active { transform: scale(0.97); }
.ml-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ml-btn:disabled { opacity: 0.45; cursor: default; }

.ml-btn--quiet {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  width: auto;
}
.ml-btn--quiet:hover { background: var(--surface-hover); }

.ml-hint {
  margin: var(--sp-6) 0 0;
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--text-tertiary);
  text-align: center;
}
.ml-link { color: var(--accent); text-decoration: none; }
.ml-link:hover { text-decoration: underline; }
.ml-link:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-xs); }
</style>
