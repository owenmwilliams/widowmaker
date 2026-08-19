<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import {
  Copy, Check, ExternalLink, LogOut, Link2, Code2, CircleAlert,
  Video, ClipboardList, Pause, Play,
} from 'lucide-vue-next'
import { API_BASE_URL } from '../config/api'
import { companyAuthHeaders, clearCompanySession, getCompanyData, logoutCompany } from '../utils/companyAuth'
// Inline (not <img>): the lockup's wordmark is SVG <text> in Bricolage, and
// SVG-as-image can't load webfonts — inlining lets the bundled font apply.
import logoSvg from '../assets/brand/logo-lockup-light.svg?raw'

/* ============================================================
   /mover — the mover dashboard (F2, #99). Desktop-first web for
   moving companies, behind a company session (magic-link login
   at /mover/login; distinct from user auth).

   Three independent fetches (overview / walkthroughs / leads),
   each with its own loading skeleton and error card, so one
   failing section never blanks the page. A company with zero
   walkthroughs still gets a useful dashboard: the capture link
   and widget snippet are the hero, front and center.
   ============================================================ */

const router = useRouter()
const core_url = API_BASE_URL

// ── Types (API shapes) ───────────────────────────────────────
type Overview = {
  company: { id: string; name: string; contactEmail: string; isActive: boolean; createdAt: string }
  captureUrl: string
  embedSnippet: string
  counters: { sessionsTotal: number; sessionsCompleted: number; fromWidget: number }
}
type Walkthrough = {
  id: string; customerEmail: string; status: string; source: string | null
  videosCount: number; itemsCount: number
  createdAt: string; completedAt: string | null; shareUrl: string | null
}
type LeadsPayload = { leads: unknown[]; note?: string }

// ── Per-section state (quiet degradation) ────────────────────
const overview = ref<Overview | null>(null)
const overviewLoading = ref(true)
const overviewError = ref('')

const walkthroughs = ref<Walkthrough[] | null>(null)
const walkthroughsLoading = ref(true)
const walkthroughsError = ref('')

const leads = ref<LeadsPayload | null>(null)
const leadsLoading = ref(true)
const leadsError = ref('')

// Header shows the cached name instantly; overview refreshes it.
const companyName = ref(getCompanyData()?.name || '')

// ── Settings form ────────────────────────────────────────────
const settingsName = ref('')
const settingsEmail = ref('')
const settingsSaving = ref(false)
const settingsError = ref('')
const settingsSaved = ref(false)
const pauseBusy = ref(false)
const confirmingPause = ref(false)

const isActive = computed(() => overview.value?.company.isActive ?? true)
const settingsDirty = computed(() =>
  !!overview.value && (
    settingsName.value.trim() !== overview.value.company.name ||
    settingsEmail.value.trim().toLowerCase() !== overview.value.company.contactEmail.toLowerCase()
  )
)

// ── Fetch helpers ────────────────────────────────────────────
function kickToLogin() {
  clearCompanySession()
  router.replace('/mover/login')
}

function isAuthFailure(e: any): boolean {
  return axios.isAxiosError(e) && e.response?.status === 401
}

async function loadOverview() {
  overviewLoading.value = true
  overviewError.value = ''
  try {
    const { data } = await axios.get(`${core_url}/api/company/overview`, { headers: companyAuthHeaders() })
    overview.value = data
    companyName.value = data.company.name
    settingsName.value = data.company.name
    settingsEmail.value = data.company.contactEmail
  } catch (e: any) {
    if (isAuthFailure(e)) return kickToLogin()
    overviewError.value = e?.response?.data?.error || 'Could not load your overview.'
  } finally {
    overviewLoading.value = false
  }
}

async function loadWalkthroughs() {
  walkthroughsLoading.value = true
  walkthroughsError.value = ''
  try {
    const { data } = await axios.get(`${core_url}/api/company/walkthroughs`, { headers: companyAuthHeaders() })
    walkthroughs.value = data.walkthroughs
  } catch (e: any) {
    if (isAuthFailure(e)) return kickToLogin()
    walkthroughsError.value = e?.response?.data?.error || 'Could not load your walkthroughs.'
  } finally {
    walkthroughsLoading.value = false
  }
}

async function loadLeads() {
  leadsLoading.value = true
  leadsError.value = ''
  try {
    const { data } = await axios.get(`${core_url}/api/company/leads`, { headers: companyAuthHeaders() })
    leads.value = data
  } catch (e: any) {
    if (isAuthFailure(e)) return kickToLogin()
    leadsError.value = e?.response?.data?.error || 'Could not load your quote requests.'
  } finally {
    leadsLoading.value = false
  }
}

onMounted(() => {
  loadOverview()
  loadWalkthroughs()
  loadLeads()
})

// ── Copy buttons ─────────────────────────────────────────────
const copiedLink = ref(false)
const copiedSnippet = ref(false)
async function copyText(text: string, flag: typeof copiedLink) {
  try {
    await navigator.clipboard.writeText(text)
    flag.value = true
    setTimeout(() => { flag.value = false }, 2000)
  } catch { /* clipboard blocked — the text stays selectable */ }
}

// ── Settings actions ─────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function patchSettings(body: Record<string, unknown>): Promise<boolean> {
  try {
    const { data } = await axios.patch(`${core_url}/api/company/settings`, body, { headers: companyAuthHeaders() })
    if (overview.value) overview.value.company = data.company
    companyName.value = data.company.name
    settingsName.value = data.company.name
    settingsEmail.value = data.company.contactEmail
    return true
  } catch (e: any) {
    if (isAuthFailure(e)) { kickToLogin(); return false }
    settingsError.value = e?.response?.data?.error || 'Could not save your settings.'
    return false
  }
}

async function saveSettings() {
  settingsError.value = ''
  settingsSaved.value = false
  const name = settingsName.value.trim()
  const email = settingsEmail.value.trim()
  if (!name) { settingsError.value = 'Company name cannot be empty.'; return }
  if (!EMAIL_RE.test(email)) { settingsError.value = 'Enter a valid contact email.'; return }

  const body: Record<string, unknown> = {}
  if (name !== overview.value?.company.name) body.name = name
  if (email.toLowerCase() !== overview.value?.company.contactEmail.toLowerCase()) body.contact_email = email
  if (!Object.keys(body).length) return

  settingsSaving.value = true
  const ok = await patchSettings(body)
  settingsSaving.value = false
  if (ok) {
    settingsSaved.value = true
    setTimeout(() => { settingsSaved.value = false }, 2500)
  }
}

async function togglePause() {
  if (!overview.value) return
  if (!confirmingPause.value && isActive.value) {
    // Pausing turns the public link off — confirm first. Resuming needs none.
    confirmingPause.value = true
    return
  }
  confirmingPause.value = false
  settingsError.value = ''
  pauseBusy.value = true
  await patchSettings({ is_active: !isActive.value })
  pauseBusy.value = false
}

async function onLogout() {
  await logoutCompany()
  router.replace('/mover/login')
}

// ── Display helpers ──────────────────────────────────────────
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const SOURCE_LABELS: Record<string, string> = { widget: 'Your website', link: 'Direct link', email: 'Email' }
const sourceLabel = (s: string | null) => (s && SOURCE_LABELS[s]) || '—'

const statusLabel = (s: string) => (s === 'completed' ? 'Completed' : s === 'active' ? 'In progress' : s)
</script>

<template>
  <div class="md-page">
    <!-- ── Header ─────────────────────────────────────────── -->
    <header class="md-head">
      <div class="md-head-brand">
        <span class="md-logo" v-html="logoSvg"></span>
        <span class="md-head-eyebrow">Mover dashboard</span>
      </div>
      <div class="md-head-right">
        <span v-if="companyName" class="md-company-name">{{ companyName }}</span>
        <button class="md-btn md-btn--quiet" @click="onLogout">
          <LogOut :size="15" aria-hidden="true" />
          Log out
        </button>
      </div>
    </header>

    <main class="md-main">
      <!-- ── Hero: capture link + widget snippet ──────────── -->
      <section class="md-hero" aria-label="Your capture link and website widget">
        <template v-if="overviewLoading">
          <div class="md-card md-skel-card"><div class="md-skel md-skel--label"></div><div class="md-skel md-skel--line"></div><div class="md-skel md-skel--btn"></div></div>
          <div class="md-card md-skel-card"><div class="md-skel md-skel--label"></div><div class="md-skel md-skel--line"></div><div class="md-skel md-skel--btn"></div></div>
        </template>

        <div v-else-if="overviewError" class="md-card md-error-card">
          <CircleAlert :size="18" aria-hidden="true" />
          <div>
            <p class="md-error-head">{{ overviewError }}</p>
            <button class="md-btn md-btn--quiet" @click="loadOverview">Try again</button>
          </div>
        </div>

        <template v-else-if="overview">
          <div class="md-card md-hero-card">
            <div class="md-hero-card-head">
              <Link2 :size="16" class="md-hero-icon" aria-hidden="true" />
              <h2>Your capture link</h2>
            </div>
            <p class="md-hero-sub">Send this to customers — they film their home on their phone, you get a quote-ready inventory by email.</p>
            <div class="md-copy-row">
              <code class="md-code" :title="overview.captureUrl">{{ overview.captureUrl }}</code>
              <button class="md-btn md-btn--copy" :class="{ 'md-btn--copied': copiedLink }" @click="copyText(overview.captureUrl, copiedLink)">
                <Check v-if="copiedLink" :size="15" aria-hidden="true" />
                <Copy v-else :size="15" aria-hidden="true" />
                {{ copiedLink ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <p v-if="!isActive" class="md-paused-note">
              <Pause :size="13" aria-hidden="true" />
              Your link is paused — customers who open it see an inactive-link message. Resume it in Settings below.
            </p>
          </div>

          <div class="md-card md-hero-card">
            <div class="md-hero-card-head">
              <Code2 :size="16" class="md-hero-icon" aria-hidden="true" />
              <h2>Website widget</h2>
            </div>
            <p class="md-hero-sub">Paste this one line into your website to add a "Get a quote" widget wired to your link.</p>
            <div class="md-copy-row">
              <code class="md-code" :title="overview.embedSnippet">{{ overview.embedSnippet }}</code>
              <button class="md-btn md-btn--copy" :class="{ 'md-btn--copied': copiedSnippet }" @click="copyText(overview.embedSnippet, copiedSnippet)">
                <Check v-if="copiedSnippet" :size="15" aria-hidden="true" />
                <Copy v-else :size="15" aria-hidden="true" />
                {{ copiedSnippet ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <a class="md-demo-link" href="/widget-demo" target="_blank" rel="noopener">
              See the widget live on a demo site
              <ExternalLink :size="13" aria-hidden="true" />
            </a>
          </div>
        </template>
      </section>

      <!-- ── Stat tiles ─────────────────────────────────────── -->
      <section class="md-tiles" aria-label="Walkthrough stats">
        <template v-if="overviewLoading">
          <div v-for="i in 3" :key="i" class="md-tile"><div class="md-skel md-skel--label"></div><div class="md-skel md-skel--num"></div></div>
        </template>
        <template v-else-if="overview">
          <div class="md-tile">
            <div class="md-tile-bar md-bar-accent" aria-hidden="true"></div>
            <span class="md-tile-lbl">Walkthroughs</span>
            <span class="md-tile-num">{{ overview.counters.sessionsTotal }}</span>
            <span class="md-tile-sub">customers who started filming</span>
          </div>
          <div class="md-tile">
            <div class="md-tile-bar md-bar-shimmer" aria-hidden="true"></div>
            <span class="md-tile-lbl">Completed</span>
            <span class="md-tile-num">{{ overview.counters.sessionsCompleted }}</span>
            <span class="md-tile-sub">inventories delivered to you</span>
          </div>
          <div class="md-tile">
            <div class="md-tile-bar md-bar-beacon" aria-hidden="true"></div>
            <span class="md-tile-lbl">From your website</span>
            <span class="md-tile-num">{{ overview.counters.fromWidget }}</span>
            <span class="md-tile-sub">started through the widget</span>
          </div>
        </template>
      </section>

      <!-- ── Walkthroughs ───────────────────────────────────── -->
      <section class="md-section" aria-label="Walkthroughs">
        <h2 class="md-section-title">Walkthroughs</h2>

        <div v-if="walkthroughsLoading" class="md-card">
          <div v-for="i in 3" :key="i" class="md-skel md-skel--row"></div>
        </div>

        <div v-else-if="walkthroughsError" class="md-card md-error-card">
          <CircleAlert :size="18" aria-hidden="true" />
          <div>
            <p class="md-error-head">{{ walkthroughsError }}</p>
            <button class="md-btn md-btn--quiet" @click="loadWalkthroughs">Try again</button>
          </div>
        </div>

        <div v-else-if="walkthroughs && walkthroughs.length === 0" class="md-card md-empty">
          <Video :size="26" class="md-empty-icon" aria-hidden="true" />
          <h3>No walkthroughs yet</h3>
          <p>
            When a customer opens your capture link and films their home, their walkthrough shows up here —
            and the finished inventory lands in your inbox. Start by sharing the link above or adding the
            widget to your website.
          </p>
        </div>

        <div v-else-if="walkthroughs" class="md-card md-table-card">
          <div class="md-table-scroll">
            <table class="md-table">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Started</th>
                  <th scope="col">Status</th>
                  <th scope="col">Source</th>
                  <th scope="col" class="md-col-num">Videos</th>
                  <th scope="col" class="md-col-num">Items</th>
                  <th scope="col"><span class="md-visually-hidden">Inventory</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="w in walkthroughs" :key="w.id">
                  <td class="md-cell-email">{{ w.customerEmail }}</td>
                  <td class="md-cell-date">{{ fmtDate(w.createdAt) }}</td>
                  <td>
                    <span class="md-pill" :class="w.status === 'completed' ? 'md-pill--done' : 'md-pill--active'">
                      {{ statusLabel(w.status) }}
                    </span>
                  </td>
                  <td>
                    <span class="md-badge" :class="{ 'md-badge--widget': w.source === 'widget' }">{{ sourceLabel(w.source) }}</span>
                  </td>
                  <td class="md-col-num">{{ w.videosCount }}</td>
                  <td class="md-col-num">{{ w.itemsCount }}</td>
                  <td class="md-cell-action">
                    <a v-if="w.shareUrl" class="md-view-link" :href="w.shareUrl" target="_blank" rel="noopener">
                      View inventory
                      <ExternalLink :size="12" aria-hidden="true" />
                    </a>
                    <span v-else class="md-cell-pending">Filming…</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ── Quote requests ─────────────────────────────────── -->
      <section class="md-section" aria-label="Quote requests">
        <h2 class="md-section-title">Quote requests</h2>

        <div v-if="leadsLoading" class="md-card">
          <div class="md-skel md-skel--row"></div>
        </div>

        <div v-else-if="leadsError" class="md-card md-error-card">
          <CircleAlert :size="18" aria-hidden="true" />
          <div>
            <p class="md-error-head">{{ leadsError }}</p>
            <button class="md-btn md-btn--quiet" @click="loadLeads">Try again</button>
          </div>
        </div>

        <div v-else-if="leads" class="md-card md-empty md-empty--compact">
          <ClipboardList :size="22" class="md-empty-icon" aria-hidden="true" />
          <p>{{ leads.note || 'No quote requests yet.' }}</p>
        </div>
      </section>

      <!-- ── Settings ───────────────────────────────────────── -->
      <section class="md-section" aria-label="Settings">
        <h2 class="md-section-title">Settings</h2>

        <div v-if="overviewLoading" class="md-card">
          <div class="md-skel md-skel--row"></div>
          <div class="md-skel md-skel--row"></div>
        </div>

        <div v-else-if="overview" class="md-card md-settings">
          <div class="md-settings-grid">
            <div class="md-field">
              <label class="md-field-label" for="settings-name">Company name</label>
              <input id="settings-name" v-model="settingsName" class="md-input" type="text" maxlength="255" />
            </div>
            <div class="md-field">
              <label class="md-field-label" for="settings-email">Contact email</label>
              <input id="settings-email" v-model="settingsEmail" class="md-input" type="email" maxlength="255" />
              <p class="md-field-hint">Walkthrough notifications and future login links go here. Your current session stays logged in.</p>
            </div>
          </div>

          <p v-if="settingsError" class="md-settings-error" role="alert">{{ settingsError }}</p>

          <div class="md-settings-actions">
            <button class="md-btn" :disabled="settingsSaving || !settingsDirty" @click="saveSettings">
              {{ settingsSaving ? 'Saving…' : settingsSaved ? 'Saved' : 'Save changes' }}
            </button>

            <div class="md-pause-wrap">
              <template v-if="confirmingPause">
                <span class="md-pause-confirm-text">Pause your capture link? Customers who open it will see an inactive-link message until you resume.</span>
                <button class="md-btn md-btn--danger" :disabled="pauseBusy" @click="togglePause">Yes, pause it</button>
                <button class="md-btn md-btn--quiet" @click="confirmingPause = false">Keep it live</button>
              </template>
              <button v-else class="md-btn md-btn--quiet" :disabled="pauseBusy" @click="togglePause">
                <Pause v-if="isActive" :size="15" aria-hidden="true" />
                <Play v-else :size="15" aria-hidden="true" />
                {{ pauseBusy ? 'Working…' : isActive ? 'Pause capture link' : 'Resume capture link' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <footer class="md-foot">
        Nexus Moves · Walkthrough inventories for moving quotes
      </footer>
    </main>
  </div>
</template>

<style scoped>
/* ============================================================
   Desktop-first, semantic tokens only (web_dashboard kit: white
   cards, hairline borders, soft cool shadows). Renders fine down
   to phone widths — movers are desktop, but nothing blocks.
   ============================================================ */
.md-page {
  min-height: 100vh;
  background: var(--bg);
  font-family: var(--font-ui);
  font-size: 15px;
  line-height: var(--lh-body);
  color: var(--text-primary);
}

/* ── Header ─────────────────────────────────────────────────── */
.md-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-5);
  padding: var(--sp-4) var(--sp-7);
  background: var(--surface-card);
  border-bottom: 1px solid var(--border);
}
.md-head-brand { display: flex; align-items: center; gap: var(--sp-4); min-width: 0; }
.md-logo { display: block; flex: none; line-height: 0; }
.md-logo :deep(svg) { height: 28px; width: auto; display: block; }
.md-head-eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--text-secondary);
  border-left: 1px solid var(--border);
  padding-left: var(--sp-4);
  white-space: nowrap;
}
.md-head-right { display: flex; align-items: center; gap: var(--sp-5); min-width: 0; }
.md-company-name {
  font-family: var(--font-display);
  font-weight: var(--fw-semibold);
  font-size: 15px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Layout ─────────────────────────────────────────────────── */
.md-main { max-width: 1040px; margin: 0 auto; padding: var(--sp-7) var(--sp-6) var(--sp-10); }

.md-card {
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  padding: var(--sp-5) var(--sp-6);
}

/* ── Hero row ───────────────────────────────────────────────── */
/* minmax(0, 1fr): the nowrap <code> snippets must scroll INSIDE their card,
   never widen the grid track and give the page a horizontal scrollbar. */
.md-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--sp-5); }
.md-hero-card { display: flex; flex-direction: column; min-width: 0; }
.md-hero-card-head { display: flex; align-items: center; gap: var(--sp-3); }
.md-hero-icon { color: var(--accent); flex: none; }
.md-hero-card-head h2 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: var(--fw-bold);
  font-size: 16px;
  letter-spacing: var(--ls-title);
}
.md-hero-sub { margin: var(--sp-2) 0 var(--sp-4); font-size: 13px; color: var(--text-secondary); }

.md-copy-row { display: flex; align-items: stretch; gap: var(--sp-3); margin-top: auto; }
.md-code {
  flex: 1;
  min-width: 0;
  display: block;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-secondary);
  background: var(--surface-sunk);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-sm);
  padding: var(--sp-3) var(--sp-4);
  white-space: nowrap;
  overflow-x: auto;
}

.md-paused-note {
  display: flex; align-items: center; gap: var(--sp-2);
  margin: var(--sp-3) 0 0;
  font-size: 12px; color: var(--warning-ink);
}
.md-demo-link {
  display: inline-flex; align-items: center; gap: var(--sp-2);
  margin-top: var(--sp-3);
  font-size: 12.5px; font-weight: var(--fw-semibold);
  color: var(--accent); text-decoration: none;
  align-self: flex-start;
}
.md-demo-link:hover { text-decoration: underline; }
.md-demo-link:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-xs); }

/* ── Buttons ────────────────────────────────────────────────── */
.md-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-2);
  border: 0;
  border-radius: var(--r-sm);
  background: var(--accent);
  color: var(--text-on-accent);
  font-family: var(--font-ui);
  font-weight: var(--fw-semibold);
  font-size: var(--fs-label);
  padding: 8px 14px;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.md-btn:hover { background: var(--accent-hover); }
.md-btn:active { transform: scale(0.97); }
.md-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.md-btn:disabled { opacity: 0.45; cursor: default; }

.md-btn--quiet { background: transparent; color: var(--text-secondary); border: 1px solid var(--border); }
.md-btn--quiet:hover { background: var(--surface-hover); }

.md-btn--danger { background: var(--danger); }
.md-btn--danger:hover { background: var(--danger); }

.md-btn--copy { flex: none; }
.md-btn--copied { background: var(--success); }
.md-btn--copied:hover { background: var(--success); }

/* ── Stat tiles ─────────────────────────────────────────────── */
.md-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-5); margin-top: var(--sp-5); }
.md-tile {
  display: flex; flex-direction: column;
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--surface-card); box-shadow: var(--shadow-sm);
  overflow: hidden;
  padding: 0 var(--sp-5) var(--sp-4);
}
.md-tile-bar { height: 3px; margin: 0 calc(-1 * var(--sp-5)) var(--sp-4); }
.md-bar-accent { background: var(--accent); }
.md-bar-shimmer { background: var(--shimmer); }
.md-bar-beacon { background: var(--beacon); }
.md-tile-lbl {
  font-family: var(--font-mono); font-size: 10px; font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-secondary);
}
.md-tile-num {
  font-family: var(--font-display); font-weight: var(--fw-bold);
  font-size: 28px; line-height: 1.2; color: var(--text-primary);
  margin-top: var(--sp-2); font-variant-numeric: tabular-nums;
}
.md-tile-sub { font-size: 11.5px; color: var(--text-tertiary); margin-top: var(--sp-1); }

/* ── Sections ───────────────────────────────────────────────── */
.md-section { margin-top: var(--sp-8); }
.md-section-title {
  margin: 0 0 var(--sp-4);
  font-family: var(--font-display);
  font-weight: var(--fw-bold);
  font-size: 19px;
  letter-spacing: var(--ls-title);
  color: var(--text-primary);
}

/* ── Table ──────────────────────────────────────────────────── */
.md-table-card { padding: var(--sp-2) 0 0; }
.md-table-scroll { overflow-x: auto; }
.md-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.md-table th {
  font-family: var(--font-mono); font-size: 9.5px; font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-tertiary);
  text-align: left; padding: var(--sp-3) var(--sp-4) var(--sp-3);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.md-table td {
  padding: var(--sp-4);
  border-bottom: 1px solid var(--border-soft);
  color: var(--text-primary);
  vertical-align: middle;
  white-space: nowrap;
}
.md-table tbody tr:last-child td { border-bottom: 0; }
.md-table tbody tr:hover td { background: var(--surface-hover); }
.md-table th:first-child, .md-table td:first-child { padding-left: var(--sp-6); }
.md-table th:last-child, .md-table td:last-child { padding-right: var(--sp-6); }
.md-col-num { text-align: right; font-variant-numeric: tabular-nums; }
.md-cell-email { font-weight: var(--fw-medium); max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.md-cell-date { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.md-cell-action { text-align: right; }
.md-cell-pending { font-size: 12px; color: var(--text-tertiary); }

.md-pill {
  display: inline-block;
  font-size: 10.5px; font-weight: var(--fw-bold); letter-spacing: 0.02em;
  border-radius: var(--r-pill); padding: 3px 10px; white-space: nowrap;
}
.md-pill--done { background: var(--success-quiet); color: var(--success); }
.md-pill--active { background: var(--accent-quiet); color: var(--accent-press); }

.md-badge {
  display: inline-block;
  font-size: 11px; color: var(--text-secondary);
  background: var(--surface-sunk); border: 1px solid var(--border);
  border-radius: var(--r-pill); padding: 2px 9px; white-space: nowrap;
}
.md-badge--widget { color: var(--accent-press); background: var(--accent-quiet); border-color: transparent; }

.md-view-link {
  display: inline-flex; align-items: center; gap: var(--sp-2);
  font-size: 12.5px; font-weight: var(--fw-semibold);
  color: var(--accent); text-decoration: none;
}
.md-view-link:hover { text-decoration: underline; }
.md-view-link:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-xs); }

/* ── Empty states ───────────────────────────────────────────── */
.md-empty { text-align: center; padding: var(--sp-8) var(--sp-7); }
.md-empty-icon { color: var(--text-tertiary); }
.md-empty h3 {
  margin: var(--sp-4) 0 0;
  font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 16px;
  color: var(--text-primary);
}
.md-empty p {
  margin: var(--sp-3) auto 0; max-width: 520px;
  font-size: 13px; color: var(--text-secondary);
}
.md-empty--compact { padding: var(--sp-6); }
.md-empty--compact p { margin-top: var(--sp-3); }

/* ── Error cards (quiet per-section degradation) ────────────── */
.md-error-card {
  display: flex; gap: var(--sp-4); align-items: flex-start;
  color: var(--warning-ink); background: var(--warning-surface);
}
.md-error-card > svg { flex: none; margin-top: 2px; }
.md-error-head { margin: 0 0 var(--sp-3); font-size: 13.5px; font-weight: var(--fw-semibold); }
.md-hero > .md-error-card { grid-column: 1 / -1; }

/* ── Settings ───────────────────────────────────────────────── */
.md-settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-6); }
.md-field { display: flex; flex-direction: column; }
.md-field-label { font-size: var(--fs-label); font-weight: var(--fw-semibold); margin-bottom: var(--sp-2); color: var(--text-primary); }
.md-input {
  border: 1.5px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--surface-card);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  color: var(--text-primary);
  padding: 9px 12px;
  outline: none;
  transition: border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
}
.md-input:focus-visible { border-color: var(--accent); box-shadow: var(--focus-ring); }
.md-field-hint { margin: var(--sp-2) 0 0; font-size: 11.5px; color: var(--text-tertiary); }

.md-settings-error { margin: var(--sp-4) 0 0; font-size: var(--fs-label); color: var(--danger); }

.md-settings-actions {
  display: flex; align-items: center; justify-content: space-between; gap: var(--sp-5);
  margin-top: var(--sp-5); padding-top: var(--sp-5);
  border-top: 1px solid var(--border-soft);
  flex-wrap: wrap;
}
.md-pause-wrap { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.md-pause-confirm-text { font-size: 12.5px; color: var(--text-secondary); max-width: 380px; }

/* ── Skeletons ──────────────────────────────────────────────── */
.md-skel {
  background: var(--surface-hover);
  border-radius: var(--r-xs);
  animation: md-pulse 1.4s ease-in-out infinite;
}
@keyframes md-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
@media (prefers-reduced-motion: reduce) {
  .md-skel { animation: none; }
}
.md-skel--label { height: 12px; width: 40%; }
.md-skel--line { height: 34px; width: 100%; margin-top: var(--sp-4); }
.md-skel--btn { height: 20px; width: 25%; margin-top: var(--sp-4); }
.md-skel--num { height: 30px; width: 30%; margin-top: var(--sp-3); }
.md-skel--row { height: 22px; width: 100%; }
.md-skel--row + .md-skel--row { margin-top: var(--sp-4); }
.md-skel-card > .md-skel--row { margin-top: var(--sp-4); }
.md-tile > .md-skel--label { margin-top: var(--sp-4); }

.md-visually-hidden {
  position: absolute; width: 1px; height: 1px;
  clip: rect(0 0 0 0); clip-path: inset(50%); overflow: hidden; white-space: nowrap;
}

/* ── Footer ─────────────────────────────────────────────────── */
.md-foot {
  margin-top: var(--sp-9); padding-top: var(--sp-5);
  border-top: 1px solid var(--border);
  font-size: 12px; color: var(--text-tertiary);
  text-align: center;
}

/* ── Narrow screens (not blocked, just stacked) ─────────────── */
@media (max-width: 860px) {
  .md-hero { grid-template-columns: 1fr; }
  .md-tiles { grid-template-columns: repeat(3, 1fr); }
  .md-settings-grid { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .md-head { padding: var(--sp-4) var(--sp-5); flex-wrap: wrap; }
  .md-head-eyebrow { display: none; }
  .md-main { padding: var(--sp-5) var(--sp-4) var(--sp-9); }
  .md-tiles { grid-template-columns: 1fr; }
  .md-settings-actions { flex-direction: column; align-items: stretch; }
}
</style>
