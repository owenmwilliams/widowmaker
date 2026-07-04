<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { API_BASE_URL } from "../config/api";
import { useRoute } from 'vue-router'
import axios from 'axios'
import { ArrowRight, Mic, TriangleAlert } from 'lucide-vue-next'

const route = useRoute()
const core_url = API_BASE_URL;

type ReportItem = {
  name: string; quantity: number; weightLbs: number | null
  dimensionsIn: { length: number; width: number; height: number } | null
  volumeCuFt: number | null; fragile: boolean; oversized: boolean; material: string | null
}
type Room = { name: string; items: ReportItem[] }
type Loc = {
  name: string; type: string | null; address: string | null
  access: { hasStairs?: boolean | null; numberOfFlights?: number | null; hasElevator?: boolean | null; parking?: string | null; entryType?: string | null; notes?: string | null }
  rooms: Room[]
}
type Confidence = {
  itemCount: number; measuredWeightPct: number; totalWeightLbs: number
  bedrooms: number | null
  reasonableness: { hasBenchmark: boolean; status: string; severity: string; message: string }
}
type Report = {
  title: string | null; generatedAt: string
  totals: { itemCount: number; totalWeightLbs: number; totalVolumeCuFt: number; fragileCount: number; missingWeight: number; missingDimensions: number }
  confidence?: Confidence
  walkthroughs?: { room: string; url: string; thumbnailUrl: string | null; notes: string | null }[]
  specialItems: { name: string; quantity: number; fragile: boolean; oversized: boolean }[]
  locations: Loc[]
  move: { name?: string; moveDate?: string; origin?: any; destination?: any } | null
}

const loading = ref(true)
const error = ref<string | null>(null)
const report = ref<Report | null>(null)

const dims = (d: ReportItem['dimensionsIn']) => (d ? `${d.length}×${d.width}×${d.height} in` : '—')
const placeLabel = (p: any) => (p ? [p.name, p.city, p.state].filter(Boolean).join(', ') : null)
const generatedLabel = computed(() =>
  report.value ? new Date(report.value.generatedAt).toLocaleString() : ''
)

// Trip banner: prefer the move's origin/destination; fall back to the first
// inventory location as the "from" so a mover always sees where it's moving from.
const tripFrom = computed(() => {
  const m = report.value?.move
  if (m?.origin) return placeLabel(m.origin)
  const loc = report.value?.locations?.[0]
  return loc ? (loc.address || loc.name) : null
})
const tripTo = computed(() => {
  const m = report.value?.move
  return m?.destination ? placeLabel(m.destination) : null
})

// Access details rendered as compact chips instead of a run-on sentence.
const accessChips = (loc: Loc): string[] => {
  const a = loc.access || {}
  const chips: string[] = []
  if (a.hasStairs) chips.push(a.numberOfFlights ? `Stairs · ${a.numberOfFlights} flight${a.numberOfFlights === 1 ? '' : 's'}` : 'Stairs')
  if (a.hasElevator) chips.push('Elevator')
  if (a.parking) chips.push(`Parking: ${a.parking}`)
  if (a.entryType) chips.push(`Entry: ${a.entryType}`)
  if (a.notes) chips.push(a.notes)
  return chips
}
const confidenceCaution = computed(() => {
  const r = report.value?.confidence?.reasonableness
  if (!r || !r.hasBenchmark) return null
  if (r.status === 'too_low' || r.status === 'low')
    return 'This inventory may be incomplete for the home size — totals could be on the low side. Confirm scope on site.'
  if (r.status === 'too_high' || r.status === 'high')
    return 'Some items may be over-estimated for the home size. Confirm on site.'
  return null
})

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
</script>

<template>
  <div class="share-wrap">
    <div v-if="loading" class="state">Loading inventory…</div>

    <div v-else-if="error" class="state error">
      <h2>Inventory unavailable</h2>
      <p>{{ error }}</p>
    </div>

    <div v-else-if="report" class="report">
      <header class="report-head">
        <div>
          <img src="../assets/brand/logo-lockup-light.svg" alt="Nexus Moves" class="brand-logo" height="24" />
          <h1>{{ report.title || 'Moving inventory' }}</h1>
          <p class="muted">Generated {{ generatedLabel }}</p>
        </div>
        <button class="print-btn no-print" @click="printPage">Save or print PDF</button>
      </header>

      <section v-if="tripFrom" class="trip">
        <div class="trip-end">
          <span class="trip-lbl">From</span>
          <span class="trip-place">{{ tripFrom }}</span>
        </div>
        <template v-if="tripTo">
          <ArrowRight :size="18" class="trip-arrow" aria-hidden="true" />
          <div class="trip-end">
            <span class="trip-lbl">To</span>
            <span class="trip-place">{{ tripTo }}</span>
          </div>
        </template>
        <span v-if="report.move?.moveDate" class="trip-date">{{ new Date(report.move.moveDate).toLocaleDateString() }}</span>
      </section>

      <section class="totals">
        <div class="stat"><span class="num">{{ report.totals.itemCount }}</span><span class="lbl">Items</span></div>
        <div class="stat"><span class="num">{{ report.totals.totalWeightLbs.toLocaleString() }}</span><span class="lbl">lbs (est.)</span></div>
        <div class="stat"><span class="num">{{ report.totals.totalVolumeCuFt.toLocaleString() }}</span><span class="lbl">cu ft (est.)</span></div>
        <div class="stat"><span class="num">{{ report.totals.fragileCount }}</span><span class="lbl">Fragile</span></div>
      </section>

      <section v-if="report.confidence" class="confidence">
        <span class="conf-chip">AI-assisted self-report</span>
        <span class="conf-meta">
          {{ report.confidence.itemCount }} items · {{ report.confidence.measuredWeightPct }}% with measured weights
        </span>
        <p v-if="confidenceCaution" class="conf-caution"><TriangleAlert :size="14" class="caution-icon" aria-hidden="true" /> {{ confidenceCaution }}</p>
      </section>

      <p v-if="report.totals.missingWeight || report.totals.missingDimensions" class="muted disclaimer">
        Weights and dimensions are AI estimates intended for quoting; {{ report.totals.missingWeight }} item(s)
        are missing a weight and {{ report.totals.missingDimensions }} are missing dimensions. Confirm on site.
      </p>

      <section v-if="report.walkthroughs && report.walkthroughs.length" class="walkthroughs">
        <h2>Room walkthrough videos</h2>
        <div class="vid-grid">
          <figure v-for="(w, i) in report.walkthroughs" :key="i" class="vid">
            <video :src="w.url" :poster="w.thumbnailUrl || undefined" controls preload="none" playsinline></video>
            <figcaption>{{ w.room }}</figcaption>
            <p v-if="w.notes" class="vid-notes"><Mic :size="12" class="note-icon" aria-hidden="true" /> {{ w.notes }}</p>
          </figure>
        </div>
      </section>

      <section v-if="report.specialItems.length" class="special">
        <h2>Special handling</h2>
        <ul>
          <li v-for="(s, i) in report.specialItems" :key="i">
            {{ s.name }}<span v-if="s.quantity > 1"> ×{{ s.quantity }}</span>
            <span v-if="s.fragile" class="tag fragile">Fragile</span>
            <span v-if="s.oversized" class="tag oversized">Oversized</span>
          </li>
        </ul>
      </section>

      <section v-for="loc in report.locations" :key="loc.name" class="location">
        <h2>{{ loc.name }}<span v-if="loc.address" class="muted addr"> — {{ loc.address }}</span></h2>
        <div v-if="accessChips(loc).length" class="chips">
          <span v-for="(c, i) in accessChips(loc)" :key="i" class="chip">{{ c }}</span>
        </div>

        <details v-for="room in loc.rooms" :key="room.name" class="room" open>
          <summary>
            <span class="room-name">{{ room.name }}</span>
            <span class="room-count">{{ room.items.length }} item{{ room.items.length === 1 ? '' : 's' }}</span>
          </summary>
          <table class="items">
            <thead>
              <tr><th>Item</th><th>Qty</th><th>Weight</th><th>Dimensions</th><th>Vol (cu ft)</th><th>Flags</th></tr>
            </thead>
            <tbody>
              <tr v-for="(it, i) in room.items" :key="i">
                <td>{{ it.name }}</td>
                <td class="mono">{{ it.quantity }}</td>
                <td class="mono">{{ it.weightLbs ? it.weightLbs + ' lb' : '—' }}</td>
                <td class="mono">{{ dims(it.dimensionsIn) }}</td>
                <td class="mono">{{ it.volumeCuFt ?? '—' }}</td>
                <td>
                  <span v-if="it.fragile" class="tag fragile">Fragile</span>
                  <span v-if="it.oversized" class="tag oversized">Oversized</span>
                </td>
              </tr>
            </tbody>
          </table>
        </details>
      </section>

      <footer class="report-foot muted">
        Shared via Nexus Moves · This is a read-only inventory for moving quotes.
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* Mover-facing report: calm, honest, zero gimmicks.
   White card, hairline borders, mono data readouts. */
.share-wrap { max-width: 860px; margin: 0 auto; padding: 24px 20px 48px; color: var(--text-primary); font-family: var(--font-ui); font-size: 13.5px; line-height: var(--lh-body); }
.state { text-align: center; padding: 80px 20px; color: var(--text-secondary); }
.state.error h2 { color: var(--danger); }

.report { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-sm); padding: var(--sp-8); }

.report-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-5); border-bottom: 1px solid var(--border); padding-bottom: var(--sp-5); }
.brand-logo { display: block; height: 24px; width: auto; margin-bottom: var(--sp-3); }
.report-head h1 { margin: var(--sp-1) 0; font-size: var(--fs-title-s); font-weight: var(--fw-bold); letter-spacing: var(--ls-title); color: var(--text-primary); }
.muted { color: var(--text-tertiary); font-size: var(--fs-label); }
.disclaimer { margin-top: var(--sp-3); }
.print-btn { background: var(--accent); color: var(--on-accent); border: 0; border-radius: var(--r-sm); padding: 9px 15px; font-weight: var(--fw-semibold); font-size: var(--fs-label); cursor: pointer; white-space: nowrap; transition: background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard); }
.print-btn:hover { background: var(--accent-hover); }
.print-btn:active { transform: scale(0.97); }
.print-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* From → To banner */
.trip { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-3) var(--sp-5); margin: var(--sp-5) 0 var(--sp-2); padding: var(--sp-4) var(--sp-5); background: var(--bg); border: 1px solid var(--border); border-radius: var(--r-md); }
.trip-end { display: flex; flex-direction: column; }
.trip-lbl { font-family: var(--font-mono); font-size: 10px; font-weight: var(--fw-bold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-tertiary); }
.trip-place { font-size: 14px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.trip-arrow { color: var(--accent); flex: none; }
.trip-date { margin-left: auto; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-tertiary); }

.totals { display: flex; gap: var(--sp-6); margin: var(--sp-6) 0; flex-wrap: wrap; }
.stat { display: flex; flex-direction: column; }
.stat .num { font-family: var(--font-mono); font-size: 24px; font-weight: var(--fw-bold); line-height: 1.1; color: var(--text-primary); }
.stat .lbl { font-size: var(--fs-micro); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: var(--ls-eyebrow); }

.confidence { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-3) var(--sp-4); margin: var(--sp-3) 0 var(--sp-2); }
.conf-chip { display: inline-block; font-family: var(--font-mono); font-size: 10px; font-weight: var(--fw-bold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--accent); background: var(--accent-quiet); border-radius: var(--r-pill); padding: 3px 10px; }
.conf-meta { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-secondary); }
.conf-caution { flex-basis: 100%; margin: var(--sp-2) 0 0; font-size: 12.5px; color: var(--warning-ink); background: var(--warning-surface); border: 1px solid var(--border); border-radius: var(--r-xs); padding: var(--sp-3) var(--sp-4); }
.caution-icon { vertical-align: -2px; margin-right: var(--sp-1); }

section { margin-top: var(--sp-7); }
section h2 { font-size: var(--fs-body); font-weight: var(--fw-bold); margin: 0 0 var(--sp-4); color: var(--text-primary); }

.vid-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--sp-5); align-items: start; }
.vid { margin: 0; }
/* Respect the video's real orientation — portrait clips stay portrait. */
.vid video { width: 100%; height: auto; max-height: 70vh; border-radius: var(--r-sm); background: var(--navy-900); display: block; }
.vid figcaption { font-size: var(--fs-label); color: var(--text-secondary); margin-top: var(--sp-2); text-transform: capitalize; }
.vid-notes { font-size: var(--fs-label); color: var(--text-secondary); margin: var(--sp-2) 0 0; background: var(--bg); border: 1px solid var(--border); border-radius: var(--r-xs); padding: var(--sp-3); }
.note-icon { vertical-align: -1px; margin-right: var(--sp-1); color: var(--text-tertiary); }

.special { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--r-sm); box-shadow: var(--shadow-xs); padding: var(--sp-4) var(--sp-5); }
.special ul { margin: 0; padding-left: 18px; }
.special li { margin: var(--sp-1) 0; }

.location h2 { border-bottom: 1px solid var(--border); padding-bottom: var(--sp-2); }
.addr { font-weight: var(--fw-regular); }
.chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin: var(--sp-3) 0 var(--sp-2); }
.chip { font-size: 11.5px; color: var(--text-secondary); background: var(--surface-hover); border: 1px solid var(--border); border-radius: var(--r-pill); padding: 3px 10px; }

/* Collapsible rooms */
.room { margin-top: var(--sp-4); border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; }
.room > summary { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); cursor: pointer; list-style: none; padding: 9px 12px; background: var(--surface-sunk); font-weight: var(--fw-semibold); font-size: 13.5px; color: var(--text-primary); }
.room > summary::-webkit-details-marker { display: none; }
.room > summary:focus-visible { outline: none; box-shadow: var(--focus-ring) inset; }
.room > summary::after { content: '⌄'; color: var(--text-tertiary); font-size: 16px; line-height: 1; transition: transform var(--dur-fast) var(--ease-standard); }
.room[open] > summary::after { transform: rotate(180deg); }
.room-count { margin-left: auto; font-family: var(--font-mono); font-size: 11.5px; font-weight: var(--fw-medium); color: var(--text-tertiary); }
.room-name { font-weight: var(--fw-semibold); }

table.items { width: 100%; border-collapse: collapse; font-size: var(--fs-label); }
table.items th { text-align: left; background: var(--surface-card); padding: 7px 12px; border-bottom: 1px solid var(--border); font-size: var(--fs-micro); text-transform: uppercase; letter-spacing: var(--ls-eyebrow); color: var(--text-tertiary); }
table.items td { padding: 7px 12px; border-bottom: 1px solid var(--border-soft); color: var(--text-primary); }
table.items td.mono { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-secondary); }
table.items tr:last-child td { border-bottom: 0; }
.tag { display: inline-block; font-size: 10.5px; padding: 1px 7px; border-radius: var(--r-xs); margin-left: var(--sp-2); }
.tag.fragile { background: var(--danger-quiet); color: var(--danger); }
.tag.oversized { background: var(--accent-quiet); color: var(--accent); }

.report-foot { margin-top: var(--sp-8); border-top: 1px solid var(--border); padding-top: var(--sp-4); text-align: center; }

@media print {
  .no-print { display: none !important; }
  .share-wrap { padding: 0; max-width: none; }
  .report { border: none; box-shadow: none; border-radius: 0; padding: 0; }
  .location, .room { page-break-inside: avoid; }
  .room > summary::after { display: none; }
}
</style>
