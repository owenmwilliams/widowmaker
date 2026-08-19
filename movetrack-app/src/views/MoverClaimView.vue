<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { Building2, Mail, CircleAlert, MailCheck, LayoutDashboard, Link2, Code2 } from 'lucide-vue-next'
import { API_BASE_URL } from '../config/api'
// Inline (not <img>): SVG-as-image can't load webfonts (MoverLogin precedent).
import logoSvg from '../assets/brand/logo-lockup-light.svg?raw'

/* ============================================================
   /mover/claim/:inviteToken (F3, #100) — a customer "found" this
   moving company and forwarded them an invite. Public page:
     1. GET /api/company/claim/:inviteToken → business name (or an
        honest invalid/already-claimed state).
     2. Form (company name prefilled, contact email) →
        POST /api/company/claim → "check your email for your
        login link" + what the free account includes.
   Desktop-ok, responsive (movers are desktop-first).
   ============================================================ */

const route = useRoute()
const core_url = API_BASE_URL
const inviteToken = String(route.params.inviteToken || '')

const loading = ref(true)
const invalid = ref(false)
const alreadyClaimed = ref(false)

const companyName = ref('')
const email = ref('')
const formError = ref('')
const submitting = ref(false)
const claimed = ref(false)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

onMounted(async () => {
  try {
    const { data } = await axios.get(`${core_url}/api/company/claim/${encodeURIComponent(inviteToken)}`)
    if (data.status === 'claimed') {
      alreadyClaimed.value = true
    } else {
      companyName.value = data.businessName || ''
    }
  } catch {
    invalid.value = true
  } finally {
    loading.value = false
  }
})

async function submitClaim() {
  formError.value = ''
  const name = companyName.value.trim()
  const contact = email.value.trim()
  if (!name) {
    formError.value = 'Enter your company name.'
    return
  }
  if (!contact || !EMAIL_RE.test(contact)) {
    formError.value = 'Enter a valid contact email — your login link goes there.'
    return
  }
  submitting.value = true
  try {
    await axios.post(`${core_url}/api/company/claim`, {
      inviteToken,
      name,
      contact_email: contact,
    })
    claimed.value = true
  } catch (e: any) {
    if (e?.response?.status === 410) {
      alreadyClaimed.value = true
    } else {
      formError.value = e?.response?.data?.error || 'Could not create your account. Please try again.'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mc-page">
    <div class="mc-card">
      <div class="mc-logo-row">
        <span class="mc-logo" v-html="logoSvg"></span>
      </div>
      <p class="mc-eyebrow">Free mover account</p>

      <!-- Loading -->
      <div v-if="loading" class="mc-state" aria-live="polite">
        <div class="mc-spinner" aria-hidden="true"></div>
        <p class="mc-sub">Checking your invite…</p>
      </div>

      <!-- Invalid link -->
      <div v-else-if="invalid" class="mc-state">
        <CircleAlert :size="40" class="mc-error-icon" aria-hidden="true" />
        <h1 class="mc-title">This invite link isn't valid</h1>
        <p class="mc-sub">
          The link may have been mistyped. Already have an account?
          <router-link class="mc-link" to="/mover/login">Log in to your dashboard</router-link>.
        </p>
      </div>

      <!-- Already claimed -->
      <div v-else-if="alreadyClaimed && !claimed" class="mc-state">
        <MailCheck :size="40" class="mc-sent-icon" aria-hidden="true" />
        <h1 class="mc-title">This invite was already used</h1>
        <p class="mc-sub">
          If that was you, your account exists —
          <router-link class="mc-link" to="/mover/login">log in here</router-link>
          with your company's contact email to get a fresh login link.
        </p>
      </div>

      <!-- Success -->
      <div v-else-if="claimed" class="mc-state" aria-live="polite">
        <MailCheck :size="40" class="mc-sent-icon" aria-hidden="true" />
        <h1 class="mc-title">Check your email for your login link</h1>
        <p class="mc-sub">
          Your free account is ready. We sent a one-time login link to
          <strong>{{ email }}</strong> — it also includes the customer's inventory
          that was shared with you. The link works once and expires in 15 minutes.
        </p>
      </div>

      <!-- Claim form -->
      <form v-else class="mc-form" @submit.prevent="submitClaim">
        <h1 class="mc-title">A customer wants to send you their inventory</h1>
        <p class="mc-sub">
          They built a full moving inventory on Nexus Moves — item list, weights,
          and room walkthrough videos — and picked
          <strong v-if="companyName">{{ companyName }}</strong><span v-else>your company</span>
          to quote their move. Claim your free account to receive it.
        </p>

        <label class="mc-label" for="mc-name">Company name</label>
        <div class="mc-input-wrap">
          <Building2 :size="18" class="mc-input-icon" aria-hidden="true" />
          <input
            id="mc-name"
            v-model="companyName"
            class="mc-input"
            type="text"
            name="organization"
            autocomplete="organization"
            placeholder="Your company name"
            :disabled="submitting"
          />
        </div>

        <label class="mc-label" for="mc-email">Contact email</label>
        <div class="mc-input-wrap" :class="{ 'mc-input-wrap--error': formError }">
          <Mail :size="18" class="mc-input-icon" aria-hidden="true" />
          <input
            id="mc-email"
            v-model="email"
            class="mc-input"
            type="email"
            name="email"
            autocomplete="email"
            placeholder="ops@yourcompany.com"
            :disabled="submitting"
            @input="formError = ''"
          />
        </div>
        <p v-if="formError" class="mc-error" role="alert">{{ formError }}</p>

        <button class="mc-btn" type="submit" :disabled="submitting">
          {{ submitting ? 'Creating your account…' : 'Claim my free account' }}
        </button>

        <ul class="mc-perks" aria-label="What your free account includes">
          <li class="mc-perk">
            <LayoutDashboard :size="17" aria-hidden="true" />
            <span>A dashboard with every inventory customers send you</span>
          </li>
          <li class="mc-perk">
            <Link2 :size="17" aria-hidden="true" />
            <span>Your own capture link — customers film their home, you get a quote-ready doc</span>
          </li>
          <li class="mc-perk">
            <Code2 :size="17" aria-hidden="true" />
            <span>An embeddable "Get a quote" widget for your website</span>
          </li>
        </ul>

        <p class="mc-hint">
          No password — we email you a one-time login link. Free while Nexus Moves is in launch.
        </p>
      </form>
    </div>
  </div>
</template>

<style scoped>
.mc-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-6);
  background: var(--bg);
  font-family: var(--font-ui);
  color: var(--text-primary);
}

.mc-card {
  width: 100%;
  max-width: 480px;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  padding: var(--sp-8) var(--sp-7);
}

.mc-logo-row { display: flex; justify-content: center; margin-bottom: var(--sp-5); }
.mc-logo { display: block; line-height: 0; }
.mc-logo :deep(svg) { height: 34px; width: auto; display: block; }

.mc-eyebrow {
  margin: 0 0 var(--sp-6);
  text-align: center;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--accent);
}

.mc-title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: var(--fw-bold);
  font-size: var(--fs-title-m);
  letter-spacing: var(--ls-title);
  color: var(--text-primary);
  text-align: center;
  line-height: var(--lh-tight);
}
.mc-sub {
  margin: var(--sp-3) 0 0;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--text-secondary);
  text-align: center;
}

.mc-state { display: flex; flex-direction: column; align-items: center; padding: var(--sp-4) 0 var(--sp-2); }
.mc-error-icon { color: var(--danger); margin-bottom: var(--sp-4); }
.mc-sent-icon { color: var(--success); margin-bottom: var(--sp-4); }

.mc-spinner {
  width: 36px; height: 36px;
  border-radius: var(--r-pill);
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  animation: mc-spin 0.9s linear infinite;
  margin-bottom: var(--sp-5);
}
@keyframes mc-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .mc-spinner { animation: none; } }

.mc-form { display: flex; flex-direction: column; }
.mc-label {
  margin: var(--sp-6) 0 var(--sp-2);
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.mc-input-wrap {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  border: 1.5px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface-card);
  padding: 0 var(--sp-4);
  transition: border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
}
.mc-input-wrap:focus-within { border-color: var(--accent); box-shadow: var(--focus-ring); }
.mc-input-wrap--error { border-color: var(--danger); }
.mc-input-icon { color: var(--text-tertiary); flex: none; }
.mc-input {
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
.mc-input::placeholder { color: var(--text-tertiary); }
.mc-input:disabled { opacity: 0.45; }

.mc-error { margin: var(--sp-2) 0 0; font-size: var(--fs-label); color: var(--danger); }

.mc-btn {
  margin-top: var(--sp-6);
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
.mc-btn:hover { background: var(--accent-hover); }
.mc-btn:active { transform: scale(0.97); }
.mc-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.mc-btn:disabled { opacity: 0.45; cursor: default; }

.mc-perks {
  list-style: none;
  margin: var(--sp-6) 0 0;
  padding: var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  background: var(--accent-quiet);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-md);
}
.mc-perk {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--text-primary);
}
.mc-perk svg { flex: none; color: var(--accent); margin-top: 1px; }

.mc-hint {
  margin: var(--sp-5) 0 0;
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--text-tertiary);
  text-align: center;
}
.mc-link { color: var(--accent); text-decoration: none; }
.mc-link:hover { text-decoration: underline; }
.mc-link:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-xs); }
</style>
