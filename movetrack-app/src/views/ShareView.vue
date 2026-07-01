<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'

const route = useRoute()
const core_url =
  import.meta.env.MODE === 'development'
    ? 'http://localhost:3050'
    : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'

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
          <div class="brand">Nexus Moves</div>
          <h1>{{ report.title || 'Moving Inventory' }}</h1>
          <p class="muted">Generated {{ generatedLabel }}</p>
        </div>
        <button class="print-btn no-print" @click="printPage">Save / Print PDF</button>
      </header>

      <section v-if="tripFrom" class="trip">
        <div class="trip-end">
          <span class="trip-lbl">From</span>
          <span class="trip-place">{{ tripFrom }}</span>
        </div>
        <template v-if="tripTo">
          <span class="trip-arrow">→</span>
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
        <p v-if="confidenceCaution" class="conf-caution">⚠︎ {{ confidenceCaution }}</p>
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
            <p v-if="w.notes" class="vid-notes">🎙 {{ w.notes }}</p>
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
                <td>{{ it.quantity }}</td>
                <td>{{ it.weightLbs ? it.weightLbs + ' lb' : '—' }}</td>
                <td>{{ dims(it.dimensionsIn) }}</td>
                <td>{{ it.volumeCuFt ?? '—' }}</td>
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
/* One tight, consistent type scale: h1 20px · section h2 15px · body 13.5px · muted 12px */
.share-wrap { max-width: 860px; margin: 0 auto; padding: 24px 20px 48px; color: #1f2033; font-family: system-ui, -apple-system, sans-serif; font-size: 13.5px; line-height: 1.5; }
.state { text-align: center; padding: 80px 20px; color: #555; }
.state.error h2 { color: #b00020; }

.report-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 1px solid #ececf2; padding-bottom: 14px; }
.brand { font-weight: 700; letter-spacing: .4px; color: #5b5bd6; text-transform: uppercase; font-size: 11px; }
.report-head h1 { margin: 3px 0 2px; font-size: 20px; font-weight: 700; letter-spacing: -.2px; }
.muted { color: #83839a; font-size: 12px; }
.disclaimer { margin-top: 8px; }
.print-btn { background: #5b5bd6; color: #fff; border: 0; border-radius: 9px; padding: 9px 15px; font-weight: 600; font-size: 13px; cursor: pointer; white-space: nowrap; }

/* From → To banner */
.trip { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; margin: 16px 0 4px; padding: 12px 14px; background: #f6f6fb; border: 1px solid #ececf2; border-radius: 12px; }
.trip-end { display: flex; flex-direction: column; }
.trip-lbl { font-size: 10px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: #9a9ab0; }
.trip-place { font-size: 14px; font-weight: 600; }
.trip-arrow { color: #5b5bd6; font-size: 18px; font-weight: 700; }
.trip-date { margin-left: auto; font-size: 12px; color: #83839a; }

.totals { display: flex; gap: 20px; margin: 18px 0; flex-wrap: wrap; }
.stat { display: flex; flex-direction: column; }
.stat .num { font-size: 24px; font-weight: 700; line-height: 1.1; }
.stat .lbl { font-size: 11px; color: #83839a; text-transform: uppercase; letter-spacing: .3px; }

.confidence { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; margin: 8px 0 4px; }
.conf-chip { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .3px; text-transform: uppercase; color: #3730a3; background: #e0e7ff; border-radius: 999px; padding: 3px 10px; }
.conf-meta { font-size: 12px; color: #666; }
.conf-caution { flex-basis: 100%; margin: 4px 0 0; font-size: 12.5px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px; }

section { margin-top: 22px; }
section h2 { font-size: 15px; font-weight: 700; margin: 0 0 10px; }

.vid-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; align-items: start; }
.vid { margin: 0; }
/* Respect the video's real orientation — portrait clips stay portrait. */
.vid video { width: 100%; height: auto; max-height: 70vh; border-radius: 10px; background: #000; display: block; }
.vid figcaption { font-size: 12px; color: #666; margin-top: 5px; text-transform: capitalize; }
.vid-notes { font-size: 12px; color: #45455e; margin: 4px 0 0; background: #f6f6fb; border: 1px solid #ececf2; border-radius: 8px; padding: 6px 8px; }

.special { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 12px 16px; }
.special ul { margin: 0; padding-left: 18px; }
.special li { margin: 2px 0; }

.location h2 { border-bottom: 1px solid #ececf2; padding-bottom: 6px; }
.addr { font-weight: 400; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 4px; }
.chip { font-size: 11.5px; color: #45455e; background: #f0f0f6; border: 1px solid #e6e6ee; border-radius: 999px; padding: 3px 10px; }

/* Collapsible rooms */
.room { margin-top: 10px; border: 1px solid #ececf2; border-radius: 10px; overflow: hidden; }
.room > summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; list-style: none; padding: 9px 12px; background: #fafafd; font-weight: 600; font-size: 13.5px; }
.room > summary::-webkit-details-marker { display: none; }
.room > summary::after { content: '⌄'; color: #9a9ab0; font-size: 16px; line-height: 1; transition: transform .15s; }
.room[open] > summary::after { transform: rotate(180deg); }
.room-count { margin-left: auto; font-size: 11.5px; font-weight: 500; color: #83839a; }
.room-name { font-weight: 600; }

table.items { width: 100%; border-collapse: collapse; font-size: 13px; }
table.items th { text-align: left; background: #fff; padding: 7px 12px; border-bottom: 1px solid #ececf2; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; color: #83839a; }
table.items td { padding: 7px 12px; border-bottom: 1px solid #f4f4f8; }
table.items tr:last-child td { border-bottom: 0; }
.tag { display: inline-block; font-size: 10.5px; padding: 1px 7px; border-radius: 5px; margin-left: 4px; }
.tag.fragile { background: #fde2e1; color: #b00020; }
.tag.oversized { background: #e0e7ff; color: #3730a3; }

.report-foot { margin-top: 32px; border-top: 1px solid #ececf2; padding-top: 12px; text-align: center; }

@media print {
  .no-print { display: none !important; }
  .share-wrap { padding: 0; max-width: none; }
  .location, .room { page-break-inside: avoid; }
  .room > summary::after { display: none; }
}
</style>
