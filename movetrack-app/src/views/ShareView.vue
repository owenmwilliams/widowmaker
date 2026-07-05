<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { API_BASE_URL } from '../config/api'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { ArrowRight, Mic, TriangleAlert } from 'lucide-vue-next'

/* ============================================================
   Shared Mover Inventory — public, read-only document at
   /share/:token. Movers print this to PDF for quoting, so the
   layout is a print-grade US Letter sheet with running header/
   footer. Data comes from GET /public/inventory/:token — the
   payload is unchanged; everything below is derived client-side.
   ============================================================ */

const route = useRoute()
const core_url = API_BASE_URL

// ── Payload types (API shape — do not change) ────────────────
type ReportItem = {
  name: string; quantity: number; weightLbs: number | null
  dimensionsIn: { length: number; width: number; height: number } | null
  volumeCuFt: number | null; fragile: boolean; oversized: boolean; material: string | null
}
type PayloadRoom = { name: string; items: ReportItem[] }
type Loc = {
  name: string; type: string | null; address: string | null
  access: { hasStairs?: boolean | null; numberOfFlights?: number | null; hasElevator?: boolean | null; parking?: string | null; entryType?: string | null; notes?: string | null }
  rooms: PayloadRoom[]
}
type Report = {
  title: string | null; generatedAt: string
  totals: { itemCount: number; totalWeightLbs: number; totalVolumeCuFt: number; fragileCount: number; missingWeight: number; missingDimensions: number }
  confidence?: { itemCount: number; measuredWeightPct: number; totalWeightLbs: number; bedrooms: number | null; reasonableness: { hasBenchmark: boolean; status: string; severity: string; message: string } }
  walkthroughs?: { room: string; url: string; thumbnailUrl: string | null; notes: string | null }[]
  specialItems: { name: string; quantity: number; fragile: boolean; oversized: boolean }[]
  locations: Loc[]
  move: { name?: string; moveDate?: string; origin?: any; destination?: any } | null
}

// ── Document types (derived in the view, never stored) ───────
type Flag = 'oversized' | 'heavy' | 'fragile'
type DocItem = {
  name: string; qty: number; weightLbs: number | null
  dims: { l: number; w: number; h: number } | null
  volCuFt: number | null; flags: Flag[]
  weighOnSite: boolean; room: string
}
type ItemGroup = { count: string; label: string; note: string }
type DocRoom = { name: string; itemCount: number; note: string | null; items: DocItem[]; groups: ItemGroup[] }

const loading = ref(true)
const error = ref<string | null>(null)
const report = ref<Report | null>(null)

// ── Options — query params now, props so the share dialog can
//    drive them later without URL munging. ────────────────────
// null defaults (not plain optional booleans) so Vue's boolean-prop
// casting can't turn "prop not passed" into false and mask the query.
const props = withDefaults(
  defineProps<{ detailTables?: boolean | null; density?: 'comfortable' | 'compact' | null }>(),
  { detailTables: null, density: null }
)
const detailTables = ref<boolean>(props.detailTables ?? route.query.tables !== '0')
const density = ref<'comfortable' | 'compact'>(
  props.density ?? (route.query.density === 'compact' ? 'compact' : 'comfortable')
)

onMounted(async () => {
  try {
    const { data } = await axios.get(`${core_url}/public/inventory/${route.params.token}`)
    report.value = data
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'This inventory could not be loaded.'
  } finally {
    loading.value = false
  }
})

const printPage = () => window.print()

// ── Derivations ──────────────────────────────────────────────
const HEAVY_LBS = 65
const GROUP_MIN_QTY = 10
const SPECIAL_CAP = 9
// Large furniture worth weighing on site when the weight is TBD.
const FURNITURE_RE = /\b(sofa|couch|sectional|loveseat|recliner|chaise|ottoman|dresser|wardrobe|armoire|bed|mattress|headboard|piano|table|desk|cabinet|bookcase|bookshelf|shelving|hutch|credenza|sideboard|buffet|chest|trunk|refrigerator|fridge|freezer|washer|dryer|dishwasher|range|oven|stove|treadmill|elliptical|safe|grill|bench|mirror)\b/i

const fmt = (n: number) => n.toLocaleString('en-US')

const itemFlags = (it: ReportItem): Flag[] => {
  const flags: Flag[] = []
  if (it.oversized) flags.push('oversized')
  else if ((it.weightLbs ?? 0) >= HEAVY_LBS) flags.push('heavy')
  if (it.fragile) flags.push('fragile')
  return flags
}

// A homogeneous zero-data bucket: no weight, no dims, big count
// (books, wine, décor). Rendered as a summary card, never rows.
const isGroupBucket = (it: ReportItem) =>
  it.weightLbs == null && it.dimensionsIn == null && (it.quantity || 1) >= GROUP_MIN_QTY

const rooms = computed<DocRoom[]>(() => {
  const r = report.value
  if (!r) return []
  const locsWithRooms = r.locations.filter((l) => l.rooms.length > 0)
  const multiLoc = locsWithRooms.length > 1
  const out: DocRoom[] = []
  for (const loc of locsWithRooms) {
    for (const pr of loc.rooms) {
      const name = multiLoc ? `${pr.name} · ${loc.name}` : pr.name
      const items: DocItem[] = []
      const groups: ItemGroup[] = []
      let itemCount = 0
      let fragileQty = 0, oversizedQty = 0, tbdQty = 0
      for (const it of pr.items) {
        const qty = it.quantity || 1
        itemCount += qty
        if (it.fragile) fragileQty += qty
        if (it.oversized) oversizedQty += qty
        if (isGroupBucket(it)) {
          groups.push({
            count: `≈${fmt(qty)}`,
            label: it.name,
            note: it.material
              ? `${it.material} — count is a customer estimate, no per-item measurements`
              : 'Count is a customer estimate — no per-item measurements',
          })
          continue
        }
        const weighOnSite = it.weightLbs == null && (it.oversized || FURNITURE_RE.test(it.name))
        if (weighOnSite) tbdQty += qty
        items.push({
          name: it.name,
          qty,
          weightLbs: it.weightLbs,
          dims: it.dimensionsIn
            ? { l: it.dimensionsIn.length, w: it.dimensionsIn.width, h: it.dimensionsIn.height }
            : null,
          volCuFt: it.volumeCuFt,
          flags: itemFlags(it),
          weighOnSite,
          room: name,
        })
      }
      // Weight desc, nulls last — heaviest lifts first.
      items.sort((a, b) => (b.weightLbs ?? -1) - (a.weightLbs ?? -1))
      const noteParts: string[] = []
      if (oversizedQty) noteParts.push(`${oversizedQty} oversized`)
      if (fragileQty) noteParts.push(`${fragileQty} fragile`)
      if (tbdQty) noteParts.push(`${tbdQty} to weigh on site`)
      if (groups.length) noteParts.push(`${groups.length} estimated-count group${groups.length === 1 ? '' : 's'}`)
      out.push({ name, itemCount, note: noteParts.length ? noteParts.join(' · ') : null, items, groups })
    }
  }
  return out
})

// Special handling = oversized OR ≥65 lb; oversized first, then
// weight desc. Movers read this before anything else.
const specialAll = computed<DocItem[]>(() =>
  rooms.value
    .flatMap((rm) => rm.items)
    .filter((it) => it.flags.includes('oversized') || (it.weightLbs ?? 0) >= HEAVY_LBS)
    .sort((a, b) => {
      const ao = a.flags.includes('oversized') ? 1 : 0
      const bo = b.flags.includes('oversized') ? 1 : 0
      if (ao !== bo) return bo - ao
      return (b.weightLbs ?? 0) - (a.weightLbs ?? 0)
    })
)
const specialHandling = computed(() => specialAll.value.slice(0, SPECIAL_CAP))
const specialOverflow = computed(() => Math.max(0, specialAll.value.length - SPECIAL_CAP))

const totals = computed(() => {
  const r = report.value
  if (!r) return null
  const items = r.totals.itemCount
  const measuredCount = Math.max(0, items - r.totals.missingWeight)
  const measuredPct = r.confidence?.measuredWeightPct ?? (items > 0 ? Math.round((measuredCount / items) * 100) : 0)
  return {
    items,
    estWeightLbs: Math.round(r.totals.totalWeightLbs),
    estVolumeCuFt: Math.round(r.totals.totalVolumeCuFt),
    specialHandlingCount: specialAll.value.length,
    measuredPct,
    measuredCount,
    estimatedCount: r.totals.missingWeight,
  }
})

// The payload has no explicit customer-name field; the share
// title (set by the customer) or the saved move's name stand in.
const customerName = computed(() => report.value?.title || report.value?.move?.name || null)
const heading = computed(() => {
  const n = customerName.value
  if (!n) return 'Moving inventory'
  return /\b(move|inventory)\b/i.test(n) ? n : `${n}’s move`
})
const generatedLabel = computed(() =>
  report.value
    ? new Date(report.value.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : ''
)

const placeLabel = (p: any) => (p ? [p.city, p.state].filter(Boolean).join(', ') || p.name || null : null)

const origin = computed(() => {
  const r = report.value
  if (!r) return null
  const loc = r.locations.find((l) => l.type !== 'destination' && l.rooms.length > 0) || r.locations[0]
  const title = (r.move?.origin && placeLabel(r.move.origin)) || loc?.name || 'Origin'
  return { title, line: loc?.address || null }
})
const destination = computed(() => {
  const r = report.value
  if (!r?.move?.destination) return null
  const loc = r.locations.find((l) => l.type === 'destination')
  return { title: placeLabel(r.move.destination) || 'Destination', line: loc?.address || null }
})
const moveDateLabel = computed(() =>
  report.value?.move?.moveDate
    ? new Date(report.value.move.moveDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : null
)

// Origin access details — stairs and parking change a quote.
const accessChips = computed<string[]>(() => {
  const r = report.value
  if (!r) return []
  const loc = r.locations.find((l) => l.type !== 'destination' && l.rooms.length > 0) || r.locations[0]
  const a = loc?.access || {}
  const chips: string[] = []
  if (a.hasStairs) chips.push(a.numberOfFlights ? `Stairs · ${a.numberOfFlights} flight${a.numberOfFlights === 1 ? '' : 's'}` : 'Stairs')
  if (a.hasElevator) chips.push('Elevator')
  if (a.parking) chips.push(`Parking: ${a.parking}`)
  if (a.entryType) chips.push(`Entry: ${a.entryType}`)
  if (a.notes) chips.push(a.notes)
  return chips
})

const dimsLabel = (d: DocItem['dims']) => (d ? `${d.l}×${d.w}×${d.h}` : '—')
const volLabel = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 1 }))
</script>

<template>
  <div class="share-page" :class="{ 'density-compact': density === 'compact' }">
    <div v-if="loading" class="state">Loading inventory…</div>

    <div v-else-if="error" class="state error">
      <h2>Inventory unavailable</h2>
      <p>{{ error }}</p>
    </div>

    <template v-else-if="report && totals">
      <div class="toolbar no-print">
        <button class="print-btn" @click="printPage">Save or print PDF</button>
      </div>

      <div class="sheet">
        <!-- (1) Running header — repeats on every printed page -->
        <header class="run-head">
          <div class="brand">
            <svg class="brand-mark" width="22" height="22" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <defs>
                <linearGradient id="nxShareRouteA" x1="38" y1="42" x2="90" y2="96" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#4F5BF0" /><stop offset="100%" stop-color="#2F35B4" />
                </linearGradient>
                <radialGradient id="nxShareGlowA" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stop-color="#FFD8BF" /><stop offset="45%" stop-color="#F98D5B" /><stop offset="100%" stop-color="#F98D5B" stop-opacity="0" />
                </radialGradient>
              </defs>
              <path d="M38 96 L38 42 L90 96 L90 48" stroke="url(#nxShareRouteA)" stroke-width="17" stroke-linecap="round" stroke-linejoin="round" />
              <circle cx="90" cy="42" r="18" fill="url(#nxShareGlowA)" />
              <circle cx="90" cy="42" r="9.5" fill="#F98D5B" />
              <circle cx="90" cy="42" r="4.4" fill="#FFE2D4" />
            </svg>
            <span class="brand-word">Nexus Moves</span>
          </div>
          <span class="run-eyebrow">Moving inventory · Shared for quoting</span>
        </header>

        <!-- Print frame: thead/tfoot spacers repeat per page and
             reserve room for the fixed running header/footer. -->
        <table class="page-frame" role="presentation">
          <thead class="frame-spacer"><tr><td><div class="head-space"></div></td></tr></thead>
          <tbody>
            <tr>
              <td class="frame-body">

                <!-- (2) Title block -->
                <section class="title-block">
                  <div class="title-main">
                    <p class="eyebrow">Shared mover inventory</p>
                    <h1>{{ heading }}</h1>
                    <p class="title-sub">Generated {{ generatedLabel }} · AI-assisted self-report, reviewed by the customer</p>
                  </div>
                  <div class="rooms-count">
                    <span class="rc-label">Rooms catalogued</span>
                    <span class="rc-num">{{ rooms.length }}</span>
                  </div>
                </section>

                <!-- (3) Route card -->
                <section class="route-card">
                  <div class="route-main">
                    <div class="route-end">
                      <span class="route-lbl">From</span>
                      <span class="route-city">{{ origin?.title }}</span>
                      <span v-if="origin?.line" class="route-line">{{ origin.line }}</span>
                    </div>
                    <ArrowRight :size="20" class="route-arrow" aria-hidden="true" />
                    <div v-if="destination" class="route-end">
                      <span class="route-lbl">To</span>
                      <span class="route-city">{{ destination.title }}</span>
                      <span v-if="destination.line" class="route-line">{{ destination.line }}</span>
                    </div>
                    <div v-else class="route-end route-pending">
                      <span class="route-lbl">To</span>
                      <span class="route-city pending"><span class="beacon-dot" aria-hidden="true"></span>Destination pending</span>
                      <span class="route-line">Confirm delivery address with customer</span>
                    </div>
                    <span v-if="moveDateLabel" class="route-date">{{ moveDateLabel }}</span>
                  </div>
                  <div v-if="accessChips.length" class="route-access">
                    <span v-for="(c, i) in accessChips" :key="i" class="access-chip">{{ c }}</span>
                  </div>
                </section>

                <!-- (4) Stat tiles -->
                <section class="tiles">
                  <div class="tile">
                    <div class="tile-bar bar-shimmer" aria-hidden="true"></div>
                    <span class="tile-lbl">Items</span>
                    <span class="tile-num">{{ fmt(totals.items) }}</span>
                    <span class="tile-sub">across {{ rooms.length }} room{{ rooms.length === 1 ? '' : 's' }}</span>
                  </div>
                  <div class="tile">
                    <div class="tile-bar bar-accent" aria-hidden="true"></div>
                    <span class="tile-lbl">Est. weight (lbs)</span>
                    <span class="tile-num">{{ fmt(totals.estWeightLbs) }}</span>
                    <span class="tile-sub">measured + AI estimates</span>
                  </div>
                  <div class="tile">
                    <div class="tile-bar bar-accent" aria-hidden="true"></div>
                    <span class="tile-lbl">Est. volume (cu ft)</span>
                    <span class="tile-num">{{ fmt(totals.estVolumeCuFt) }}</span>
                    <span class="tile-sub">from item dimensions</span>
                  </div>
                  <div class="tile">
                    <div class="tile-bar bar-beacon" aria-hidden="true"></div>
                    <span class="tile-lbl">Special handling</span>
                    <span class="tile-num">{{ fmt(totals.specialHandlingCount) }}</span>
                    <span class="tile-sub">oversized or ≥{{ HEAVY_LBS }} lb</span>
                  </div>
                </section>

                <!-- (5) Measured bar -->
                <section class="measured">
                  <div class="measured-row">
                    <span class="measured-title">{{ totals.measuredPct }}% of items have measured weights</span>
                    <span class="measured-meta">{{ fmt(totals.measuredCount) }} measured · {{ fmt(totals.estimatedCount) }} estimated</span>
                  </div>
                  <div class="measured-track" role="img" :aria-label="`${totals.measuredPct} percent of items have measured weights`">
                    <div class="measured-fill" :style="{ width: totals.measuredPct + '%' }"></div>
                  </div>
                </section>

                <!-- (6) Honest banner -->
                <section v-if="totals.measuredPct < 100" class="honest">
                  <TriangleAlert :size="18" class="honest-icon" aria-hidden="true" />
                  <div>
                    <p class="honest-head">Estimates run conservative — confirm scope on site</p>
                    <p class="honest-body">
                      Weights for {{ fmt(totals.estimatedCount) }} of {{ fmt(totals.items) }} items are AI estimates,
                      not measurements. Treat totals as a floor for quoting, not a ceiling.
                    </p>
                  </div>
                </section>

                <!-- (7) Special handling — movers read this first -->
                <section v-if="specialHandling.length" class="doc-section">
                  <h2>Special handling</h2>
                  <div class="sh-grid">
                    <div v-for="(it, i) in specialHandling" :key="i" class="sh-card">
                      <div class="sh-top">
                        <span class="sh-name">{{ it.name }}<template v-if="it.qty > 1"> ×{{ it.qty }}</template></span>
                        <span v-if="it.flags.includes('oversized')" class="pill pill-oversized">Oversized</span>
                        <span v-else class="pill pill-heavy">Heavy</span>
                      </div>
                      <span class="sh-weight">{{ it.weightLbs != null ? `${fmt(it.weightLbs)} lb` : 'TBD' }}</span>
                      <span class="sh-dims">{{ it.dims ? dimsLabel(it.dims) + ' in' : 'dims TBD' }}</span>
                      <span class="sh-room">{{ it.room }}</span>
                    </div>
                  </div>
                  <p v-if="specialOverflow" class="sh-more">+ {{ specialOverflow }} more flagged item{{ specialOverflow === 1 ? '' : 's' }} in the room tables below.</p>
                </section>

                <!-- (8) Rooms overview -->
                <section v-if="rooms.length" class="doc-section">
                  <h2>Rooms</h2>
                  <div class="ro-grid">
                    <div v-for="rm in rooms" :key="rm.name" class="ro-card">
                      <span class="ro-name">{{ rm.name }}</span>
                      <span class="ro-count">{{ fmt(rm.itemCount) }} item{{ rm.itemCount === 1 ? '' : 's' }}</span>
                      <span v-if="rm.note" class="ro-note">{{ rm.note }}</span>
                    </div>
                  </div>
                </section>

                <!-- (9) Per-room detail tables -->
                <template v-if="detailTables">
                  <section v-for="rm in rooms" :key="'d-' + rm.name" class="doc-section room-detail">
                    <div class="room-head">
                      <h3>{{ rm.name }}</h3>
                      <span class="room-count">{{ fmt(rm.itemCount) }} item{{ rm.itemCount === 1 ? '' : 's' }}</span>
                    </div>
                    <p v-if="rm.note" class="room-note">{{ rm.note }}</p>

                    <table v-if="rm.items.length" class="items">
                      <thead>
                        <tr>
                          <th scope="col" class="col-item">Item</th>
                          <th scope="col" class="col-num">Qty</th>
                          <th scope="col" class="col-num">Weight</th>
                          <th scope="col" class="col-num">Dimensions (in)</th>
                          <th scope="col" class="col-num">Cu ft</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(it, i) in rm.items" :key="i">
                          <td class="cell-item">
                            {{ it.name }}
                            <span v-if="it.flags.includes('oversized')" class="pill pill-oversized">Oversized</span>
                            <span v-if="it.weighOnSite" class="pill pill-weigh">Weigh on site</span>
                            <span v-if="it.flags.includes('fragile')" class="pill pill-fragile">Fragile</span>
                          </td>
                          <td class="cell-num">{{ fmt(it.qty) }}</td>
                          <td class="cell-num">{{ it.weightLbs != null ? fmt(it.weightLbs) + ' lb' : (it.weighOnSite ? 'TBD' : '—') }}</td>
                          <td class="cell-num cell-dims">{{ dimsLabel(it.dims) }}</td>
                          <td class="cell-num">{{ volLabel(it.volCuFt) }}</td>
                        </tr>
                      </tbody>
                    </table>

                    <div v-if="rm.groups.length" class="group-grid">
                      <div v-for="(g, i) in rm.groups" :key="i" class="group-card">
                        <span class="group-count">{{ g.count }}</span>
                        <div class="group-text">
                          <span class="group-label">{{ g.label }}</span>
                          <span class="group-note">{{ g.note }}</span>
                        </div>
                      </div>
                    </div>
                  </section>
                </template>

                <!-- Room walkthroughs — screen only, never printed -->
                <section v-if="report.walkthroughs && report.walkthroughs.length" class="doc-section walkthroughs no-print">
                  <h2>Room walkthroughs</h2>
                  <div class="vid-grid">
                    <figure v-for="(w, i) in report.walkthroughs" :key="i" class="vid">
                      <video :src="w.url" :poster="w.thumbnailUrl || undefined" controls preload="none" playsinline></video>
                      <figcaption>{{ w.room }}</figcaption>
                      <p v-if="w.notes" class="vid-notes"><Mic :size="12" class="note-icon" aria-hidden="true" /> {{ w.notes }}</p>
                    </figure>
                  </div>
                </section>

                <!-- (11) Closing line -->
                <div class="closing">
                  <svg class="closing-mark" width="14" height="14" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <defs>
                      <linearGradient id="nxShareRouteB" x1="38" y1="42" x2="90" y2="96" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stop-color="#4F5BF0" /><stop offset="100%" stop-color="#2F35B4" />
                      </linearGradient>
                    </defs>
                    <path d="M38 96 L38 42 L90 96 L90 48" stroke="url(#nxShareRouteB)" stroke-width="17" stroke-linecap="round" stroke-linejoin="round" />
                    <circle cx="90" cy="42" r="9.5" fill="#F98D5B" />
                    <circle cx="90" cy="42" r="4.4" fill="#FFE2D4" />
                  </svg>
                  <span>Shared via Nexus Moves · a read-only inventory for moving quotes.</span>
                </div>

              </td>
            </tr>
          </tbody>
          <tfoot class="frame-spacer"><tr><td><div class="foot-space"></div></td></tr></tfoot>
        </table>

        <!-- (10) Running footer — repeats on every printed page -->
        <footer class="run-foot">
          <span>Read-only inventory · confirm scope on site</span>
          <span class="run-foot-brand">Nexus Moves</span>
        </footer>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ============================================================
   SCREEN — a Letter-proportioned sheet on the app background.
   Semantic tokens only; px literals are the compact print type
   scale + hairlines per the spec.
   ============================================================ */
.share-page {
  min-height: 100vh;
  background: var(--bg);
  padding: var(--sp-7) var(--sp-6) var(--sp-11);
  font-family: var(--font-ui);
  font-size: 15px;
  line-height: var(--lh-body);
  color: var(--text-primary);
}
.state { text-align: center; padding: 80px 20px; color: var(--text-secondary); }
.state.error h2 { color: var(--danger); font-family: var(--font-display); }

.toolbar { max-width: 880px; margin: 0 auto var(--sp-4); display: flex; justify-content: flex-end; }
.print-btn {
  background: var(--accent); color: var(--text-on-accent); border: 0;
  border-radius: var(--r-sm); padding: 9px 16px;
  font-family: var(--font-ui); font-weight: var(--fw-semibold); font-size: var(--fs-label);
  cursor: pointer; transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.print-btn:hover { background: var(--accent-hover); }
.print-btn:active { transform: scale(0.97); }
.print-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.print-btn:disabled { opacity: 0.45; }

.sheet {
  max-width: 880px; margin: 0 auto;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

/* ── (1) Running header ─────────────────────────────────────── */
.run-head {
  display: flex; align-items: center; justify-content: space-between; gap: var(--sp-5);
  padding: var(--sp-6) 44px var(--sp-4);
  border-bottom: 1px solid var(--border);
  background: var(--surface-card);
}
.brand { display: flex; align-items: center; gap: var(--sp-3); }
.brand-mark { display: block; flex: none; }
.brand-word { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 16px; letter-spacing: var(--ls-title); color: var(--text-primary); }
.run-eyebrow {
  font-family: var(--font-mono); font-size: 10px; font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-secondary);
  text-align: right;
}

/* Print frame table is invisible layout on screen. */
.page-frame { width: 100%; border-collapse: collapse; }
.page-frame > .frame-spacer td { padding: 0; }
.head-space, .foot-space { height: 0; }
.frame-body { padding: var(--sp-7) 44px var(--sp-8); }

/* ── (2) Title block ────────────────────────────────────────── */
.title-block { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-6); }
.eyebrow {
  margin: 0 0 var(--sp-3); font-family: var(--font-mono); font-size: 10.5px;
  font-weight: var(--fw-semibold); letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase; color: var(--accent);
}
h1 {
  margin: 0; font-family: var(--font-display); font-weight: var(--fw-bold);
  font-size: 33px; line-height: var(--lh-tight); letter-spacing: var(--ls-display);
  color: var(--text-primary);
}
.title-sub { margin: var(--sp-3) 0 0; font-size: 13px; color: var(--text-secondary); }
.rooms-count { display: flex; flex-direction: column; align-items: flex-end; text-align: right; flex: none; padding-top: var(--sp-2); }
.rc-label { font-family: var(--font-mono); font-size: 10px; font-weight: var(--fw-semibold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-tertiary); }
.rc-num { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 26px; line-height: 1.15; color: var(--text-primary); font-variant-numeric: tabular-nums; }

/* ── (3) Route card ─────────────────────────────────────────── */
.route-card {
  margin-top: var(--sp-6); padding: var(--sp-5) var(--sp-6);
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--surface-sunk);
}
.route-main { display: flex; align-items: center; gap: var(--sp-6); flex-wrap: wrap; }
.route-end { display: flex; flex-direction: column; min-width: 0; }
.route-lbl { font-family: var(--font-mono); font-size: 10px; font-weight: var(--fw-semibold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-tertiary); margin-bottom: var(--sp-1); }
.route-city { font-family: var(--font-display); font-weight: var(--fw-semibold); font-size: 17px; color: var(--text-primary); }
.route-city.pending { color: var(--text-secondary); font-weight: var(--fw-medium); display: inline-flex; align-items: center; }
.route-line { font-size: 12.5px; color: var(--text-secondary); margin-top: var(--sp-1); }
.route-pending .route-line { color: var(--text-secondary); }
.route-arrow { color: var(--accent); flex: none; }
.route-date { margin-left: auto; font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.beacon-dot { width: 8px; height: 8px; border-radius: var(--r-pill); background: var(--beacon); display: inline-block; margin-right: var(--sp-3); flex: none; }
.route-access { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-4); padding-top: var(--sp-4); border-top: 1px solid var(--border); }
.access-chip { font-size: 11.5px; color: var(--text-secondary); background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--r-pill); padding: 3px 10px; }

/* ── (4) Stat tiles ─────────────────────────────────────────── */
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--sp-4); margin-top: var(--sp-6); }
.tile {
  display: flex; flex-direction: column;
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--surface-card); overflow: hidden;
  padding: 0 var(--sp-5) var(--sp-4);
}
.tile-bar { height: 3px; margin: 0 calc(-1 * var(--sp-5)) var(--sp-4); }
.bar-shimmer { background: var(--shimmer); }
.bar-accent { background: var(--accent); }
.bar-beacon { background: var(--beacon); }
.tile-lbl { font-family: var(--font-mono); font-size: 10px; font-weight: var(--fw-semibold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-secondary); }
.tile-num { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 26px; line-height: 1.2; color: var(--text-primary); margin-top: var(--sp-2); font-variant-numeric: tabular-nums; }
.tile-sub { font-size: 11.5px; color: var(--text-tertiary); margin-top: var(--sp-1); }

/* ── (5) Measured bar ───────────────────────────────────────── */
.measured { margin-top: var(--sp-6); }
.measured-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-4); flex-wrap: wrap; }
.measured-title { font-size: 13.5px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.measured-meta { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.measured-track { margin-top: var(--sp-3); height: 8px; border-radius: var(--r-pill); background: var(--surface-hover); border: 1px solid var(--border-soft); overflow: hidden; }
.measured-fill { height: 100%; background: var(--shimmer); border-radius: var(--r-pill); }

/* ── (6) Honest banner ──────────────────────────────────────── */
.honest {
  display: flex; gap: var(--sp-4); align-items: flex-start;
  margin-top: var(--sp-6); padding: var(--sp-5) var(--sp-6);
  background: var(--warning-surface); border: 1px solid var(--border);
  border-radius: var(--r-lg); color: var(--warning-ink);
}
.honest-icon { flex: none; margin-top: 1px; color: var(--warning-ink); }
.honest-head { margin: 0; font-weight: var(--fw-bold); font-size: 14px; }
.honest-body { margin: var(--sp-2) 0 0; font-size: 12.5px; line-height: var(--lh-body); }

/* ── Section scaffolding ────────────────────────────────────── */
.doc-section { margin-top: var(--sp-8); }
h2 {
  margin: 0 0 var(--sp-4); font-family: var(--font-display); font-weight: var(--fw-bold);
  font-size: 19px; letter-spacing: var(--ls-title); color: var(--text-primary);
}

/* ── (7) Special handling cards ─────────────────────────────── */
.sh-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-4); }
.sh-card {
  display: flex; flex-direction: column;
  border: 1px solid var(--border); border-radius: var(--r-lg);
  padding: var(--sp-4) var(--sp-5); background: var(--surface-card);
}
.sh-top { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-3); }
.sh-name { font-weight: var(--fw-semibold); font-size: 13.5px; color: var(--text-primary); }
.sh-weight { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 22px; color: var(--text-primary); margin-top: var(--sp-3); font-variant-numeric: tabular-nums; }
.sh-dims { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); margin-top: var(--sp-1); font-variant-numeric: tabular-nums; }
.sh-room { font-size: 11.5px; color: var(--text-tertiary); margin-top: var(--sp-2); }
.sh-more { margin: var(--sp-3) 0 0; font-size: 12px; color: var(--text-secondary); }

/* Pills */
.pill {
  display: inline-block; vertical-align: 1px;
  font-family: var(--font-ui); font-size: 10px; font-weight: var(--fw-bold);
  letter-spacing: 0.02em; border-radius: var(--r-pill); padding: 2px 8px;
  white-space: nowrap;
}
.pill-oversized { background: color-mix(in oklab, var(--beacon) 18%, transparent); color: var(--warning-ink); }
.pill-heavy { background: var(--accent-quiet); color: var(--accent-press); }
.pill-weigh { background: var(--warning-surface); color: var(--warning-ink); border: 1px solid var(--border); }
.pill-fragile { background: transparent; color: var(--text-secondary); border: 1px solid var(--border); }
.cell-item .pill { margin-left: var(--sp-2); }

/* ── (8) Rooms overview cards ───────────────────────────────── */
.ro-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-4); }
.ro-card {
  display: flex; flex-direction: column;
  border: 1px solid var(--border); border-radius: var(--r-lg);
  padding: var(--sp-4) var(--sp-5); background: var(--surface-card);
}
.ro-name { font-weight: var(--fw-semibold); font-size: 13.5px; color: var(--text-primary); }
.ro-count { font-family: var(--font-mono); font-size: 11.5px; font-weight: var(--fw-semibold); color: var(--accent); margin-top: var(--sp-2); font-variant-numeric: tabular-nums; }
.ro-note { font-size: 11.5px; color: var(--text-tertiary); margin-top: var(--sp-1); }

/* ── (9) Per-room detail ────────────────────────────────────── */
.room-detail { margin-top: var(--sp-7); }
.room-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-4); }
.room-head h3 { margin: 0; font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 15.5px; color: var(--text-primary); }
.room-count { font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
.room-note { margin: var(--sp-2) 0 0; font-size: 11.5px; color: var(--text-tertiary); }

table.items { width: 100%; border-collapse: collapse; margin-top: var(--sp-4); font-size: 12.5px; }
table.items th {
  font-family: var(--font-mono); font-size: 9.5px; font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-tertiary);
  text-align: left; padding: 0 10px 6px;
  border-bottom: 2px solid var(--text-primary); /* heavy underline on header row */
}
table.items th.col-num { text-align: right; }
table.items td { padding: 8px 10px; border-bottom: 1px solid var(--border-soft); color: var(--text-primary); vertical-align: top; }
.cell-item { font-weight: var(--fw-medium); }
.cell-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--text-secondary); }
.cell-dims { font-family: var(--font-mono); font-size: 11.5px; }
table.items th:first-child, table.items td:first-child { padding-left: 0; }
table.items th:last-child, table.items td:last-child { padding-right: 0; }

/* Density option: compact shrinks row padding + table type. */
.density-compact table.items { font-size: 11.5px; }
.density-compact table.items td { padding: 5px 10px; }
.density-compact .cell-dims { font-size: 10.5px; }

/* Item groups — zero-data buckets as summary cards, never rows */
.group-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--sp-4); margin-top: var(--sp-4); }
.group-card {
  display: flex; align-items: center; gap: var(--sp-5);
  border: 1px solid var(--border); border-radius: var(--r-lg);
  padding: var(--sp-4) var(--sp-5); background: var(--surface-sunk);
}
.group-count { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 24px; color: var(--accent); flex: none; font-variant-numeric: tabular-nums; }
.group-text { display: flex; flex-direction: column; min-width: 0; }
.group-label { font-weight: var(--fw-semibold); font-size: 13px; color: var(--text-primary); }
.group-note { font-size: 11.5px; color: var(--text-secondary); margin-top: var(--sp-1); }

/* ── Walkthroughs (screen only) ─────────────────────────────── */
.vid-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--sp-5); align-items: start; }
.vid { margin: 0; }
.vid video { width: 100%; height: auto; max-height: 70vh; border-radius: var(--r-sm); background: var(--surface-sunk); display: block; }
.vid figcaption { font-size: var(--fs-label); color: var(--text-secondary); margin-top: var(--sp-2); text-transform: capitalize; }
.vid-notes { font-size: var(--fs-label); color: var(--text-secondary); margin: var(--sp-2) 0 0; background: var(--surface-sunk); border: 1px solid var(--border); border-radius: var(--r-xs); padding: var(--sp-3); }
.note-icon { vertical-align: -1px; margin-right: var(--sp-1); color: var(--text-tertiary); }

/* ── (11) Closing line ──────────────────────────────────────── */
.closing {
  display: flex; align-items: center; justify-content: center; gap: var(--sp-3);
  margin-top: var(--sp-9); padding-top: var(--sp-5);
  border-top: 1px solid var(--border);
  font-size: 12px; color: var(--text-tertiary);
}
.closing-mark { flex: none; }

/* ── (10) Running footer ────────────────────────────────────── */
.run-foot {
  display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4);
  padding: var(--sp-4) 44px var(--sp-5);
  border-top: 1px solid var(--border);
  font-size: 11px; color: var(--text-tertiary);
  background: var(--surface-card);
}
.run-foot-brand { font-family: var(--font-display); font-weight: var(--fw-semibold); color: var(--text-secondary); }

/* ── Small screens ──────────────────────────────────────────── */
@media (max-width: 720px) {
  .share-page { padding: var(--sp-5) var(--sp-4) var(--sp-9); }
  .frame-body { padding: var(--sp-6) var(--sp-5) var(--sp-7); }
  .run-head, .run-foot { padding-left: var(--sp-5); padding-right: var(--sp-5); }
  .tiles { grid-template-columns: repeat(2, 1fr); }
  .sh-grid, .ro-grid { grid-template-columns: repeat(2, 1fr); }
  .group-grid { grid-template-columns: 1fr; }
  h1 { font-size: 27px; }
}
@media (max-width: 460px) {
  .tiles, .sh-grid, .ro-grid { grid-template-columns: 1fr; }
  .title-block { flex-direction: column; }
  .rooms-count { align-items: flex-start; text-align: left; }
}

/* ============================================================
   PRINT — US Letter, zero page margin (kills browser URL/date
   chrome); the ~0.55in inset is our own sheet padding. Running
   header/footer are position:fixed and repeat per page; the
   page-frame thead/tfoot spacers repeat too and reserve their
   space in the flow.
   ============================================================ */
@page { size: letter; margin: 0; }

@media print {
  .no-print { display: none !important; }

  /* The page canvas outside our sheet must print white too. */
  :global(html), :global(body), :global(#app), :global(.content) {
    background: var(--surface-card) !important;
  }

  .share-page {
    padding: 0; background: var(--surface-card);
    font-size: 12.5px;
    orphans: 3; widows: 3;
  }
  .share-page * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: none; border: 0; border-radius: 0; box-shadow: none; overflow: visible; }

  /* Running header/footer repeat on every page. */
  .run-head {
    position: fixed; top: 0; left: 0; right: 0; z-index: 10;
    padding: 0.34in 0.55in 10px;
  }
  .run-foot {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 10;
    padding: 8px 0.55in 0.3in;
  }
  /* Spacers (repeated by thead/tfoot) reserve the fixed zones. */
  .page-frame > thead { display: table-header-group; }
  .page-frame > tfoot { display: table-footer-group; }
  .head-space { height: 0.95in; }
  .foot-space { height: 0.62in; }
  .frame-body { padding: 0.18in 0.55in 0; }

  /* Fragmentation control */
  .tile, .sh-card, .ro-card, .group-card, .route-card, .honest, .measured, .closing { break-inside: avoid; page-break-inside: avoid; }
  h1, h2, h3, .room-head, .title-block { break-after: avoid; page-break-after: avoid; }
  .doc-section { break-inside: auto; }
  table.items { break-inside: auto; page-break-inside: auto; }
  table.items thead { display: table-header-group; }
  table.items tr { break-inside: avoid; page-break-inside: avoid; }

  /* Modest print scale */
  h1 { font-size: 30px; }
  h2 { font-size: 17px; }
  .tile-num { font-size: 23px; }
  .tile-lbl { font-size: 9px; white-space: nowrap; }
  .sh-weight { font-size: 20px; }
  .closing { margin-top: var(--sp-7); }
  .vid, .walkthroughs { display: none; }
}
</style>
