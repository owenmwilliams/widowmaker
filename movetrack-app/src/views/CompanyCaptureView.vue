<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { API_BASE_URL } from '../config/api'
import {
  Video, Sun, DoorOpen, Timer, Check, RotateCcw, Plus, X,
  LoaderCircle, TriangleAlert, Send, Sparkles, ArrowLeft, ShieldCheck,
} from 'lucide-vue-next'

/* ============================================================
   Company capture link — /c/:companyToken (issue #96).
   A moving company's customer opens this on their phone, enters
   email + consent, and records ONE VIDEO PER ROOM in the browser
   as a guest (no account, no OTP). Scans run through the normal
   pipeline; "I'm done" sends the inventory share link to the
   company and shows the customer their copy.

   Mobile-first, light-theme, semantic tokens only.
   ============================================================ */

const route = useRoute()
const core_url = API_BASE_URL
const companyToken = String(route.params.companyToken || '')

// Same env pattern as MobileGetApp.vue: TestFlight public link during beta,
// App Store link after launch; unset shows the private-beta notice.
const iosAppUrl: string = import.meta.env.VITE_IOS_APP_URL || ''

type RoomStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'failed'
type Room = {
  name: string
  status: RoomStatus
  progress: number        // 0..100 while uploading
  jobId: string | null
  itemCount: number | null
  error: string | null
}

type Phase = 'loading' | 'landing' | 'capture' | 'questions' | 'price' | 'done' | 'invalid'

// ── Intake quote types (#107) ───────────────────────────────
type QuestionOption = { value: string; label: string }
type Question = {
  id: string
  label: string
  type: 'chips' | 'address' | 'date'
  options?: QuestionOption[]
  placeholder?: string
}
type LineItem = { key: string; label: string; amountLow: number; amountHigh: number }
type TrustBlock = {
  legalName: string; dba?: string; stateLicense: string; usDot: string
  liabilityPerLb: number; workedExample: string; fullValueOption?: string
  depositRule: string; clockRules: string; regulatorUrl?: string
}
type Quote = {
  quoteId: string
  company: { name: string }
  crew: number
  hourlyRate: number
  hours: { low: number; high: number }
  cuFtSource: 'inventory' | 'bedrooms'
  lineItems: LineItem[]
  rangeLow: number
  rangeHigh: number
  nte: number
  deposit: { amount: number; refundWindowDays: number | null }
  status: 'quoted' | 'review_required'
  reviewReasons: string[]
  trustBlock: TrustBlock
}

const phase = ref<Phase>('loading')
const companyName = ref('')
const invalidMessage = ref('')

// Attribution (#98): the embeddable widget links here with ?src=widget; a
// pasted link or a mailed link may carry src=link / src=email. Persisted on
// the capture session via /start. Junk values are sent as-is — the server
// nulls anything outside its enum rather than failing the start.
const source = typeof route.query.src === 'string' && route.query.src ? route.query.src : null

// ── Landing form ─────────────────────────────────────────────
const email = ref(typeof route.query.email === 'string' ? route.query.email : '')
const consent = ref(false)
const starting = ref(false)
const startError = ref<string | null>(null)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const canStart = computed(() => EMAIL_RE.test(email.value.trim()) && consent.value && !starting.value)

// ── Capture state ────────────────────────────────────────────
const guestToken = ref<string | null>(null)
const sessionId = ref<string | null>(null)
const rooms = reactive<Room[]>([])
const newRoom = ref('')
const banner = ref<string | null>(null)     // caps / transient errors, friendly copy
const completing = ref(false)
const shareUrl = ref<string | null>(null)

// ── Intake quote state (#107) ───────────────────────────────
const questions = ref<Question[]>([])
const answers = reactive<Record<string, string>>({})
const questionsLoading = ref(false)
const quoteError = ref<string | null>(null)
const quoting = ref(false)
const quote = ref<Quote | null>(null)

const chipQuestions = computed(() => questions.value.filter((q) => q.type === 'chips'))
const canQuote = computed(() =>
  !quoting.value && chipQuestions.value.every((q) => !!answers[q.id])
)

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

async function openQuestions() {
  quoteError.value = null
  questionsLoading.value = true
  phase.value = 'questions'
  try {
    const { data } = await axios.get(
      `${core_url}/api/capture/${companyToken}/intake-questions`,
      { headers: authHeaders() }
    )
    questions.value = data.questions
    // Drop stale answers for questions the API no longer asks (R2).
    for (const key of Object.keys(answers)) {
      if (!data.questions.some((q: Question) => q.id === key)) delete answers[key]
    }
  } catch (e: any) {
    quoteError.value = friendly(e, "Couldn't load the questions. Please try again.")
  } finally {
    questionsLoading.value = false
  }
}

async function getPrice() {
  if (!canQuote.value) return
  quoting.value = true
  quoteError.value = null
  try {
    const { data } = await axios.post(
      `${core_url}/api/capture/${companyToken}/quote`,
      { answers: { ...answers } },
      { headers: authHeaders() }
    )
    quote.value = data
    phase.value = 'price'
    saveState()
  } catch (e: any) {
    quoteError.value = friendly(e, "Couldn't price your move. Please try again.")
  } finally {
    quoting.value = false
  }
}

function backToCapture() {
  quoteError.value = null
  phase.value = 'capture'
}

const ROOM_SUGGESTIONS = ['Kitchen', 'Living Room', 'Bedroom 1', 'Bedroom 2', 'Garage', 'Basement']
const suggestions = computed(() =>
  ROOM_SUGGESTIONS.filter((s) => !rooms.some((r) => r.name.toLowerCase() === s.toLowerCase()))
)
const doneCount = computed(() => rooms.filter((r) => r.status === 'done').length)
const busyCount = computed(() => rooms.filter((r) => r.status === 'uploading' || r.status === 'processing').length)
const canComplete = computed(() => doneCount.value > 0 && busyCount.value === 0 && !completing.value)

// ── Persistence: a page reload resumes mid-walkthrough ───────
const STORAGE_KEY = `nexus-capture:${companyToken}`

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      guestToken: guestToken.value,
      sessionId: sessionId.value,
      email: email.value,
      shareUrl: shareUrl.value,
      quote: quote.value,
      phase: phase.value === 'done' ? 'done' : phase.value === 'price' ? 'price' : 'capture',
      rooms: rooms.map((r) => ({
        name: r.name,
        // an interrupted upload can't resume (the File is gone) — it re-arms
        status: r.status === 'uploading' ? 'idle' : r.status,
        jobId: r.jobId,
        itemCount: r.itemCount,
      })),
    }))
  } catch { /* storage full/blocked — resume just won't work */ }
}

function clearState() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

watch([rooms, shareUrl, quote], () => {
  if (['capture', 'questions', 'price', 'done'].includes(phase.value)) saveState()
}, { deep: true })

// ── API helpers ──────────────────────────────────────────────
const authHeaders = () => ({ Authorization: `Bearer ${guestToken.value}` })

function friendly(e: any, fallback: string): string {
  return e?.response?.data?.error || fallback
}

onMounted(async () => {
  try {
    const { data } = await axios.get(`${core_url}/api/capture/${companyToken}`)
    companyName.value = data.name
  } catch (e: any) {
    invalidMessage.value = friendly(e, 'This link could not be loaded. Please try again.')
    phase.value = 'invalid'
    return
  }

  // Resume a session if one is stored for this link.
  let stored: any = null
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch { /* ignore */ }
  if (stored?.guestToken && stored?.sessionId) {
    guestToken.value = stored.guestToken
    sessionId.value = stored.sessionId
    email.value = stored.email || email.value
    shareUrl.value = stored.shareUrl || null
    quote.value = stored.quote || null
    try {
      const { data } = await axios.get(`${core_url}/api/capture/${companyToken}/session`, { headers: authHeaders() })
      for (const r of (stored.rooms || [])) {
        rooms.push({ name: r.name, status: r.status, progress: 0, jobId: r.jobId || null, itemCount: r.itemCount ?? null, error: null })
      }
      if (stored.phase === 'done' && shareUrl.value) {
        phase.value = 'done'
      } else if (data.status === 'completed' && shareUrl.value) {
        phase.value = 'done'
      } else if (stored.phase === 'price' && quote.value) {
        phase.value = 'price'
      } else {
        phase.value = 'capture'
        // Pick polling back up for rooms that were mid-scan.
        for (const r of rooms) {
          if (r.status === 'processing' && r.jobId) pollJob(r)
        }
      }
      return
    } catch {
      // Session gone/expired — fall through to a fresh landing.
      guestToken.value = null
      sessionId.value = null
      rooms.splice(0)
      clearState()
    }
  }
  phase.value = 'landing'
})

// ── Landing → start ──────────────────────────────────────────
async function start() {
  if (!canStart.value) return
  starting.value = true
  startError.value = null
  try {
    const { data } = await axios.post(`${core_url}/api/capture/${companyToken}/start`, {
      email: email.value.trim(),
      consent: consent.value,
      source,
    })
    guestToken.value = data.token
    sessionId.value = data.sessionId
    phase.value = 'capture'
    saveState()
  } catch (e: any) {
    startError.value = friendly(e, "Couldn't start your session. Please try again.")
  } finally {
    starting.value = false
  }
}

// ── Rooms ────────────────────────────────────────────────────
function addRoom(name?: string) {
  const n = (name ?? newRoom.value).trim().slice(0, 60)
  if (!n) return
  if (rooms.some((r) => r.name.toLowerCase() === n.toLowerCase())) { newRoom.value = ''; return }
  rooms.push({ name: n, status: 'idle', progress: 0, jobId: null, itemCount: null, error: null })
  newRoom.value = ''
}

function removeRoom(idx: number) {
  const r = rooms[idx]
  if (r.status === 'uploading' || r.status === 'processing') return
  rooms.splice(idx, 1)
}

// ── Upload + scan per room ───────────────────────────────────
const fileInputs = ref<Record<string, HTMLInputElement | null>>({})
function setFileInput(name: string, el: any) { fileInputs.value[name] = el as HTMLInputElement | null }
function pickVideo(room: Room) {
  banner.value = null
  fileInputs.value[room.name]?.click()
}

async function onFilePicked(room: Room, ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-picking the same file
  if (!file) return

  const mimeType = file.type || 'video/mp4'
  room.status = 'uploading'
  room.progress = 0
  room.error = null
  room.itemCount = null

  try {
    // 1. Signed PUT reservation (server enforces the 20-video / 500MB caps).
    const { data: reservation } = await axios.post(
      `${core_url}/api/capture/${companyToken}/upload-url`,
      { mimeType, filename: file.name || `${room.name}.mp4`, byteLength: file.size },
      { headers: authHeaders() }
    )

    // 2. The bytes go straight to storage, with real progress.
    await axios.put(reservation.uploadUrl, file, {
      headers: { 'Content-Type': mimeType },
      onUploadProgress: (p) => {
        if (p.total) room.progress = Math.round((p.loaded / p.total) * 100)
      },
    })

    // 3. Register the scan job — the room name the customer typed is the hint.
    const { data: job } = await axios.post(
      `${core_url}/api/capture/${companyToken}/scan-jobs`,
      { mediaUrl: reservation.url, mimeType, roomHint: room.name, idempotencyKey: `room-${room.name}-${Date.now()}` },
      { headers: authHeaders() }
    )
    room.jobId = job.id
    room.status = 'processing'
    pollJob(room)
  } catch (e: any) {
    room.status = 'idle'
    const status = e?.response?.status
    if (status === 403 || status === 429) {
      banner.value = friendly(e, 'That upload was over the limit for this session.')
    } else {
      room.status = 'failed'
      room.error = friendly(e, "Upload didn't go through. Check your connection and try again.")
    }
  }
}

// ── Polling ──────────────────────────────────────────────────
const timers = new Set<ReturnType<typeof setTimeout>>()
onBeforeUnmount(() => { timers.forEach(clearTimeout) })

function pollJob(room: Room) {
  if (!room.jobId) return
  const tick = async () => {
    try {
      const { data } = await axios.get(
        `${core_url}/api/capture/${companyToken}/scan-jobs/${room.jobId}`,
        { headers: authHeaders() }
      )
      if (data.status === 'completed') {
        room.status = 'done'
        room.itemCount = typeof data.committedCount === 'number'
          ? data.committedCount
          : (data.result?.items?.length ?? null)
        return
      }
      if (data.status === 'failed') {
        room.status = 'failed'
        room.error = 'The scan failed — film this room again and re-upload.'
        return
      }
    } catch { /* transient — keep polling */ }
    const t = setTimeout(tick, 5000)
    timers.add(t)
  }
  tick()
}

// ── Complete ─────────────────────────────────────────────────
async function complete() {
  if (!canComplete.value) return
  completing.value = true
  banner.value = null
  try {
    const { data } = await axios.post(
      `${core_url}/api/capture/${companyToken}/complete`,
      {},
      { headers: authHeaders() }
    )
    shareUrl.value = data.shareUrl
    phase.value = 'done'
    saveState()
  } catch (e: any) {
    banner.value = friendly(e, "Couldn't finish up. Please try again.")
  } finally {
    completing.value = false
  }
}
</script>

<template>
  <div class="cap">

    <!-- Loading -->
    <div v-if="phase === 'loading'" class="cap__center">
      <LoaderCircle :size="28" class="spin" aria-hidden="true" />
    </div>

    <!-- Invalid / inactive link -->
    <div v-else-if="phase === 'invalid'" class="cap__center">
      <div class="cap__card cap__card--pad">
        <TriangleAlert :size="28" aria-hidden="true" class="cap__warn-icon" />
        <h1 class="cap__title-s">Link not active</h1>
        <p class="cap__muted">{{ invalidMessage }}</p>
      </div>
    </div>

    <!-- Landing -->
    <div v-else-if="phase === 'landing'" class="cap__page">
      <header class="cap__brand">Nexus Moves</header>

      <h1 class="cap__headline">
        {{ companyName }} uses Nexus&nbsp;Moves to quote your move accurately
      </h1>
      <p class="cap__sub">
        Film each room of your home — about a minute per room — and
        {{ companyName }} gets a complete, quote-ready inventory. No app,
        no account.
      </p>

      <section class="cap__card cap__rules" aria-label="How to film">
        <h2 class="cap__rules-title">Four rules for a great walkthrough</h2>
        <ul class="cap__rules-list">
          <li><Video :size="18" aria-hidden="true" /><span><strong>Narrate as you go</strong> — say what things are.</span></li>
          <li><Sun :size="18" aria-hidden="true" /><span><strong>Lights on</strong> — brighter rooms scan better.</span></li>
          <li><DoorOpen :size="18" aria-hidden="true" /><span><strong>Pan slowly</strong> — open closets and cabinets.</span></li>
          <li><Timer :size="18" aria-hidden="true" /><span><strong>30–90 seconds</strong> per room is plenty.</span></li>
        </ul>
      </section>

      <form class="cap__form" @submit.prevent="start">
        <label class="cap__label" for="cap-email">Your email</label>
        <input
          id="cap-email"
          v-model="email"
          class="cap__input"
          type="email"
          inputmode="email"
          autocomplete="email"
          placeholder="you@example.com"
          required
        />

        <label class="cap__consent">
          <input v-model="consent" type="checkbox" />
          <span>My videos may be used to improve Nexus&nbsp;Moves</span>
        </label>

        <p v-if="startError" class="cap__error" role="alert">{{ startError }}</p>

        <button class="cap__cta" type="submit" :disabled="!canStart">
          <span v-if="starting"><LoaderCircle :size="18" class="spin" aria-hidden="true" /> Starting…</span>
          <span v-else>Start in your browser</span>
        </button>

        <a v-if="iosAppUrl" :href="iosAppUrl" class="cap__cta-secondary">Get the iPhone app</a>
        <div v-else class="cap__beta">
          <p class="cap__beta-title">Prefer an app? We're in private beta on iPhone.</p>
          <p class="cap__beta-body">Have an invite? Open your TestFlight link on this phone — use the same email so your videos connect.</p>
        </div>
      </form>
    </div>

    <!-- Capture -->
    <div v-else-if="phase === 'capture'" class="cap__page">
      <header class="cap__brand">Nexus Moves</header>
      <h1 class="cap__title-s">Film one video per room</h1>
      <p class="cap__sub">
        Add a room, then record or pick a video of it. Narrate, lights on,
        pan slowly, 30–90 seconds.
      </p>

      <p v-if="banner" class="cap__banner" role="alert">{{ banner }}</p>

      <!-- Instant price path (#107): films rooms AND/OR answers questions -->
      <button type="button" class="cap__quote-offer" @click="openQuestions">
        <Sparkles :size="18" aria-hidden="true" />
        <span class="cap__quote-offer-text">
          <strong>Want your price now?</strong>
          Answer a few questions and get {{ companyName }}'s rate instantly — filming makes it even tighter.
        </span>
      </button>

      <div class="cap__addrow">
        <input
          v-model="newRoom"
          class="cap__input cap__input--grow"
          type="text"
          placeholder="Add a room — Kitchen, Bedroom 1…"
          @keyup.enter="addRoom()"
        />
        <button class="cap__addbtn" type="button" aria-label="Add room" :disabled="!newRoom.trim()" @click="addRoom()">
          <Plus :size="20" aria-hidden="true" />
        </button>
      </div>

      <div v-if="suggestions.length" class="cap__chips">
        <button v-for="s in suggestions" :key="s" type="button" class="cap__chip" @click="addRoom(s)">{{ s }}</button>
      </div>

      <ul class="cap__rooms">
        <li v-for="(room, idx) in rooms" :key="room.name" class="cap__room cap__card">
          <div class="cap__room-main">
            <span class="cap__room-name">{{ room.name }}</span>

            <span v-if="room.status === 'idle'" class="cap__room-state cap__muted">Not filmed yet</span>
            <span v-else-if="room.status === 'uploading'" class="cap__room-state">Uploading… {{ room.progress }}%</span>
            <span v-else-if="room.status === 'processing'" class="cap__room-state">
              <LoaderCircle :size="14" class="spin" aria-hidden="true" /> Finding your items…
            </span>
            <span v-else-if="room.status === 'done'" class="cap__room-state cap__room-state--done">
              <Check :size="14" aria-hidden="true" />
              {{ room.itemCount != null ? `${room.itemCount} item${room.itemCount === 1 ? '' : 's'} found` : 'Done' }}
            </span>
            <span v-else class="cap__room-state cap__room-state--failed">{{ room.error }}</span>

            <div v-if="room.status === 'uploading'" class="cap__progress" role="progressbar" :aria-valuenow="room.progress" aria-valuemin="0" aria-valuemax="100">
              <div class="cap__progress-fill" :style="{ width: room.progress + '%' }"></div>
            </div>
          </div>

          <div class="cap__room-actions">
            <button
              v-if="room.status === 'idle' || room.status === 'failed'"
              type="button" class="cap__record"
              @click="pickVideo(room)"
            >
              <component :is="room.status === 'failed' ? RotateCcw : Video" :size="16" aria-hidden="true" />
              {{ room.status === 'failed' ? 'Try again' : 'Record' }}
            </button>
            <button
              v-if="room.status === 'idle' || room.status === 'failed'"
              type="button" class="cap__remove" aria-label="Remove room"
              @click="removeRoom(idx)"
            >
              <X :size="16" aria-hidden="true" />
            </button>
          </div>

          <input
            :ref="(el) => setFileInput(room.name, el)"
            class="cap__file"
            type="file"
            accept="video/*"
            capture="environment"
            @change="onFilePicked(room, $event)"
          />
        </li>
      </ul>

      <p v-if="!rooms.length" class="cap__muted cap__empty">Start with the room you're standing in.</p>

      <button class="cap__cta cap__cta--accent" type="button" :disabled="!canComplete" @click="complete">
        <span v-if="completing"><LoaderCircle :size="18" class="spin" aria-hidden="true" /> Sending…</span>
        <span v-else><Send :size="18" aria-hidden="true" /> I'm done — send to {{ companyName }}</span>
      </button>
      <p v-if="busyCount" class="cap__muted cap__hint">Hang tight — {{ busyCount }} room{{ busyCount === 1 ? ' is' : 's are' }} still processing.</p>
    </div>

    <!-- Questions (#107) — one screen, big tap targets -->
    <div v-else-if="phase === 'questions'" class="cap__page">
      <header class="cap__brand">Nexus Moves</header>
      <button type="button" class="cap__back" @click="backToCapture">
        <ArrowLeft :size="16" aria-hidden="true" /> Back to filming
      </button>
      <h1 class="cap__title-s">A few quick questions</h1>
      <p class="cap__sub">{{ companyName }} prices from its own rate card — this takes under a minute.</p>

      <div v-if="questionsLoading" class="cap__center-inline">
        <LoaderCircle :size="24" class="spin" aria-hidden="true" />
      </div>

      <template v-else>
        <div v-for="q in questions" :key="q.id" class="cap__q">
          <p class="cap__q-label">{{ q.label }}</p>

          <div v-if="q.type === 'chips'" class="cap__chips">
            <button
              v-for="opt in q.options" :key="opt.value" type="button"
              class="cap__chip cap__chip--big"
              :class="{ 'cap__chip--on': answers[q.id] === opt.value }"
              :aria-pressed="answers[q.id] === opt.value"
              @click="answers[q.id] = opt.value"
            >{{ opt.label }}</button>
          </div>

          <input
            v-else-if="q.type === 'address'"
            v-model="answers[q.id]"
            class="cap__input"
            type="text"
            autocomplete="street-address"
            :placeholder="q.placeholder || ''"
          />

          <input
            v-else-if="q.type === 'date'"
            v-model="answers[q.id]"
            class="cap__input"
            type="date"
          />
        </div>

        <p v-if="quoteError" class="cap__error" role="alert">{{ quoteError }}</p>

        <button class="cap__cta" type="button" :disabled="!canQuote" @click="getPrice">
          <span v-if="quoting"><LoaderCircle :size="18" class="spin" aria-hidden="true" /> Pricing your move…</span>
          <span v-else>Get my price</span>
        </button>
      </template>
    </div>

    <!-- Price card (#107) — the quote and its trust block are ONE card -->
    <div v-else-if="phase === 'price' && quote" class="cap__page">
      <header class="cap__brand">Nexus Moves</header>
      <button type="button" class="cap__back" @click="backToCapture">
        <ArrowLeft :size="16" aria-hidden="true" /> Add room videos
      </button>

      <div class="cap__card cap__price">
        <p class="cap__price-company">{{ quote.company.name }}</p>
        <h1 class="cap__price-headline">
          {{ quote.status === 'review_required' ? 'Your estimate' : 'Your price' }}
        </h1>

        <p class="cap__price-range">
          <span class="cap__price-num">{{ money(quote.rangeLow) }}</span>
          <span class="cap__price-dash">–</span>
          <span class="cap__price-num">{{ money(quote.rangeHigh) }}</span>
        </p>
        <p class="cap__price-crew">
          {{ quote.crew }}-person crew · {{ quote.hours.low }}–{{ quote.hours.high }} hours
        </p>

        <p v-if="quote.status === 'review_required'" class="cap__price-review">
          An estimator will confirm this price before it's final —
          {{ quote.reviewReasons.join(' ') }}
        </p>

        <ul class="cap__price-lines">
          <li v-for="li in quote.lineItems" :key="li.key">
            <span>{{ li.label }}</span>
            <span class="cap__price-amt">
              {{ li.amountLow === li.amountHigh ? money(li.amountLow) : `${money(li.amountLow)}–${money(li.amountHigh)}` }}
            </span>
          </li>
          <li v-if="quote.nte" class="cap__price-nte">
            <span>Not to exceed</span>
            <span class="cap__price-amt">{{ money(quote.nte) }}</span>
          </li>
        </ul>

        <!-- Trust block: visually inseparable from the price -->
        <div class="cap__trust">
          <p class="cap__trust-head">
            <ShieldCheck :size="15" aria-hidden="true" />
            Who's quoting you
          </p>
          <dl class="cap__trust-grid">
            <div>
              <dt>Licensed as</dt>
              <dd>{{ quote.trustBlock.legalName }}<template v-if="quote.trustBlock.dba"> · dba {{ quote.trustBlock.dba }}</template></dd>
            </div>
            <div>
              <dt>Licenses</dt>
              <dd>{{ quote.trustBlock.stateLicense }} · {{ quote.trustBlock.usDot }}</dd>
            </div>
            <div>
              <dt>Included coverage</dt>
              <dd>${{ quote.trustBlock.liabilityPerLb.toFixed(2) }}/lb — {{ quote.trustBlock.workedExample }}<template v-if="quote.trustBlock.fullValueOption"> · {{ quote.trustBlock.fullValueOption }}</template></dd>
            </div>
            <div>
              <dt>Deposit</dt>
              <dd>{{ quote.trustBlock.depositRule }}</dd>
            </div>
            <div>
              <dt>The clock</dt>
              <dd>{{ quote.trustBlock.clockRules }}</dd>
            </div>
          </dl>
          <a
            v-if="quote.trustBlock.regulatorUrl"
            :href="quote.trustBlock.regulatorUrl"
            class="cap__trust-reg" target="_blank" rel="noopener"
          >Verify with the state regulator</a>
        </div>
      </div>

      <p class="cap__price-next">
        Book a call or reply to {{ quote.company.name }}'s email to lock it in.
        <template v-if="doneCount > 0"> Your full inventory was sent to {{ quote.company.name }}.</template>
      </p>

      <button v-if="doneCount === 0" class="cap__cta cap__cta--accent" type="button" @click="backToCapture">
        <Video :size="18" aria-hidden="true" /> Film your rooms for a tighter quote
      </button>
      <button v-else-if="canComplete" class="cap__cta cap__cta--accent" type="button" :disabled="!canComplete" @click="complete">
        <Send :size="18" aria-hidden="true" /> I'm done — send to {{ companyName }}
      </button>
    </div>

    <!-- Done -->
    <div v-else class="cap__center">
      <div class="cap__card cap__card--pad cap__done">
        <span class="cap__done-badge"><Check :size="26" aria-hidden="true" /></span>
        <h1 class="cap__title-s">Sent to {{ companyName }}</h1>
        <p class="cap__muted">
          They received your full inventory with your room videos and will
          follow up with a quote. Here's your copy:
        </p>
        <a v-if="shareUrl" :href="shareUrl" class="cap__share-link">{{ shareUrl }}</a>
        <p class="cap__muted cap__hint">
          Filmed {{ doneCount }} room{{ doneCount === 1 ? '' : 's' }} · your inventory stays available at this link
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cap {
  min-height: 100dvh;
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--font-ui);
}
.cap__page {
  max-width: 480px;
  margin: 0 auto;
  padding: var(--sp-6) var(--sp-5) var(--sp-9);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.cap__center {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-6);
}
.cap__brand {
  font-family: var(--font-display);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-display);
  font-size: var(--fs-label);
  color: var(--text-tertiary);
  text-transform: uppercase;
}
.cap__headline {
  font-family: var(--font-display);
  font-size: var(--fs-title-l);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-display);
  line-height: var(--lh-tight);
  margin: 0;
}
.cap__title-s {
  font-family: var(--font-display);
  font-size: var(--fs-title-m);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
  margin: 0;
}
.cap__sub {
  color: var(--text-secondary);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  margin: 0;
}
.cap__muted { color: var(--text-secondary); font-size: var(--fs-label); line-height: var(--lh-body); }
.cap__card {
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-xs);
}
.cap__card--pad {
  padding: var(--sp-7) var(--sp-6);
  max-width: 420px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
}
.cap__warn-icon { color: var(--warning-ink); }

/* Rules */
.cap__rules { padding: var(--sp-5) var(--sp-5); }
.cap__rules-title {
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  color: var(--text-secondary);
  margin: 0 0 var(--sp-3);
}
.cap__rules-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.cap__rules-list li {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--text-secondary);
}
.cap__rules-list li svg { flex: none; margin-top: 2px; color: var(--accent); }
.cap__rules-list strong { color: var(--text-primary); font-weight: var(--fw-semibold); }

/* Form */
.cap__form { display: flex; flex-direction: column; gap: var(--sp-3); }
.cap__label { font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-secondary); }
.cap__input {
  width: 100%;
  box-sizing: border-box;
  min-height: var(--tap-min);
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface-card);
  color: var(--text-primary);
  font-size: var(--fs-body-l);
  font-family: var(--font-ui);
}
.cap__input:focus-visible { outline: none; box-shadow: var(--focus-ring); border-color: var(--accent); }
.cap__consent {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  font-size: var(--fs-label);
  color: var(--text-secondary);
  line-height: var(--lh-body);
  cursor: pointer;
}
.cap__consent input { width: 18px; height: 18px; margin-top: 1px; accent-color: var(--accent); }
.cap__error { color: var(--danger); font-size: var(--fs-label); margin: 0; }
.cap__banner {
  background: var(--warning-surface);
  color: var(--warning-ink);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  margin: 0;
}

/* CTAs — the ONE shimmer CTA is the landing primary. */
.cap__cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  min-height: var(--tap-min);
  padding: var(--sp-4) var(--sp-6);
  border: none;
  border-radius: var(--r-md);
  background: var(--shimmer);
  color: var(--on-accent);
  font-size: var(--fs-body-l);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
  font-family: var(--font-ui);
  cursor: pointer;
  transition: box-shadow var(--dur-base) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.cap__cta:hover:not(:disabled) { box-shadow: var(--glow-shimmer); }
.cap__cta:active:not(:disabled) { transform: scale(0.97); }
.cap__cta:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.cap__cta:disabled { opacity: 0.45; cursor: default; }
.cap__cta span { display: inline-flex; align-items: center; gap: var(--sp-2); }
.cap__cta--accent { background: var(--accent); margin-top: var(--sp-4); }
.cap__cta--accent:hover:not(:disabled) { background: var(--accent-hover); box-shadow: none; }
.cap__cta-secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap-min);
  padding: var(--sp-3) var(--sp-6);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface-card);
  color: var(--text-primary);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
  text-decoration: none;
  transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.cap__cta-secondary:hover { background: var(--surface-hover); }
.cap__cta-secondary:active { transform: scale(0.97); }
.cap__cta-secondary:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.cap__beta {
  padding: var(--sp-4) var(--sp-5);
  border-radius: var(--r-md);
  background: var(--accent-quiet);
  border: 1px solid var(--border);
}
.cap__beta-title { font-weight: var(--fw-semibold); font-size: var(--fs-label); color: var(--text-primary); margin: 0 0 var(--sp-1); }
.cap__beta-body { color: var(--text-secondary); font-size: var(--fs-label); line-height: var(--lh-body); margin: 0; }

/* Add-room row + chips */
.cap__addrow { display: flex; gap: var(--sp-2); }
.cap__input--grow { flex: 1; }
.cap__addbtn {
  flex: none;
  width: var(--tap-min);
  min-height: var(--tap-min);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--r-md);
  background: var(--accent);
  color: var(--on-accent);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.cap__addbtn:hover:not(:disabled) { background: var(--accent-hover); }
.cap__addbtn:active:not(:disabled) { transform: scale(0.97); }
.cap__addbtn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.cap__addbtn:disabled { opacity: 0.45; cursor: default; }
.cap__chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.cap__chip {
  padding: var(--sp-2) var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: var(--surface-card);
  color: var(--text-secondary);
  font-size: var(--fs-label);
  font-family: var(--font-ui);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.cap__chip:hover { background: var(--surface-hover); color: var(--text-primary); }
.cap__chip:active { transform: scale(0.97); }
.cap__chip:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* Room list */
.cap__rooms { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
.cap__room {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-4);
}
.cap__room-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
.cap__room-name { font-weight: var(--fw-semibold); font-size: var(--fs-body-l); }
.cap__room-state {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--fs-label);
  color: var(--text-secondary);
}
.cap__room-state--done { color: var(--success); font-weight: var(--fw-semibold); }
.cap__room-state--failed { color: var(--danger); }
.cap__progress {
  height: 4px;
  border-radius: var(--r-pill);
  background: var(--surface-sunk);
  overflow: hidden;
  margin-top: var(--sp-1);
}
.cap__progress-fill { height: 100%; background: var(--accent); transition: width var(--dur-fast) var(--ease-standard); }
.cap__room-actions { flex: none; display: flex; align-items: center; gap: var(--sp-2); }
.cap__record {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: var(--tap-min);
  padding: var(--sp-2) var(--sp-4);
  border: none;
  border-radius: var(--r-md);
  background: var(--accent);
  color: var(--on-accent);
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  font-family: var(--font-ui);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.cap__record:hover { background: var(--accent-hover); }
.cap__record:active { transform: scale(0.97); }
.cap__record:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.cap__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-standard);
}
.cap__remove:hover { color: var(--danger); }
.cap__remove:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.cap__file { display: none; }
.cap__empty { text-align: center; padding: var(--sp-5) 0; }
.cap__hint { text-align: center; margin: 0; }

/* Done */
.cap__done-badge {
  width: 52px;
  height: 52px;
  border-radius: var(--r-pill);
  background: var(--success-quiet);
  color: var(--success);
  display: flex;
  align-items: center;
  justify-content: center;
}
.cap__share-link {
  font-size: var(--fs-label);
  color: var(--accent);
  word-break: break-all;
  text-decoration: underline;
  border-radius: var(--r-xs);
}
.cap__share-link:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* Instant price offer (#107) */
.cap__quote-offer {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  text-align: left;
  padding: var(--sp-4) var(--sp-5);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--accent-quiet);
  color: var(--text-secondary);
  font-family: var(--font-ui);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.cap__quote-offer:hover { background: var(--surface-hover); }
.cap__quote-offer:active { transform: scale(0.97); }
.cap__quote-offer:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.cap__quote-offer svg { flex: none; margin-top: 2px; color: var(--accent); }
.cap__quote-offer-text strong { display: block; color: var(--text-primary); font-weight: var(--fw-semibold); font-size: var(--fs-body); }

/* Back link */
.cap__back {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  align-self: flex-start;
  min-height: var(--tap-min);
  padding: 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-family: var(--font-ui);
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  cursor: pointer;
  border-radius: var(--r-xs);
}
.cap__back:hover { color: var(--text-primary); }
.cap__back:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* Question screen (#107) */
.cap__center-inline { display: flex; justify-content: center; padding: var(--sp-7) 0; }
.cap__q { display: flex; flex-direction: column; gap: var(--sp-2); }
.cap__q-label { margin: 0; font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.cap__chip--big { min-height: var(--tap-min); padding: var(--sp-3) var(--sp-5); font-size: var(--fs-body); }
.cap__chip--on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: var(--fw-semibold);
}
.cap__chip--on:hover { background: var(--accent-hover); color: var(--on-accent); }

/* Price card (#107) — the quote and its trust block share ONE card */
.cap__price { padding: var(--sp-6) var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-2); }
.cap__price-company {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--text-secondary);
}
.cap__price-headline {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-title-m);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
}
.cap__price-range {
  margin: var(--sp-2) 0 0;
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  font-family: var(--font-display);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-display);
  font-size: var(--fs-title-l);
  line-height: var(--lh-tight);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.cap__price-dash { color: var(--text-tertiary); }
.cap__price-crew { margin: 0; color: var(--text-secondary); font-size: var(--fs-body); }
.cap__price-review {
  margin: var(--sp-2) 0 0;
  padding: var(--sp-3) var(--sp-4);
  background: var(--warning-surface);
  color: var(--warning-ink);
  border-radius: var(--r-md);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
}
.cap__price-lines {
  list-style: none;
  margin: var(--sp-3) 0 0;
  padding: var(--sp-3) 0 0;
  border-top: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.cap__price-lines li {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-4);
  font-size: var(--fs-label);
  color: var(--text-secondary);
  line-height: var(--lh-body);
}
.cap__price-amt { flex: none; font-variant-numeric: tabular-nums; color: var(--text-primary); }
.cap__price-nte { padding-top: var(--sp-2); border-top: 1px solid var(--border-soft); font-weight: var(--fw-semibold); }
.cap__price-nte span:first-child { color: var(--text-primary); }

/* Trust block — hairline divider, same card, never separable from the price */
.cap__trust { margin-top: var(--sp-4); padding-top: var(--sp-4); border-top: 1px solid var(--border); }
.cap__trust-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-3);
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--text-secondary);
}
.cap__trust-head svg { color: var(--success); }
.cap__trust-grid { margin: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
.cap__trust-grid dt {
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.cap__trust-grid dd {
  margin: 2px 0 0;
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--text-secondary);
}
.cap__trust-reg {
  display: inline-block;
  margin-top: var(--sp-3);
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  color: var(--accent);
  text-decoration: underline;
  border-radius: var(--r-xs);
}
.cap__trust-reg:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.cap__price-next { margin: 0; color: var(--text-secondary); font-size: var(--fs-label); line-height: var(--lh-body); text-align: center; }

/* Motion */
.spin { animation: cap-spin 0.9s linear infinite; }
@keyframes cap-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
  .cap__cta, .cap__cta-secondary, .cap__record, .cap__chip, .cap__addbtn, .cap__quote-offer { transition: none; }
}
</style>
