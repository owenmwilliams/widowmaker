<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import {
  ArrowLeft, MapPin, Star, BadgeCheck, CircleCheck, CircleAlert,
  Copy, Mail, Search,
} from 'lucide-vue-next'
import { API_BASE_URL } from '../config/api'

/* ============================================================
   /discover-movers?moveId=… (F3, #100) — "Find movers near you".
   Mobile-first. Searches REAL moving companies near the move
   origin (Google Places, server-side), lets the customer pick up
   to 5 and send each one their inventory doc:
     • company already on Nexus → we email them directly ("Sent").
     • not on Nexus → Google doesn't share business emails, so we
       hand the customer a prewritten message (share link + claim
       link) to forward themselves — stated honestly on screen.
   ============================================================ */

const route = useRoute()
const router = useRouter()
const core_url = API_BASE_URL

interface Mover {
  placeId: string
  name: string
  address: string | null
  rating: number | null
  userRatingCount: number
  distanceKm: number | null
  onNexus: boolean
  companyId: string | null
}

interface InviteResult {
  placeId: string
  name: string
  onNexus: boolean
  delivery: 'emailed' | 'forward' | 'failed'
  status: string
  claimUrl?: string
  copyText?: string
  mailto?: string
}

const MAX_PICKS = 5

const loading = ref(true)
const loadError = ref('')
const unavailable = ref(false)
const origin = ref<{ name: string | null; city: string | null; state: string | null } | null>(null)
const movers = ref<Mover[]>([])
const selected = ref<Set<string>>(new Set())
const message = ref('')

const sending = ref(false)
const sendError = ref('')
const results = ref<InviteResult[] | null>(null)
const copiedFor = ref<string | null>(null)

const moveId = computed(() => {
  const raw = route.query.moveId
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isInteger(n) && n > 0 ? n : null
})

const originLabel = computed(() => {
  if (!origin.value) return ''
  const place = [origin.value.city, origin.value.state].filter(Boolean).join(', ')
  return place || origin.value.name || 'your move origin'
})

const selectedCount = computed(() => selected.value.size)
const canSend = computed(() => selectedCount.value > 0 && !sending.value)

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('session_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

onMounted(load)

async function load() {
  loading.value = true
  loadError.value = ''
  unavailable.value = false
  try {
    const params = moveId.value ? { moveId: moveId.value } : {}
    const { data } = await axios.get(`${core_url}/api/discover/movers`, {
      params,
      headers: authHeaders(),
    })
    origin.value = data.origin
    movers.value = data.movers || []
  } catch (e: any) {
    if (e?.response?.status === 503) {
      unavailable.value = true
      loadError.value = e.response.data?.error || 'Mover search is not available right now.'
    } else {
      loadError.value = e?.response?.data?.error || 'Could not search for movers. Please try again.'
    }
  } finally {
    loading.value = false
  }
}

function toggle(placeId: string) {
  if (results.value) return
  const next = new Set(selected.value)
  if (next.has(placeId)) {
    next.delete(placeId)
  } else {
    if (next.size >= MAX_PICKS) return
    next.add(placeId)
  }
  selected.value = next
}

async function sendInvites() {
  if (!canSend.value) return
  sending.value = true
  sendError.value = ''
  try {
    const selections = movers.value
      .filter((m) => selected.value.has(m.placeId))
      .map((m) => ({ place_id: m.placeId, name: m.name }))
    const { data } = await axios.post(
      `${core_url}/api/discover/invite`,
      { moveId: moveId.value, selections, message: message.value.trim() || undefined },
      { headers: authHeaders() }
    )
    results.value = data.results
  } catch (e: any) {
    sendError.value = e?.response?.data?.error || 'Could not send your invites. Please try again.'
  } finally {
    sending.value = false
  }
}

async function copyMessage(r: InviteResult) {
  if (!r.copyText) return
  try {
    await navigator.clipboard.writeText(r.copyText)
    copiedFor.value = r.placeId
    setTimeout(() => { if (copiedFor.value === r.placeId) copiedFor.value = null }, 2000)
  } catch {
    /* clipboard denied — the text is visible to select manually */
  }
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/items')
}

const forwardResults = computed(() => (results.value || []).filter((r) => r.delivery === 'forward'))
</script>

<template>
  <div class="dm-page">
    <header class="dm-header">
      <button class="dm-back" aria-label="Go back" @click="goBack">
        <ArrowLeft :size="20" aria-hidden="true" />
      </button>
      <div class="dm-header-text">
        <h1 class="dm-title">Find movers near you</h1>
        <p v-if="originLabel" class="dm-origin">
          <MapPin :size="14" aria-hidden="true" />
          <span>Near {{ originLabel }}</span>
        </p>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="dm-state" aria-live="polite">
      <div class="dm-spinner" aria-hidden="true"></div>
      <p class="dm-state-text">Searching moving companies near your origin…</p>
    </div>

    <!-- Search unavailable (no Places key / upstream error) — honest, no fakes -->
    <div v-else-if="unavailable" class="dm-state">
      <CircleAlert :size="36" class="dm-state-icon" aria-hidden="true" />
      <h2 class="dm-state-title">Mover search isn't available right now</h2>
      <p class="dm-state-text">{{ loadError }}</p>
      <button class="dm-btn dm-btn--quiet" @click="load">Try again</button>
    </div>

    <!-- Other load errors (no origin address, move not found, …) -->
    <div v-else-if="loadError" class="dm-state">
      <CircleAlert :size="36" class="dm-state-icon" aria-hidden="true" />
      <h2 class="dm-state-title">We couldn't run the search</h2>
      <p class="dm-state-text">{{ loadError }}</p>
      <button class="dm-btn dm-btn--quiet" @click="load">Try again</button>
    </div>

    <!-- Empty results -->
    <div v-else-if="!movers.length" class="dm-state">
      <Search :size="36" class="dm-state-icon" aria-hidden="true" />
      <h2 class="dm-state-title">No moving companies found nearby</h2>
      <p class="dm-state-text">
        Google Places found no moving companies within about 50 km of your origin.
        You can still share your inventory link with any mover directly.
      </p>
    </div>

    <!-- Results after sending -->
    <div v-else-if="results" class="dm-results">
      <div class="dm-results-summary">
        <CircleCheck :size="22" class="dm-results-icon" aria-hidden="true" />
        <p class="dm-results-title">Your inventory is on its way</p>
      </div>
      <p v-if="forwardResults.length" class="dm-honest">
        Google doesn't share business emails, so we can't email the companies below for you —
        forward the message yourself or use their contact form. Each one includes your
        inventory link and their free Nexus Moves invite.
      </p>

      <ul class="dm-result-list">
        <li v-for="r in results" :key="r.placeId" class="dm-result">
          <div class="dm-result-head">
            <span class="dm-result-name">{{ r.name }}</span>
            <span v-if="r.delivery === 'emailed'" class="dm-pill dm-pill--sent">
              <CircleCheck :size="14" aria-hidden="true" /> Sent
            </span>
            <span v-else-if="r.delivery === 'failed'" class="dm-pill dm-pill--failed">
              <CircleAlert :size="14" aria-hidden="true" /> Email failed
            </span>
            <span v-else class="dm-pill dm-pill--forward">Forward yourself</span>
          </div>

          <p v-if="r.delivery === 'emailed'" class="dm-result-note">
            Emailed straight to their Nexus Moves dashboard address.
          </p>

          <template v-if="r.copyText">
            <textarea
              class="dm-copytext"
              :value="r.copyText"
              readonly
              rows="5"
              :aria-label="`Message for ${r.name}`"
            ></textarea>
            <div class="dm-result-actions">
              <button class="dm-btn dm-btn--small" @click="copyMessage(r)">
                <Copy :size="15" aria-hidden="true" />
                {{ copiedFor === r.placeId ? 'Copied' : 'Copy message' }}
              </button>
              <a v-if="r.mailto" class="dm-btn dm-btn--small dm-btn--quiet" :href="r.mailto">
                <Mail :size="15" aria-hidden="true" />
                Open in email
              </a>
            </div>
          </template>
        </li>
      </ul>

      <button class="dm-btn dm-btn--quiet dm-done" @click="goBack">Done</button>
    </div>

    <!-- Mover list + selection -->
    <template v-else>
      <p class="dm-lede">
        Pick up to {{ MAX_PICKS }} companies. We'll send each one your full inventory doc —
        item list, weights, and room videos — so their quotes start accurate.
      </p>

      <ul class="dm-list" role="listbox" aria-label="Moving companies near you" aria-multiselectable="true">
        <li v-for="m in movers" :key="m.placeId">
          <button
            class="dm-card"
            :class="{ 'dm-card--selected': selected.has(m.placeId) }"
            role="option"
            :aria-selected="selected.has(m.placeId)"
            @click="toggle(m.placeId)"
          >
            <span class="dm-check" aria-hidden="true">
              <CircleCheck v-if="selected.has(m.placeId)" :size="22" />
              <span v-else class="dm-check-empty"></span>
            </span>
            <span class="dm-card-body">
              <span class="dm-card-top">
                <span class="dm-card-name">{{ m.name }}</span>
                <span v-if="m.onNexus" class="dm-badge">
                  <BadgeCheck :size="13" aria-hidden="true" /> On Nexus
                </span>
              </span>
              <span class="dm-card-meta">
                <span v-if="m.rating != null" class="dm-rating">
                  <Star :size="13" aria-hidden="true" />
                  {{ m.rating.toFixed(1) }}
                  <span class="dm-rating-count">({{ m.userRatingCount }})</span>
                </span>
                <span v-if="m.distanceKm != null" class="dm-distance">{{ m.distanceKm }} km away</span>
              </span>
              <span v-if="m.address" class="dm-card-address">{{ m.address }}</span>
            </span>
          </button>
        </li>
      </ul>

      <div class="dm-compose">
        <label class="dm-label" for="dm-message">Add a note (optional)</label>
        <textarea
          id="dm-message"
          v-model="message"
          class="dm-message"
          rows="2"
          maxlength="500"
          placeholder="e.g. Moving the first week of June, flexible on dates."
        ></textarea>
      </div>

      <p v-if="sendError" class="dm-send-error" role="alert">{{ sendError }}</p>

      <div class="dm-cta-bar">
        <button class="dm-btn dm-cta" :disabled="!canSend" @click="sendInvites">
          {{ sending
            ? 'Sending…'
            : selectedCount
              ? `Send my inventory to ${selectedCount} compan${selectedCount === 1 ? 'y' : 'ies'}`
              : 'Select companies to continue' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dm-page {
  min-height: 100vh;
  max-width: 640px;
  margin: 0 auto;
  padding: var(--sp-5) var(--sp-5) calc(var(--sp-10) * 2);
  background: var(--bg);
  font-family: var(--font-ui);
  color: var(--text-primary);
}

/* ── Header ─────────────────────────────────────────────── */
.dm-header {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-4);
  margin-bottom: var(--sp-5);
}
.dm-back {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface-card);
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.dm-back:hover { background: var(--surface-hover); }
.dm-back:active { transform: scale(0.97); }
.dm-back:focus-visible { outline: none; box-shadow: var(--focus-ring); }

.dm-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-title-m);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
  line-height: var(--lh-tight);
}
.dm-origin {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  margin: var(--sp-2) 0 0;
  font-size: var(--fs-label);
  color: var(--text-secondary);
}

.dm-lede {
  margin: 0 0 var(--sp-5);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--text-secondary);
}

/* ── States ─────────────────────────────────────────────── */
.dm-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--sp-10) var(--sp-6);
}
.dm-state-icon { color: var(--text-tertiary); }
.dm-state-title {
  margin: var(--sp-4) 0 0;
  font-family: var(--font-display);
  font-size: var(--fs-title-s);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
}
.dm-state-text {
  margin: var(--sp-3) 0 0;
  max-width: 44ch;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--text-secondary);
}
.dm-state .dm-btn { margin-top: var(--sp-6); width: auto; }

.dm-spinner {
  width: 36px;
  height: 36px;
  border-radius: var(--r-pill);
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  animation: dm-spin 0.9s linear infinite;
}
@keyframes dm-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dm-spinner { animation: none; } }

/* ── Mover cards ────────────────────────────────────────── */
.dm-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.dm-card {
  display: flex;
  width: 100%;
  text-align: left;
  align-items: flex-start;
  gap: var(--sp-4);
  background: var(--surface-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  padding: var(--sp-4) var(--sp-5);
  cursor: pointer;
  font-family: var(--font-ui);
  color: var(--text-primary);
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    background-color var(--dur-fast) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard);
}
.dm-card:hover { border-color: var(--accent); }
.dm-card:active { transform: scale(0.97); }
.dm-card:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.dm-card--selected {
  border-color: var(--accent);
  background: var(--accent-quiet);
}

.dm-check { flex: none; display: inline-flex; margin-top: 2px; color: var(--accent); }
.dm-check-empty {
  display: block;
  width: 22px;
  height: 22px;
  border: 1.5px solid var(--border);
  border-radius: var(--r-pill);
  background: var(--surface-card);
}

.dm-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
.dm-card-top { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.dm-card-name { font-size: var(--fs-body); font-weight: var(--fw-bold); }
.dm-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--fs-micro);
  font-weight: var(--fw-semibold);
  color: var(--accent);
  background: var(--accent-quiet);
  border: 1px solid var(--accent-quiet-2);
  border-radius: var(--r-pill);
  padding: 2px var(--sp-3);
  white-space: nowrap;
}
.dm-card-meta {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  font-size: var(--fs-label);
  color: var(--text-secondary);
}
.dm-rating { display: inline-flex; align-items: center; gap: 3px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.dm-rating svg { color: var(--accent); }
.dm-rating-count { font-weight: var(--fw-regular); color: var(--text-tertiary); }
.dm-card-address {
  font-size: var(--fs-label);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Compose + CTA ──────────────────────────────────────── */
.dm-compose { margin-top: var(--sp-6); }
.dm-label {
  display: block;
  margin-bottom: var(--sp-2);
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
}
.dm-message,
.dm-copytext {
  width: 100%;
  border: 1.5px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface-card);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  padding: var(--sp-3) var(--sp-4);
  resize: vertical;
}
.dm-message:focus-visible,
.dm-copytext:focus-visible { outline: none; border-color: var(--accent); box-shadow: var(--focus-ring); }

.dm-send-error {
  margin: var(--sp-4) 0 0;
  background: var(--danger-quiet);
  border: 1px solid color-mix(in oklab, var(--danger) 35%, transparent);
  color: var(--danger);
  border-radius: var(--r-md);
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--fs-label);
  font-weight: var(--fw-medium);
}

.dm-cta-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: var(--sp-4) var(--sp-5) calc(var(--sp-4) + env(safe-area-inset-bottom, 0px));
  background: var(--bg);
  border-top: 1px solid var(--border);
}
.dm-cta { max-width: 600px; margin: 0 auto; display: block; }

.dm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  width: 100%;
  border: 0;
  border-radius: var(--r-md);
  background: var(--accent);
  color: var(--text-on-accent);
  font-family: var(--font-ui);
  font-weight: var(--fw-bold);
  font-size: var(--fs-body);
  padding: 12px 20px;
  cursor: pointer;
  text-decoration: none;
  transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.dm-btn:hover { background: var(--accent-hover); }
.dm-btn:active { transform: scale(0.97); }
.dm-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.dm-btn:disabled { opacity: 0.45; cursor: default; }
.dm-btn--quiet {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
.dm-btn--quiet:hover { background: var(--surface-hover); }
.dm-btn--small { width: auto; padding: 8px 14px; font-size: var(--fs-label); }

/* ── Results ────────────────────────────────────────────── */
.dm-results { display: flex; flex-direction: column; }
.dm-results-summary {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  background: var(--success-quiet);
  border: 1px solid color-mix(in oklab, var(--success) 30%, transparent);
  border-radius: var(--r-lg);
  padding: var(--sp-4) var(--sp-5);
}
.dm-results-icon { color: var(--success); flex: none; }
.dm-results-title { margin: 0; font-weight: var(--fw-bold); font-size: var(--fs-body); }

.dm-honest {
  margin: var(--sp-4) 0 0;
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--text-secondary);
}

.dm-result-list {
  list-style: none;
  margin: var(--sp-5) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.dm-result {
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  padding: var(--sp-4) var(--sp-5);
}
.dm-result-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); flex-wrap: wrap; }
.dm-result-name { font-weight: var(--fw-bold); font-size: var(--fs-body); }
.dm-result-note { margin: var(--sp-2) 0 0; font-size: var(--fs-label); color: var(--text-secondary); }

.dm-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-micro);
  font-weight: var(--fw-semibold);
  border-radius: var(--r-pill);
  padding: 3px var(--sp-3);
  white-space: nowrap;
}
.dm-pill--sent { color: var(--success); background: var(--success-quiet); }
.dm-pill--failed { color: var(--danger); background: var(--danger-quiet); }
.dm-pill--forward { color: var(--accent); background: var(--accent-quiet); }

.dm-copytext { margin-top: var(--sp-3); font-size: var(--fs-label); }
.dm-result-actions { display: flex; gap: var(--sp-3); margin-top: var(--sp-3); }

.dm-done { margin-top: var(--sp-6); }
</style>
