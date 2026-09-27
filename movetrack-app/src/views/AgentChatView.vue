<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import {
  ShieldCheck, LoaderCircle, RotateCcw, Video, Lock, CalendarCheck, CalendarDays, Check,
} from 'lucide-vue-next'
import { callTool, McpToolError, McpTransportError } from '../utils/mcpClient'
import { API_BASE_URL } from '../config/api'

/* ============================================================
   /agent/:companyToken — the vendor's hero chat widget.

   W1c (#117): the chat IS the agent now. The default brain is
   the model-run converse endpoint (POST /api/agent/:token/
   converse) — free text live from the very first message,
   quick-reply chips suggested by the model, and every card
   (quote, availability, reservation) rendered from the RAW
   tool payload the server sends in RESULT.event. The model
   never renders a number; the cards do (R34 by architecture).

   The #114 deterministic battery lives on, in this same file,
   as the graceful fallback: a 503 {fallback:true} (no model
   key) or two consecutive transport failures switches to it
   MID-conversation, carrying every answer already gathered
   (the converse response's `known` seeds get_intake_questions'
   knownAnswers, so nothing is asked twice). ?brain=det forces
   the battery; ?brain=llm forces the agent.

   Public route, iframe-friendly (the widget's chat variant
   embeds it and listens for our height postMessage). State
   lives in sessionStorage so a reload resumes mid-conversation
   — including the converse conversationId.
   ============================================================ */

const route = useRoute()
const companyToken = String(route.params.companyToken || '')

// ── Types (tool payload shapes — vendor-agent-mcp.md) ────────
type QuestionOption = { value: string; label: string }
type Question = {
  id: string
  label: string
  type: 'chips' | 'address' | 'date' | 'text'
  options?: QuestionOption[]
  placeholder?: string
  source?: string
}
type TrustBlock = {
  legalName: string; dba?: string; stateLicense: string; usDot: string
  liabilityPerLb: number; workedExample: string; fullValueOption?: string
  depositRule: string; clockRules: string; regulatorUrl?: string
}
type CompanyInfo = { name: string; trustBlock: TrustBlock | null; paymentsMode: 'simulated' | 'none' | string }
type LineItem = { key: string; label: string; amountLow: number; amountHigh: number }
type Quote = {
  quoteId: string
  company: { name: string }
  crew: number
  hourlyRate: number
  hours: { low: number; high: number }
  lineItems: LineItem[]
  rangeLow: number
  rangeHigh: number
  nte: number
  deposit: { amount: number; refundWindowDays: number | null }
  status: 'quoted' | 'review_required'
  reviewReasons: string[]
  trustBlock: TrustBlock
}
type Reservation = {
  reservationId: string
  status: string
  requestedDate: string
  expiresAt: string
  company: { name: string }
  quote: { id: string; rangeLow: number; rangeHigh: number; nte: number }
  deposit: { amount: number | null; simulated: boolean; note: string }
}
type Availability = {
  requestedDate: string
  requestedDateOpen: boolean
  reason: 'past_date' | 'blackout' | 'fully_booked' | null
  capacityPerDay: number
  alternatives: string[]
}

// ── Conversation state machine ───────────────────────────────
// llm: the agent chat (free composer + model chips).
// The rest is the #114 deterministic battery, kept verbatim.
type Step =
  | 'llm'             // agent brain running the conversation
  | 'boot'            // fetching company info + questions (det)
  | 'boot_failed'     // dead token / network down before hello
  | 'question'        // asking questions[qIdx] (det)
  | 'email'           // the email gate (det)
  | 'quoting'         // price_quote in flight (det)
  | 'reserve_offer'   // quote shown, offering to lock the date (det)
  | 'deposit'         // simulated card sheet open (both brains)
  | 'reserving'       // reserve_booking in flight (det)
  | 'reserved'        // done
  | 'passed'          // said "not now" after the quote (det)

type RetryKey = 'boot' | 'quote' | 'reserve' | 'llm'
type Msg =
  | { kind: 'bot'; text: string }
  | { kind: 'user'; text: string }
  | { kind: 'notice'; text: string }
  | { kind: 'quote' }
  | { kind: 'availability'; payload: Availability }
  | { kind: 'reserved' }
  | { kind: 'error'; text: string; retry: RetryKey | null }

type Brain = 'llm' | 'det'
const forcedBrain: Brain | null =
  route.query.brain === 'det' ? 'det' : route.query.brain === 'llm' ? 'llm' : null

const brain = ref<Brain>(forcedBrain ?? 'llm')
const step = ref<Step>('boot')
const messages = ref<Msg[]>([])
const typing = ref(false)

const company = ref<CompanyInfo | null>(null)
const questions = ref<Question[]>([])
const qIdx = ref(0)
const answers = reactive<Record<string, string>>({})
const email = ref('')
const quote = ref<Quote | null>(null)
const reservation = ref<Reservation | null>(null)

// Agent-brain state.
const conversationId = ref<string | null>(null)
const chips = ref<string[]>([])
// True only while a converse request is in flight — the cosmetic typing
// animation must never swallow a send.
const busy = ref(false)
let known: Record<string, string> = {}
let lastSent: string | null = null
let transportFails = 0

// Bottom composer inputs.
const textDraft = ref('')
const dateDraft = ref('')
const inputError = ref('')

// Simulated deposit sheet (never touches any payment API).
const cardNumber = ref('')
const cardExp = ref('')
const cardCvc = ref('')
const cardError = ref('')

const companyName = computed(() => company.value?.name || 'the company')
const currentQuestion = computed<Question | null>(() =>
  step.value === 'question' ? questions.value[qIdx.value] ?? null : null)

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const depositPct = computed(() => {
  const q = quote.value
  if (!q || !q.deposit?.amount || !q.rangeLow) return 0
  return Math.round((q.deposit.amount / q.rangeLow) * 100)
})
// The card sheet only exists when this vendor runs SIMULATED payments and
// the quote actually carries a deposit. payments_mode !== 'simulated' ⇒ no
// payment UI at all — the vendor confirms the date first.
const usesSimulatedDeposit = computed(() =>
  company.value?.paymentsMode === 'simulated' && (quote.value?.deposit?.amount ?? 0) > 0)

// Composer visibility: the agent brain has it LIVE from second zero (only
// the deposit sheet takes it over); the battery shows it for text steps.
const composerOpen = computed(() => {
  if (brain.value === 'llm') return step.value !== 'deposit' && step.value !== 'boot_failed'
  const q = currentQuestion.value
  return (q && (q.type === 'address' || q.type === 'text')) || step.value === 'email'
})
const composerPlaceholder = computed(() => {
  if (brain.value === 'llm') return 'Type a message…'
  if (step.value === 'email') return 'you@example.com'
  return currentQuestion.value?.placeholder || 'Type your answer…'
})

function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return iso || 'your date'
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Phone handoff: OPTIONAL postscript after reserving — film rooms for a
// tighter quote (capture link, #96). Never a gate on the chat path.
const captureUrl = computed(() =>
  `${window.location.origin}/c/${encodeURIComponent(companyToken)}?src=agent`)
const qrDataUrl = ref('')
async function makeQr() {
  try {
    const QRCode = (await import('qrcode')).default
    qrDataUrl.value = await QRCode.toDataURL(captureUrl.value, { margin: 1, width: 240 })
  } catch { /* QR is garnish — the link works without it */ }
}

// ── Motion ───────────────────────────────────────────────────
const reducedMotion = typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
let restoring = false
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const threadEl = ref<HTMLElement | null>(null)
async function scrollToEnd() {
  await nextTick()
  // Standalone: the page scrolls. Embedded: the iframe grows instead.
  if (!inIframe) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' })
  postHeight()
}

async function pushBot(text: string) {
  if (!restoring && !reducedMotion) {
    typing.value = true
    await scrollToEnd()
    await sleep(300)
    typing.value = false
  }
  messages.value.push({ kind: 'bot', text })
  await scrollToEnd()
}
function pushUser(text: string) {
  messages.value.push({ kind: 'user', text })
  scrollToEnd()
}
function pushNotice(text: string) {
  messages.value.push({ kind: 'notice', text })
  scrollToEnd()
}
function pushError(text: string, retry: RetryKey | null) {
  messages.value.push({ kind: 'error', text, retry })
  scrollToEnd()
}

// ── Resilience: reload resumes mid-conversation ─────────────
const STORAGE_KEY = `nexus-agent:${companyToken}`
function stableStep(): Step {
  if (step.value === 'quoting') return 'email'
  if (step.value === 'reserving') return 'reserve_offer'
  if (step.value === 'boot' || step.value === 'boot_failed') return brain.value === 'llm' ? 'llm' : 'boot'
  return step.value
}
function saveState() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: 2,
      brain: brain.value,
      conversationId: conversationId.value,
      chips: chips.value,
      known,
      step: stableStep(),
      messages: messages.value.filter((m) => m.kind !== 'error'),
      company: company.value,
      questions: questions.value,
      qIdx: qIdx.value,
      answers: { ...answers },
      email: email.value,
      quote: quote.value,
      reservation: reservation.value,
    }))
  } catch { /* storage blocked — resume just won't work */ }
}
function restoreState(): boolean {
  let s: any = null
  try { s = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null') } catch { /* ignore */ }
  if (!s || s.v !== 2 || !Array.isArray(s.messages) || !s.company) return false
  if (!['llm', 'question', 'email', 'reserve_offer', 'deposit', 'reserved', 'passed'].includes(s.step)) return false
  if (forcedBrain && s.brain !== forcedBrain) return false // brain override wins over resume
  restoring = true
  brain.value = s.brain === 'det' ? 'det' : 'llm'
  conversationId.value = typeof s.conversationId === 'string' ? s.conversationId : null
  chips.value = Array.isArray(s.chips) ? s.chips : []
  known = s.known && typeof s.known === 'object' ? s.known : {}
  company.value = s.company
  questions.value = Array.isArray(s.questions) ? s.questions : []
  qIdx.value = Number.isInteger(s.qIdx) ? s.qIdx : 0
  Object.assign(answers, s.answers && typeof s.answers === 'object' ? s.answers : {})
  email.value = typeof s.email === 'string' ? s.email : ''
  quote.value = s.quote || null
  reservation.value = s.reservation || null
  messages.value = s.messages
  step.value = s.step
  if (step.value === 'reserved') makeQr()
  restoring = false
  scrollToEnd()
  return true
}

/* ============================================================
   THE AGENT BRAIN (default) — POST /api/agent/:token/converse
   ============================================================ */

/** 503 {fallback:true}: the server says "drop to deterministic". */
class ConverseFallback extends Error {
  known?: Record<string, string>
  constructor(known?: Record<string, string>) {
    super('fallback')
    this.known = known
  }
}

async function converse(body: { conversationId?: string | null; message?: string }): Promise<any> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/api/agent/${encodeURIComponent(companyToken)}/converse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new McpTransportError('Could not reach the server. Check your connection and try again.')
  }
  let data: any = null
  try { data = await res.json() } catch { /* handled below */ }
  if (res.status === 503 && data?.fallback) throw new ConverseFallback(data?.known)
  if (!res.ok || !data) {
    throw new McpTransportError(
      typeof data?.error === 'string' && data.error
        ? data.error
        : 'Something went wrong talking to the server. Please try again.',
    )
  }
  return data
}

/** Fold one converse RESULT into the thread — cards from DATA, always. */
async function applyTurn(r: any) {
  transportFails = 0
  if (typeof r.conversationId === 'string') conversationId.value = r.conversationId
  if (r.company) {
    company.value = {
      name: String(r.company.name || ''),
      trustBlock: company.value?.trustBlock ?? null,
      paymentsMode: r.company.paymentsMode || 'none',
    }
  }
  if (r.known && typeof r.known === 'object') known = r.known
  if (typeof r.customerEmail === 'string' && r.customerEmail) email.value = r.customerEmail

  if (typeof r.reply === 'string' && r.reply) await pushBot(r.reply)
  chips.value = Array.isArray(r.chips) ? r.chips.slice(0, 4) : []

  const ev = r.event
  if (ev?.type === 'quote' && ev.payload) {
    quote.value = ev.payload as Quote
    messages.value.push({ kind: 'quote' })
    await scrollToEnd()
  } else if (ev?.type === 'availability' && ev.payload) {
    messages.value.push({ kind: 'availability', payload: ev.payload as Availability })
    await scrollToEnd()
  } else if (ev?.type === 'reservation' && ev.payload) {
    reservation.value = ev.payload as Reservation
    if (usesSimulatedDeposit.value && quote.value) {
      // Deposit UI stays UI-side: the reservation event opens the same
      // clearly-simulated sheet; completing it reveals the reserved card.
      step.value = 'deposit'
      cardError.value = ''
      await scrollToEnd()
    } else {
      finishReserved()
    }
  }
  saveState()
}

function finishReserved() {
  messages.value.push({ kind: 'reserved' })
  step.value = 'reserved'
  cardNumber.value = ''
  cardExp.value = ''
  cardCvc.value = ''
  makeQr()
  saveState()
  scrollToEnd()
}

async function bootLlm() {
  step.value = 'boot'
  try {
    const r = await converse({}) // deterministic greeting, no model call
    step.value = 'llm'
    await applyTurn(r)
  } catch (e) {
    if (e instanceof ConverseFallback) {
      brain.value = 'det'
      await boot() // straight into the battery — no notice needed pre-hello
      return
    }
    handleMcpFailure(e, 'boot')
    step.value = 'boot_failed'
  }
}

async function sendLlm(message: string, shown?: string) {
  const text = message.trim().slice(0, 2000)
  if (!text || busy.value) return
  pushUser(shown ?? text)
  chips.value = []
  lastSent = text
  busy.value = true
  typing.value = true
  await scrollToEnd()
  try {
    const r = await converse({ conversationId: conversationId.value, message: text })
    busy.value = false
    typing.value = false
    await applyTurn(r)
  } catch (e) {
    busy.value = false
    typing.value = false
    if (e instanceof ConverseFallback) {
      await switchToDet(e.known)
      return
    }
    transportFails += 1
    if (transportFails >= 2) {
      await switchToDet()
      return
    }
    pushError(e instanceof McpTransportError ? e.message : 'Something went wrong. Please try again.', 'llm')
  }
  saveState()
}

function sendDraftLlm() {
  if (busy.value) return // keep the draft — never swallow it mid-request
  const v = textDraft.value.trim()
  if (!v) { inputError.value = 'Type a message first.'; return }
  inputError.value = ''
  textDraft.value = ''
  sendLlm(v)
}

async function retryLlm() {
  if (!lastSent || busy.value) return
  busy.value = true
  typing.value = true
  await scrollToEnd()
  try {
    const r = await converse({ conversationId: conversationId.value, message: lastSent })
    busy.value = false
    typing.value = false
    await applyTurn(r)
  } catch (e) {
    busy.value = false
    typing.value = false
    if (e instanceof ConverseFallback) { await switchToDet(e.known); return }
    transportFails += 1
    if (transportFails >= 2) { await switchToDet(); return }
    pushError('Still no luck — one more try?', 'llm')
  }
}

/** Availability card → tappable date chip: the tap IS the next message. */
function pickDate(iso: string) {
  sendLlm(`Let's do ${iso}`, fmtDay(iso))
}

function availLine(p: Availability): string {
  if (p.requestedDateOpen) return `${fmtDay(p.requestedDate)} is open on ${companyName.value}'s booking calendar.`
  if (p.reason === 'past_date') return `${fmtDay(p.requestedDate)} has already passed — pick a day ahead.`
  return `${fmtDay(p.requestedDate)} isn't available${p.alternatives.length ? ' — nearest open days:' : '.'}`
}

/**
 * The graceful mid-conversation fallback: agent → deterministic battery,
 * CARRYING everything already gathered (the server's `known` seeds
 * knownAnswers, so get_intake_questions only returns what's still open).
 * One quiet notice line; same quote, same rates, no restart.
 */
async function switchToDet(carryKnown?: Record<string, string>) {
  if (brain.value === 'det') return
  brain.value = 'det'
  chips.value = []
  if (carryKnown && typeof carryKnown === 'object') known = { ...known, ...carryKnown }
  Object.assign(answers, known)
  pushNotice('Continuing with quick questions — same rates, same quote.')
  try {
    if (!company.value) {
      company.value = await callTool<CompanyInfo>(companyToken, 'get_company_info')
    }
    const qs = await callTool<{ questions: Question[] }>(companyToken, 'get_intake_questions', { knownAnswers: { ...answers } })
    questions.value = qs.questions
    qIdx.value = 0
    await askCurrent()
  } catch (e) {
    handleMcpFailure(e, 'boot')
    step.value = 'boot_failed'
  }
  saveState()
}

/* ============================================================
   THE DETERMINISTIC BATTERY (#114) — now the fallback brain
   ============================================================ */

async function boot() {
  step.value = 'boot'
  try {
    const info = await callTool<CompanyInfo>(companyToken, 'get_company_info')
    company.value = info
    await pushBot(`Hi — I'm ${info.name}'s moving assistant. Answer a few quick questions and I'll price your move on ${info.name}'s own rates. Takes about a minute.`)
    const qs = await callTool<{ questions: Question[] }>(companyToken, 'get_intake_questions', { knownAnswers: {} })
    questions.value = qs.questions
    qIdx.value = 0
    await askCurrent()
  } catch (e) {
    handleMcpFailure(e, 'boot')
    step.value = 'boot_failed'
  }
}

async function askCurrent() {
  const q = questions.value[qIdx.value]
  if (!q) return openEmailGate()
  step.value = 'question'
  textDraft.value = answers[q.id] || ''
  dateDraft.value = q.type === 'date' ? (answers[q.id] || '') : ''
  inputError.value = ''
  await pushBot(q.label)
  saveState()
}

async function answer(q: Question, value: string, shown: string) {
  answers[q.id] = value
  pushUser(shown)
  qIdx.value += 1
  await askCurrent()
}

function pickChip(q: Question, opt: QuestionOption) {
  if (step.value !== 'question') return
  answer(q, opt.value, opt.label)
}
function submitDate(q: Question) {
  const v = dateDraft.value
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { inputError.value = 'Pick a date first.'; return }
  answer(q, v, fmtDay(v))
}
function submitText(q: Question) {
  const v = textDraft.value.trim().slice(0, 255)
  if (!v) { inputError.value = 'Type an answer first.'; return }
  textDraft.value = ''
  answer(q, v, v)
}

async function openEmailGate() {
  step.value = 'email'
  textDraft.value = email.value
  inputError.value = ''
  await pushBot(`That's everything I need. Where should we send your quote?`)
  saveState()
}

async function submitEmail() {
  const v = textDraft.value.trim()
  if (!EMAIL_RE.test(v) || v.length > 255) {
    inputError.value = 'That email doesn’t look right — check it and try again.'
    return
  }
  email.value = v
  textDraft.value = ''
  pushUser(v)
  await getQuote()
}

async function getQuote() {
  step.value = 'quoting'
  typing.value = true
  await scrollToEnd()
  try {
    const payload = await callTool<Quote>(companyToken, 'price_quote', {
      answers: { ...answers },
      customerEmail: email.value,
    })
    typing.value = false
    quote.value = payload
    messages.value.push({ kind: 'quote' })
    await scrollToEnd()
    await offerReservation()
  } catch (e) {
    typing.value = false
    handleMcpFailure(e, 'quote')
    step.value = 'email' // re-arm the gate: resubmitting retries, never a dead end
    textDraft.value = email.value
  }
}

async function offerReservation() {
  const q = quote.value!
  const day = fmtDay(answers.moveDate || '')
  if (usesSimulatedDeposit.value) {
    await pushBot(`Want to lock ${day} in? Reserve it with a ${depositPct.value}% deposit (${money(q.deposit.amount)}). Demo mode — no charge will be made.`)
  } else {
    await pushBot(`Want to lock ${day} in? No payment today — ${companyName.value} confirms your date first.`)
  }
  step.value = 'reserve_offer'
  saveState()
}

function startReserve() {
  pushUser(`Reserve ${fmtDay(answers.moveDate || '')}`)
  if (usesSimulatedDeposit.value) {
    step.value = 'deposit'
    cardError.value = ''
    scrollToEnd()
    saveState()
  } else {
    doReserve()
  }
}

async function passOnReserve() {
  pushUser('Not now')
  step.value = 'passed'
  await pushBot(`No problem — your quote is saved and a copy goes to ${email.value}. Come back to this chat any time to lock a date in.`)
  saveState()
}

// Luhn — the ONLY "validation" the demo card sheet does. Nothing is ever
// sent anywhere: no payment API exists in this build, and the sheet says so.
function luhnOk(digits: string): boolean {
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) { d *= 2; if (d > 9) d -= 9 }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

function submitDeposit() {
  const digits = cardNumber.value.replace(/[\s-]/g, '')
  if (!/^\d{13,19}$/.test(digits) || !luhnOk(digits)) {
    cardError.value = 'That card number doesn’t look right. (Demo mode — any test number works, e.g. 4242 4242 4242 4242.)'
    return
  }
  if (!/^\s*(0[1-9]|1[0-2])\s*\/?\s*\d{2}\s*$/.test(cardExp.value)) {
    cardError.value = 'Expiry should look like MM/YY.'
    return
  }
  if (!/^\d{3,4}$/.test(cardCvc.value.trim())) {
    cardError.value = 'The security code is the 3–4 digits on the card.'
    return
  }
  cardError.value = ''
  if (brain.value === 'llm') {
    // Agent brain: the reservation already exists (the event triggered this
    // sheet); the sheet just completes the simulated-deposit theater.
    finishReserved()
  } else {
    doReserve()
  }
}

async function doReserve() {
  step.value = 'reserving'
  typing.value = true
  await scrollToEnd()
  try {
    const r = await callTool<Reservation>(companyToken, 'reserve_booking', {
      quoteId: quote.value!.quoteId,
      requestedDate: answers.moveDate,
      customerEmail: email.value,
    })
    typing.value = false
    reservation.value = r
    finishReserved()
  } catch (e) {
    typing.value = false
    handleMcpFailure(e, 'reserve')
    step.value = 'reserve_offer' // the offer buttons come back — no dead end
  }
}

// ── Failure → quiet bubbles ──────────────────────────────────
function handleMcpFailure(e: unknown, retry: RetryKey) {
  if (e instanceof McpToolError) {
    // The vendor server worded this for the customer — show it as-is.
    pushError(e.userMessage, retry === 'boot' ? 'boot' : null)
  } else if (e instanceof McpTransportError) {
    pushError(e.message, retry)
  } else {
    pushError('Something went wrong. Please try again.', retry)
  }
}

function retryAction(key: RetryKey) {
  // Drop stale error bubbles for a clean retry.
  messages.value = messages.value.filter((m) => m.kind !== 'error')
  if (key === 'boot') {
    messages.value = []
    if (brain.value === 'llm') bootLlm()
    else boot()
  } else if (key === 'quote') {
    getQuote()
  } else if (key === 'llm') {
    retryLlm()
  } else {
    doReserve()
  }
}

// ── Composer dispatch (one form, two brains) ────────────────
function onComposerSubmit() {
  if (brain.value === 'llm') return sendDraftLlm()
  if (step.value === 'email') return submitEmail()
  if (currentQuestion.value) return submitText(currentQuestion.value)
}

// ── Iframe embed: post our content height to the widget ─────
const inIframe = window.self !== window.top
let resizeObserver: ResizeObserver | null = null
let lastPostedHeight = 0
function postHeight() {
  if (!inIframe) return
  const h = Math.ceil(document.documentElement.scrollHeight)
  if (h === lastPostedHeight) return
  lastPostedHeight = h
  // Nothing sensitive rides on this message, and the embedding page's origin
  // is unknowable from in here — the WIDGET checks event.origin instead.
  try { window.parent.postMessage({ type: 'nexus-agent-height', height: h }, '*') } catch { /* ignore */ }
}

onMounted(() => {
  if (inIframe && typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => postHeight())
    resizeObserver.observe(document.documentElement)
  }
  if (!restoreState()) {
    if (brain.value === 'llm') bootLlm()
    else boot()
  }
})
onBeforeUnmount(() => { resizeObserver?.disconnect() })
</script>

<template>
  <div class="ag" :class="{ 'ag--embed': inIframe }">
    <div class="ag__panel">
      <!-- Header -->
      <header class="ag__head">
        <span class="ag__avatar" aria-hidden="true"><CalendarCheck :size="17" /></span>
        <div class="ag__head-txt">
          <span class="ag__head-name">{{ company ? `${company.name}` : 'Moving assistant' }}</span>
          <span class="ag__head-sub">{{ company ? 'Moving assistant · instant quote' : 'Connecting…' }}</span>
        </div>
      </header>

      <!-- Thread -->
      <div ref="threadEl" class="ag__thread" role="log" aria-live="polite" aria-label="Conversation">
        <div v-if="step === 'boot' && messages.length === 0 && !typing" class="ag__booting">
          <LoaderCircle :size="22" class="ag-spin" aria-hidden="true" />
        </div>

        <template v-for="(m, i) in messages" :key="i">
          <!-- Plain bubbles -->
          <div v-if="m.kind === 'bot'" class="ag__msg ag__msg--bot">{{ m.text }}</div>
          <div v-else-if="m.kind === 'user'" class="ag__msg ag__msg--user">{{ m.text }}</div>

          <!-- Quiet one-line notice (brain fallback) -->
          <p v-else-if="m.kind === 'notice'" class="ag__notice">{{ m.text }}</p>

          <!-- Quiet retryable failure -->
          <div v-else-if="m.kind === 'error'" class="ag__msg ag__msg--bot ag__msg--err">
            <p class="ag__err-text">{{ m.text }}</p>
            <button v-if="m.retry" type="button" class="ag__retry" @click="retryAction(m.retry)">
              <RotateCcw :size="14" aria-hidden="true" /> Try again
            </button>
          </div>

          <!-- Availability card: dates from tool DATA, tappable -->
          <div v-else-if="m.kind === 'availability'" class="ag__avail">
            <p class="ag__avail-line">
              <CalendarDays :size="15" aria-hidden="true" />
              <span>{{ availLine(m.payload) }}</span>
            </p>
            <div v-if="m.payload.alternatives && m.payload.alternatives.length" class="ag__avail-days">
              <button
                v-for="d in m.payload.alternatives" :key="d" type="button"
                class="ag__chip" @click="pickDate(d)"
              >{{ fmtDay(d) }}</button>
            </div>
          </div>

          <!-- The quote card: range HUGE, trust block fused (hairline divider) -->
          <div v-else-if="m.kind === 'quote' && quote" class="ag__quote">
            <p class="ag__quote-company">{{ quote.company.name }}</p>
            <h2 class="ag__quote-headline">{{ quote.status === 'review_required' ? 'Your estimate' : 'Your price' }}</h2>
            <p class="ag__quote-range">
              <span class="ag__quote-num">{{ money(quote.rangeLow) }}</span>
              <span class="ag__quote-dash">–</span>
              <span class="ag__quote-num">{{ money(quote.rangeHigh) }}</span>
            </p>
            <p class="ag__quote-crew">{{ quote.crew }}-person crew · {{ quote.hours.low }}–{{ quote.hours.high }} hours</p>

            <p v-if="quote.status === 'review_required'" class="ag__quote-review">
              An estimator will confirm this price before it's final —
              {{ quote.reviewReasons.join(' ') }}
            </p>

            <details class="ag__quote-details">
              <summary>See the math</summary>
              <ul class="ag__quote-lines">
                <li v-for="li in quote.lineItems" :key="li.key">
                  <span>{{ li.label }}</span>
                  <span class="ag__quote-amt">{{ li.amountLow === li.amountHigh ? money(li.amountLow) : `${money(li.amountLow)}–${money(li.amountHigh)}` }}</span>
                </li>
                <li v-if="quote.nte" class="ag__quote-nte">
                  <span>Not to exceed</span>
                  <span class="ag__quote-amt">{{ money(quote.nte) }}</span>
                </li>
              </ul>
            </details>

            <!-- Trust block: same card, hairline divider — never separable -->
            <div class="ag__trust">
              <p class="ag__trust-head"><ShieldCheck :size="14" aria-hidden="true" /> Who's quoting you</p>
              <dl class="ag__trust-grid">
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
              <a v-if="quote.trustBlock.regulatorUrl" :href="quote.trustBlock.regulatorUrl" class="ag__trust-reg" target="_blank" rel="noopener">
                Verify with the state regulator
              </a>
            </div>
          </div>

          <!-- Reserved! Filming stays an OPTIONAL postscript, never a gate -->
          <div v-else-if="m.kind === 'reserved' && reservation" class="ag__done">
            <span class="ag__done-badge"><Check :size="20" aria-hidden="true" /></span>
            <h2 class="ag__done-title">Reserved!</h2>
            <p class="ag__done-body">
              {{ companyName }} will confirm within 24 hours.
              Confirmation sent to <strong>{{ email || 'your email' }}</strong>.
            </p>
            <p class="ag__done-deposit">{{ reservation.deposit.note }}</p>
            <div class="ag__handoff">
              <img v-if="qrDataUrl" :src="qrDataUrl" class="ag__qr" alt="QR code — open the room-filming link on your phone" width="104" height="104" />
              <div class="ag__handoff-txt">
                <a :href="captureUrl" target="_blank" rel="noopener" class="ag__handoff-link">
                  <Video :size="15" aria-hidden="true" /> Film your rooms for a tighter quote
                </a>
                <p class="ag__handoff-sub">Optional — point your phone camera at the code, or open the link. About a minute per room.</p>
              </div>
            </div>
          </div>
        </template>

        <!-- Typing indicator (real converse latency, or ~300ms det pacing) -->
        <div v-if="typing" class="ag__msg ag__msg--bot ag__typing" aria-label="Assistant is typing">
          <span></span><span></span><span></span>
        </div>

        <!-- Agent-brain quick replies (model-suggested, tap or type) -->
        <div v-if="brain === 'llm' && chips.length && !typing && step !== 'deposit'" class="ag__chips">
          <button
            v-for="c in chips" :key="c" type="button"
            class="ag__chip" @click="sendLlm(c)"
          >{{ c }}</button>
        </div>

        <!-- Deterministic battery affordances -->
        <div v-if="currentQuestion && currentQuestion.type === 'chips'" class="ag__chips">
          <button
            v-for="opt in currentQuestion.options" :key="opt.value" type="button"
            class="ag__chip" @click="pickChip(currentQuestion, opt)"
          >{{ opt.label }}</button>
        </div>

        <div v-else-if="currentQuestion && currentQuestion.type === 'date'" class="ag__daterow">
          <input v-model="dateDraft" class="ag__input ag__input--date" type="date" aria-label="Move date" @keyup.enter="submitDate(currentQuestion)" />
          <button type="button" class="ag__send" :disabled="!dateDraft" @click="submitDate(currentQuestion)">That's the date</button>
        </div>

        <div v-else-if="step === 'reserve_offer'" class="ag__chips">
          <button type="button" class="ag__chip ag__chip--primary" @click="startReserve">
            <Lock :size="14" aria-hidden="true" /> Reserve {{ fmtDay(answers.moveDate || '') }}
          </button>
          <button type="button" class="ag__chip" @click="passOnReserve">Not now</button>
        </div>

        <div v-else-if="step === 'passed'" class="ag__chips">
          <button type="button" class="ag__chip ag__chip--primary" @click="startReserve">
            <Lock :size="14" aria-hidden="true" /> Actually — reserve {{ fmtDay(answers.moveDate || '') }}
          </button>
        </div>

        <!-- Simulated deposit sheet — CLEARLY marked, calls no payment API -->
        <form v-else-if="step === 'deposit' && quote" class="ag__sheet" @submit.prevent="submitDeposit">
          <p class="ag__sheet-demo" role="note">Demo mode — no charge will be made</p>
          <p class="ag__sheet-title">Deposit to hold {{ fmtDay(reservation?.requestedDate || answers.moveDate || '') }}: <strong>{{ money(quote.deposit.amount) }}</strong> ({{ depositPct }}% of your low estimate)</p>
          <label class="ag__sheet-label" for="ag-card">Card number</label>
          <input id="ag-card" v-model="cardNumber" class="ag__input" type="text" inputmode="numeric" autocomplete="off" placeholder="4242 4242 4242 4242" />
          <div class="ag__sheet-row">
            <div class="ag__sheet-col">
              <label class="ag__sheet-label" for="ag-exp">Expiry</label>
              <input id="ag-exp" v-model="cardExp" class="ag__input" type="text" inputmode="numeric" autocomplete="off" placeholder="MM/YY" />
            </div>
            <div class="ag__sheet-col">
              <label class="ag__sheet-label" for="ag-cvc">CVC</label>
              <input id="ag-cvc" v-model="cardCvc" class="ag__input" type="text" inputmode="numeric" autocomplete="off" placeholder="123" />
            </div>
          </div>
          <p v-if="cardError" class="ag__input-err" role="alert">{{ cardError }}</p>
          <button type="submit" class="ag__cta">
            <Lock :size="15" aria-hidden="true" /> Place simulated deposit &amp; reserve
          </button>
          <p class="ag__sheet-fine">This is a demonstration checkout. No payment details leave this page and nothing is ever charged.</p>
        </form>
      </div>

      <!-- Bottom composer: LIVE from second zero on the agent brain;
           address/text questions + the email gate on the battery.
           novalidate: our own email-shape check words the error in-thread
           instead of the browser's native bubble -->
      <form
        v-if="composerOpen"
        class="ag__composer"
        novalidate
        @submit.prevent="onComposerSubmit"
      >
        <div class="ag__composer-inner">
          <input
            v-model="textDraft"
            class="ag__input ag__input--grow"
            :type="brain === 'det' && step === 'email' ? 'email' : 'text'"
            :inputmode="brain === 'det' && step === 'email' ? 'email' : 'text'"
            :autocomplete="brain === 'det' && step === 'email' ? 'email' : (brain === 'det' && currentQuestion?.type === 'address' ? 'street-address' : 'off')"
            :placeholder="composerPlaceholder"
            :aria-label="brain === 'llm' ? 'Message the assistant' : (step === 'email' ? 'Your email' : currentQuestion?.label)"
          />
          <button type="submit" class="ag__send" :disabled="!textDraft.trim() || (brain === 'llm' && busy)">
            {{ brain === 'det' && step === 'email' ? 'Get my quote' : 'Send' }}
          </button>
        </div>
        <p v-if="inputError" class="ag__input-err" role="alert">{{ inputError }}</p>
      </form>

      <!-- Embedded, the widget renders its own attribution under the iframe. -->
      <footer v-if="!inIframe" class="ag__foot">
        Powered by <a class="ag__foot-brand" href="/" target="_blank" rel="noopener">Nexus Moves</a>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* Mobile-first buyer surface, semantic tokens only (COMMON.md). */
.ag {
  min-height: 100dvh;
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--font-ui);
  display: flex;
  justify-content: center;
}
/* Embedded in the widget's iframe: the document IS the panel — no page
   chrome; content height flows out via postMessage instead of scrolling.
   100vh here is the IFRAME's height, so the composer hugs the panel's
   bottom edge; growth is stable because the posted scrollHeight only ever
   matches or exceeds it. */
.ag--embed { min-height: 100vh; background: var(--surface-card); }

.ag__panel {
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  min-height: inherit;
}
.ag--embed .ag__panel { max-width: none; }

/* Header */
.ag__head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5);
  background: var(--surface-card);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 2;
}
.ag__avatar {
  width: 34px; height: 34px; flex: none;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--r-pill);
  background: var(--shimmer);
  color: var(--on-accent);
}
.ag__head-txt { display: flex; flex-direction: column; min-width: 0; }
.ag__head-name {
  font-family: var(--font-display);
  font-weight: var(--fw-bold);
  font-size: var(--fs-body-l);
  letter-spacing: var(--ls-title);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ag__head-sub { font-size: var(--fs-label); color: var(--text-secondary); }

/* Thread */
.ag__thread {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-5);
}
.ag__booting { display: flex; justify-content: center; padding: var(--sp-8) 0; color: var(--text-tertiary); }

.ag__msg {
  max-width: 88%;
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--r-xl);
  font-size: var(--fs-body-l); /* chat body 17 (COMMON.md) */
  line-height: var(--lh-body);
  white-space: pre-line;
  overflow-wrap: break-word;
}
.ag__msg--bot {
  align-self: flex-start;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-bottom-left-radius: var(--r-xs);
  color: var(--text-primary);
}
.ag__msg--user {
  align-self: flex-end;
  background: var(--accent);
  color: var(--on-accent);
  border-bottom-right-radius: var(--r-xs);
}
.ag__msg--err { background: var(--warning-surface); color: var(--warning-ink); border-color: var(--border); }
.ag__err-text { margin: 0; }
.ag__retry {
  display: inline-flex; align-items: center; gap: var(--sp-2);
  margin-top: var(--sp-2);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: var(--surface-card);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  padding: var(--sp-2) var(--sp-4);
  min-height: 36px;
  cursor: pointer;
}
.ag__retry:hover { background: var(--surface-hover); }
.ag__retry:active { transform: scale(0.97); }
.ag__retry:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* Quiet brain-switch notice */
.ag__notice {
  margin: 0;
  align-self: center;
  text-align: center;
  font-size: var(--fs-label);
  color: var(--text-tertiary);
}

/* Typing dots */
.ag__typing { display: inline-flex; gap: 5px; align-items: center; min-height: 38px; }
.ag__typing span {
  width: 7px; height: 7px; border-radius: var(--r-pill);
  background: var(--text-tertiary);
  animation: ag-blink 1s ease-in-out infinite;
}
.ag__typing span:nth-child(2) { animation-delay: 0.15s; }
.ag__typing span:nth-child(3) { animation-delay: 0.3s; }
@keyframes ag-blink { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }

/* Chips */
.ag__chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); padding-left: var(--sp-2); }
.ag__chip {
  display: inline-flex; align-items: center; gap: var(--sp-2);
  min-height: var(--tap-min);
  padding: var(--sp-2) var(--sp-5);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: var(--surface-card);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  font-weight: var(--fw-medium);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.ag__chip:hover { background: var(--surface-hover); }
.ag__chip:active { transform: scale(0.97); }
.ag__chip:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ag__chip--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: var(--fw-semibold);
}
.ag__chip--primary:hover { background: var(--accent-hover); }

/* Availability card: tool data as tappable days */
.ag__avail {
  align-self: flex-start;
  max-width: 88%;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  border-bottom-left-radius: var(--r-xs);
  padding: var(--sp-3) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.ag__avail-line {
  margin: 0;
  display: flex; align-items: flex-start; gap: var(--sp-2);
  font-size: var(--fs-body-l);
  line-height: var(--lh-body);
}
.ag__avail-line svg { flex: none; margin-top: 3px; color: var(--accent); }
.ag__avail-days { display: flex; flex-wrap: wrap; gap: var(--sp-2); }

/* Date row */
.ag__daterow { display: flex; gap: var(--sp-2); padding-left: var(--sp-2); flex-wrap: wrap; }
.ag__input {
  min-height: var(--tap-min);
  padding: var(--sp-2) var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface-card);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--fs-body-l);
  box-sizing: border-box;
}
.ag__input:focus-visible { outline: none; box-shadow: var(--focus-ring); border-color: var(--accent); }
.ag__input--grow { flex: 1; min-width: 0; }
.ag__input--date { flex: 1; min-width: 150px; }
.ag__input-err { margin: var(--sp-2) 0 0; color: var(--danger); font-size: var(--fs-label); }

.ag__send {
  flex: none;
  min-height: var(--tap-min);
  padding: var(--sp-2) var(--sp-5);
  border: none;
  border-radius: var(--r-md);
  background: var(--accent);
  color: var(--on-accent);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  font-weight: var(--fw-bold);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.ag__send:hover:not(:disabled) { background: var(--accent-hover); }
.ag__send:active:not(:disabled) { transform: scale(0.97); }
.ag__send:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ag__send:disabled { opacity: 0.45; cursor: default; }

/* ── The quote card: the range is the HERO ─────────────────── */
.ag__quote {
  align-self: stretch;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  padding: var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.ag__quote-company {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--text-secondary);
}
.ag__quote-headline {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-title-s);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
}
.ag__quote-range {
  margin: var(--sp-1) 0 0;
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  flex-wrap: wrap;
  font-family: var(--font-display); /* Bricolage numerals precedent */
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-display);
  font-size: clamp(34px, 9vw, 44px);
  line-height: var(--lh-tight);
  font-variant-numeric: tabular-nums;
}
.ag__quote-dash { color: var(--text-tertiary); }
.ag__quote-crew { margin: 0; color: var(--text-secondary); font-size: var(--fs-body); }
.ag__quote-review {
  margin: var(--sp-2) 0 0;
  padding: var(--sp-3) var(--sp-4);
  background: var(--warning-surface);
  color: var(--warning-ink);
  border-radius: var(--r-md);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
}
.ag__quote-details { margin-top: var(--sp-2); font-size: var(--fs-label); }
.ag__quote-details summary {
  cursor: pointer;
  font-weight: var(--fw-semibold);
  color: var(--text-secondary);
  min-height: 28px;
  border-radius: var(--r-xs);
}
.ag__quote-details summary:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ag__quote-lines {
  list-style: none;
  margin: var(--sp-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.ag__quote-lines li {
  display: flex; justify-content: space-between; gap: var(--sp-4);
  font-size: var(--fs-label); color: var(--text-secondary); line-height: var(--lh-body);
}
.ag__quote-amt { flex: none; font-variant-numeric: tabular-nums; color: var(--text-primary); }
.ag__quote-nte { padding-top: var(--sp-2); border-top: 1px solid var(--border-soft); font-weight: var(--fw-semibold); }
.ag__quote-nte span:first-child { color: var(--text-primary); }

/* Trust block fused to the price — hairline divider */
.ag__trust { margin-top: var(--sp-3); padding-top: var(--sp-4); border-top: 1px solid var(--border); }
.ag__trust-head {
  display: flex; align-items: center; gap: var(--sp-2);
  margin: 0 0 var(--sp-3);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--text-secondary);
}
.ag__trust-head svg { color: var(--success); }
.ag__trust-grid { margin: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
.ag__trust-grid dt { font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); }
.ag__trust-grid dd { margin: 2px 0 0; font-size: var(--fs-label); line-height: var(--lh-body); color: var(--text-secondary); }
.ag__trust-reg {
  display: inline-block;
  margin-top: var(--sp-3);
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  color: var(--accent);
  text-decoration: underline;
  border-radius: var(--r-xs);
}
.ag__trust-reg:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* Simulated deposit sheet */
.ag__sheet {
  align-self: stretch;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  padding: var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.ag__sheet-demo {
  margin: 0;
  align-self: flex-start;
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--r-pill);
  background: var(--warning-surface);
  color: var(--warning-ink);
  font-size: var(--fs-label);
  font-weight: var(--fw-bold);
  letter-spacing: 0.02em;
}
.ag__sheet-title { margin: 0 0 var(--sp-2); font-size: var(--fs-body); color: var(--text-secondary); line-height: var(--lh-body); }
.ag__sheet-title strong { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.ag__sheet-label { font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-secondary); }
.ag__sheet-row { display: flex; gap: var(--sp-3); }
.ag__sheet-col { flex: 1; display: flex; flex-direction: column; gap: var(--sp-2); min-width: 0; }
.ag__sheet-col .ag__input { width: 100%; }
.ag__sheet-fine { margin: 0; font-size: 11.5px; color: var(--text-tertiary); line-height: var(--lh-body); }
.ag__cta {
  display: flex; align-items: center; justify-content: center; gap: var(--sp-2);
  min-height: var(--tap-min);
  margin-top: var(--sp-2);
  padding: var(--sp-3) var(--sp-5);
  border: none;
  border-radius: var(--r-md);
  background: var(--accent);
  color: var(--on-accent);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  font-weight: var(--fw-bold);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.ag__cta:hover { background: var(--accent-hover); }
.ag__cta:active { transform: scale(0.97); }
.ag__cta:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* Reserved card */
.ag__done {
  align-self: stretch;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  padding: var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.ag__done-badge {
  width: 40px; height: 40px;
  border-radius: var(--r-pill);
  background: var(--success-quiet);
  color: var(--success);
  display: flex; align-items: center; justify-content: center;
}
.ag__done-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-title-m);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-display);
}
.ag__done-body { margin: 0; font-size: var(--fs-body-l); line-height: var(--lh-body); color: var(--text-primary); }
.ag__done-deposit { margin: 0; font-size: var(--fs-label); color: var(--text-secondary); line-height: var(--lh-body); }
.ag__handoff {
  display: flex; gap: var(--sp-4); align-items: center;
  margin-top: var(--sp-3); padding-top: var(--sp-4);
  border-top: 1px solid var(--border-soft);
}
.ag__qr { flex: none; border: 1px solid var(--border); border-radius: var(--r-sm); }
.ag__handoff-txt { min-width: 0; }
.ag__handoff-link {
  display: inline-flex; align-items: center; gap: var(--sp-2);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
  color: var(--accent);
  text-decoration: underline;
  border-radius: var(--r-xs);
}
.ag__handoff-link:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ag__handoff-sub { margin: var(--sp-2) 0 0; font-size: var(--fs-label); color: var(--text-secondary); line-height: var(--lh-body); }

/* Composer */
.ag__composer {
  position: sticky;
  bottom: 0;
  background: var(--surface-card);
  border-top: 1px solid var(--border);
  padding: var(--sp-3) var(--sp-5) var(--sp-4);
}
.ag__composer-inner { display: flex; gap: var(--sp-2); }

/* Footer */
.ag__foot {
  padding: var(--sp-2) var(--sp-5) var(--sp-3);
  font-size: 11.5px;
  color: var(--text-tertiary);
  text-align: center;
  background: var(--surface-card);
}
.ag--embed .ag__foot { border-top: 1px solid var(--border-soft); }
.ag:not(.ag--embed) .ag__foot { background: transparent; }
.ag__foot-brand { color: var(--text-tertiary); font-weight: var(--fw-semibold); text-decoration: underline; border-radius: var(--r-xs); }
.ag__foot-brand:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* Motion */
.ag-spin { animation: ag-spin 0.9s linear infinite; }
@keyframes ag-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .ag-spin, .ag__typing span { animation: none; }
  .ag__chip, .ag__send, .ag__cta, .ag__retry { transition: none; }
  .ag__chip:active, .ag__send:active, .ag__cta:active, .ag__retry:active { transform: none; }
}
</style>
