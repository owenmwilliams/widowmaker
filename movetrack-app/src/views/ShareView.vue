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
type Report = {
  title: string | null; generatedAt: string
  totals: { itemCount: number; totalWeightLbs: number; totalVolumeCuFt: number; fragileCount: number; missingWeight: number; missingDimensions: number }
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
          <div class="brand">ReloPrep</div>
          <h1>{{ report.title || 'Moving Inventory' }}</h1>
          <p class="muted">Generated {{ generatedLabel }}</p>
          <p v-if="report.move" class="muted">
            <template v-if="placeLabel(report.move.origin)">From {{ placeLabel(report.move.origin) }}</template>
            <template v-if="placeLabel(report.move.destination)"> → {{ placeLabel(report.move.destination) }}</template>
            <template v-if="report.move.moveDate"> · {{ new Date(report.move.moveDate).toLocaleDateString() }}</template>
          </p>
        </div>
        <button class="print-btn no-print" @click="printPage">Save / Print PDF</button>
      </header>

      <section class="totals">
        <div class="stat"><span class="num">{{ report.totals.itemCount }}</span><span class="lbl">Items</span></div>
        <div class="stat"><span class="num">{{ report.totals.totalWeightLbs.toLocaleString() }}</span><span class="lbl">lbs (est.)</span></div>
        <div class="stat"><span class="num">{{ report.totals.totalVolumeCuFt.toLocaleString() }}</span><span class="lbl">cu ft (est.)</span></div>
        <div class="stat"><span class="num">{{ report.totals.fragileCount }}</span><span class="lbl">Fragile</span></div>
      </section>

      <p v-if="report.totals.missingWeight || report.totals.missingDimensions" class="muted disclaimer">
        Weights and dimensions are AI estimates intended for quoting; {{ report.totals.missingWeight }} item(s)
        are missing a weight and {{ report.totals.missingDimensions }} are missing dimensions. Confirm on site.
      </p>

      <section v-if="report.specialItems.length" class="special">
        <h3>Special handling</h3>
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
        <p v-if="loc.access && (loc.access.hasStairs || loc.access.hasElevator || loc.access.parking || loc.access.entryType)" class="muted access">
          <span v-if="loc.access.hasStairs">Stairs{{ loc.access.numberOfFlights ? ` (${loc.access.numberOfFlights} flights)` : '' }} · </span>
          <span v-if="loc.access.hasElevator">Elevator · </span>
          <span v-if="loc.access.parking">Parking: {{ loc.access.parking }} · </span>
          <span v-if="loc.access.entryType">Entry: {{ loc.access.entryType }}</span>
        </p>

        <div v-for="room in loc.rooms" :key="room.name" class="room">
          <h3>{{ room.name }} <span class="muted">({{ room.items.length }})</span></h3>
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
        </div>
      </section>

      <footer class="report-foot muted">
        Shared via ReloPrep · This is a read-only inventory for moving quotes.
      </footer>
    </div>
  </div>
</template>

<style scoped>
.share-wrap { max-width: 900px; margin: 0 auto; padding: 24px; color: #1a1a2e; font-family: system-ui, -apple-system, sans-serif; }
.state { text-align: center; padding: 80px 20px; color: #555; }
.state.error h2 { color: #b00020; }
.report-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #eee; padding-bottom: 16px; }
.brand { font-weight: 700; letter-spacing: .5px; color: #5b5bd6; text-transform: uppercase; font-size: 12px; }
.report-head h1 { margin: 4px 0; font-size: 26px; }
.muted { color: #777; font-size: 13px; }
.disclaimer { margin-top: 8px; }
.print-btn { background: #5b5bd6; color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.totals { display: flex; gap: 24px; margin: 20px 0; flex-wrap: wrap; }
.stat { display: flex; flex-direction: column; }
.stat .num { font-size: 28px; font-weight: 700; }
.stat .lbl { font-size: 12px; color: #777; text-transform: uppercase; }
.special { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
.special h3 { margin: 0 0 8px; }
.special ul { margin: 0; padding-left: 18px; }
.location { margin-top: 28px; }
.location h2 { font-size: 20px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
.addr { font-weight: 400; font-size: 14px; }
.access { margin: 6px 0 0; }
.room { margin-top: 14px; }
.room h3 { margin: 0 0 6px; font-size: 15px; }
table.items { width: 100%; border-collapse: collapse; font-size: 13px; }
table.items th { text-align: left; background: #f5f5fa; padding: 6px 8px; border-bottom: 1px solid #e5e5ef; }
table.items td { padding: 6px 8px; border-bottom: 1px solid #f0f0f5; }
.tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 4px; margin-left: 4px; }
.tag.fragile { background: #fde2e1; color: #b00020; }
.tag.oversized { background: #e0e7ff; color: #3730a3; }
.report-foot { margin-top: 32px; border-top: 1px solid #eee; padding-top: 12px; text-align: center; }
@media print {
  .no-print { display: none !important; }
  .share-wrap { padding: 0; max-width: none; }
  .location { page-break-inside: avoid; }
}
</style>
