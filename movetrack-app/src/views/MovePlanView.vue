<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { Truck, Users, TriangleAlert, Moon } from 'lucide-vue-next'
import { API_BASE_URL } from '../config/api'

/* ============================================================
   Move Plan — the customer-facing planning document at
   /move-plan/:moveId (authenticated). Sibling of the ShareView
   mover inventory: same print-grade US Letter sheet, running
   header/footer, tokens-only styling. All data comes from
   EXISTING endpoints; everything below is assembled client-side
   into the handoff's MovePlan shape. Honest numbers: every cost
   is a range, nothing is ever presented as a quote.
   ============================================================ */

const route = useRoute()
const core_url = API_BASE_URL

// ── Payload types (API shapes — do not change) ───────────────
type MoveLocation = {
  location_id: number | string | null
  location_role: string | null
  location_name: string | null
  address: string | null; city: string | null; state: string | null; zip: string | null
  entry_type: string | null; number_of_flights: number | null
  has_elevator: boolean | null; elevator_reservation_required: boolean | null
  parking_situation: string | null; parking_distance: number | null
  entry_challenges: string[] | string | null; access_notes: string | null
}
type SavedMove = {
  id: number; name: string | null
  origin_location_id: number | string | null
  destination_location_id: number | string | null
  origin_location_name: string | null; destination_location_name: string | null
  move_date: string | null; desired_start_date: string | null; desired_end_date: string | null
  total_items: number | null; total_weight_lbs: number | string | null
  total_volume_cu_ft: number | string | null; estimated_distance_miles: number | null
  has_stairs: boolean | null; number_of_flights: number | null; has_elevator: boolean | null
  elevator_reservation_required: boolean | null
  parking_situation: string | null; entry_type: string | null; access_notes: string | null
  dest_has_stairs: boolean | null; dest_number_of_flights: number | null; dest_has_elevator: boolean | null
  dest_elevator_reservation_required: boolean | null
  dest_parking_situation: string | null; dest_entry_type: string | null; dest_access_notes: string | null
  move_locations?: MoveLocation[]
}
type Waypoint = {
  city: string; state: string | null; sequence_order: number
  distance_from_origin_miles: number | string | null
  segment_distance_miles: number | string | null
  overnight_recommended: boolean | null
}
type SnapshotItem = {
  name: string; quantity: number | null; fragile: boolean | null
  weight_lbs: number | string | null
  length_in: number | string | null; width_in: number | string | null; height_in: number | string | null
  collection_id: number | string | null
}
type SnapshotContainer = { sealed: boolean | null }
type Snapshot = { items: SnapshotItem[]; containers: SnapshotContainer[]; collections: unknown[] }
type Estimate = {
  truck: {
    recommendation: { size: string; capacityCuFt: number; maxWeightLbs: number }
    bufferPct: number
  }
  cost: {
    moveType: 'local' | 'long_distance'
    diy: { low: number; high: number; truckSize: string; includes: string[]; notes: string }
    professional: { low: number; high: number; movers: number; includesPacking: boolean; notes: string }
    caveat: string; dataWarning: string | null
  }
  labor: {
    loadingHours: number; unloadingHours: number; numMovers: number; recommendedMovers: number
  }
}

// ── Document types (the handoff's MovePlan shape, derived) ───
type Scenario = 'road-trip' | 'local' | 'destination-pending'
type Flag = 'oversized' | 'heavy' | 'fragile'
type Place = { city: string; line: string; access: string[] }
type Leg = { from: string; to: string; miles: string; overnight?: string; arrive?: boolean }
type CostLine = { label: string; detail: string; amt: string }
type CostPath = { name: string; tag: string; range: string; best: string; lines: CostLine[] }
type SpecialItem = { name: string; weightLbs: number | null; flag: Flag; note: string }

// ── Fetch state — each source degrades independently ─────────
const loading = ref(true)
const move = ref<SavedMove | null>(null)
const waypoints = ref<Waypoint[] | null>(null)
const snapshot = ref<Snapshot | null>(null)
const estimate = ref<Estimate | null>(null)
const moveError = ref(false)
const waypointsError = ref(false)
const inventoryError = ref(false)
const estimateError = ref(false)

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('session_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

onMounted(async () => {
  const headers = authHeaders()
  const moveId = route.params.moveId
  const [mv, wp, snap] = await Promise.allSettled([
    axios.get(`${core_url}/api/saved-moves/${moveId}`, { headers }),
    axios.get(`${core_url}/api/waypoints/${moveId}`, { headers }),
    axios.get(`${core_url}/snapshot/`, { headers }),
  ])
  if (mv.status === 'fulfilled') move.value = mv.value.data
  else moveError.value = true
  if (wp.status === 'fulfilled') waypoints.value = Array.isArray(wp.value.data) ? wp.value.data : []
  else waypointsError.value = true
  if (snap.status === 'fulfilled') snapshot.value = snap.value.data
  else inventoryError.value = true

  // Estimate engine (#89): needs totals + distance. Totals prefer the saved
  // move's cached rollup, falling back to snapshot-derived sums; distance 0
  // is valid input when the destination is pending (truck + labor still
  // compute — the cost section shows its designed pending state instead).
  const t = resolveTotals()
  if (t) {
    try {
      const { data } = await axios.post(
        `${core_url}/api/move/estimate`,
        {
          distanceMiles: distanceMiles.value ?? 0,
          totalWeightLbs: t.weightLbs,
          totalVolumeCuFt: t.volumeCuFt,
          itemCount: t.items,
        },
        { headers: { ...headers, 'Content-Type': 'application/json' } }
      )
      estimate.value = data
    } catch {
      estimateError.value = true
    }
  } else {
    estimateError.value = true
  }
  loading.value = false
})

const printPage = () => window.print()

// ── Options (query params; ?scenario= is a testing override) ─
const q = route.query
const scenarioOverride: Scenario | null =
  q.scenario === 'road-trip' || q.scenario === 'local' || q.scenario === 'destination-pending'
    ? q.scenario
    : null
const costPath = ref<'both' | 'diy' | 'pro'>(q.cost === 'diy' || q.cost === 'pro' ? q.cost : 'both')
const showBreakdown = ref<boolean>(q.breakdown !== '0')

// ── Constants ────────────────────────────────────────────────
const HEAVY_LBS = 65 // same flags approach as ShareView
const OVERSIZED_LBS = 150 // parity with the share report's oversized rule
const OVERSIZED_DIM_IN = 72
const SPECIAL_CAP = 6
const LOCAL_MILES = 60 // < ~60 mi → local scenario
const SAFE_DAY_MILES = 450

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ============================================================
// View-model — pure derivations from the payloads above.
// ============================================================

// Snapshot-derived inventory sums (fallback when the saved move
// has no cached rollup).
const snapshotTotals = computed(() => {
  const s = snapshot.value
  if (!s || !Array.isArray(s.items)) return null
  let items = 0, weight = 0, volume = 0, missingWeight = 0
  const rooms = new Set<string>()
  for (const it of s.items) {
    const qty = num(it.quantity) || 1
    items += qty
    const w = num(it.weight_lbs)
    if (w != null) weight += w * qty
    else missingWeight += qty
    const l = num(it.length_in), wd = num(it.width_in), h = num(it.height_in)
    if (l && wd && h) volume += ((l * wd * h) / 1728) * qty
    if (it.collection_id != null) rooms.add(String(it.collection_id))
  }
  return { items, weightLbs: Math.round(weight), volumeCuFt: Math.round(volume * 10) / 10, missingWeight, roomCount: rooms.size }
})

function resolveTotals(): { items: number; weightLbs: number; volumeCuFt: number } | null {
  const m = move.value
  const s = snapshotTotals.value
  const items = num(m?.total_items) ?? s?.items ?? null
  const weightLbs = num(m?.total_weight_lbs) ?? s?.weightLbs ?? null
  const volumeCuFt = num(m?.total_volume_cu_ft) ?? s?.volumeCuFt ?? null
  if (items == null && weightLbs == null && volumeCuFt == null) return null
  return { items: items ?? 0, weightLbs: weightLbs ?? 0, volumeCuFt: volumeCuFt ?? 0 }
}

const totals = computed(resolveTotals)

const distanceMiles = computed<number | null>(() => num(move.value?.estimated_distance_miles))

// ── Places (origin / destination + access chips) ─────────────
const moveLoc = (role: 'origin' | 'destination'): MoveLocation | null => {
  const m = move.value
  if (!m?.move_locations?.length) return null
  const wantedId = role === 'origin' ? m.origin_location_id : m.destination_location_id
  return (
    m.move_locations.find((l) => l.location_role === role) ||
    (wantedId != null ? m.move_locations.find((l) => String(l.location_id) === String(wantedId)) : null) ||
    null
  )
}

type AccessSource = {
  hasStairs?: boolean | null; flights?: number | null; hasElevator?: boolean | null
  elevatorReservation?: boolean | null; parking?: string | null
  entryType?: string | null; challenges?: string[] | string | null; notes?: string | null
}
const accessChips = (a: AccessSource): string[] => {
  const chips: string[] = []
  if (a.hasStairs || (a.flights ?? 0) > 0) {
    chips.push(a.flights ? `Stairs · ${a.flights} flight${a.flights === 1 ? '' : 's'}` : 'Stairs')
    if (!a.hasElevator) chips.push('No elevator')
  }
  if (a.hasElevator) chips.push(a.elevatorReservation ? 'Elevator · reserve ahead' : 'Elevator on site')
  if (a.parking) chips.push(`Parking: ${a.parking}`)
  if (a.entryType) chips.push(`Entry: ${a.entryType}`)
  let ch = a.challenges
  if (typeof ch === 'string') { try { ch = JSON.parse(ch) } catch { ch = null } }
  if (Array.isArray(ch)) for (const c of ch.slice(0, 2)) chips.push(String(c))
  if (a.notes) chips.push(a.notes)
  return chips.slice(0, 4)
}

const buildPlace = (role: 'origin' | 'destination'): Place | null => {
  const m = move.value
  if (!m) return null
  const ml = moveLoc(role)
  const name = role === 'origin' ? m.origin_location_name : m.destination_location_name
  if (role === 'destination' && !m.destination_location_id && !ml) return null
  const city = ml ? [ml.city, ml.state].filter(Boolean).join(', ') : ''
  const lineParts = [ml?.address, ml?.zip, name && name !== city ? `“${name}”` : null].filter(Boolean)
  const access = ml
    ? accessChips({
        hasStairs: (ml.number_of_flights ?? 0) > 0, flights: ml.number_of_flights,
        hasElevator: ml.has_elevator, elevatorReservation: ml.elevator_reservation_required,
        parking: ml.parking_situation, entryType: ml.entry_type,
        challenges: ml.entry_challenges, notes: ml.access_notes,
      })
    : accessChips(
        role === 'origin'
          ? { hasStairs: m.has_stairs, flights: m.number_of_flights, hasElevator: m.has_elevator,
              elevatorReservation: m.elevator_reservation_required, parking: m.parking_situation,
              entryType: m.entry_type, notes: m.access_notes }
          : { hasStairs: m.dest_has_stairs, flights: m.dest_number_of_flights, hasElevator: m.dest_has_elevator,
              elevatorReservation: m.dest_elevator_reservation_required, parking: m.dest_parking_situation,
              entryType: m.dest_entry_type, notes: m.dest_access_notes }
      )
  return { city: city || name || (role === 'origin' ? 'Origin' : 'Destination'), line: lineParts.join(' · '), access }
}

const origin = computed<Place | null>(() => buildPlace('origin'))
const destinationReal = computed<Place | null>(() => buildPlace('destination'))

// ── Scenario — DERIVED (query override for testing only) ─────
const scenario = computed<Scenario>(() => {
  if (scenarioOverride) return scenarioOverride
  if (!destinationReal.value) return 'destination-pending'
  const d = distanceMiles.value
  if (d != null && d < LOCAL_MILES) return 'local'
  return 'road-trip'
})
const destination = computed<Place | null>(() =>
  scenario.value === 'destination-pending' ? null : destinationReal.value
)
const hasDistance = computed(() => scenario.value !== 'destination-pending' && distanceMiles.value != null)

// ── Title block ──────────────────────────────────────────────
const heading = computed(() => {
  try {
    const raw = localStorage.getItem('user_data')
    const u = raw ? JSON.parse(raw) : null
    const first = u?.first_name || u?.name?.split(' ')[0]
    if (first) return `${first}’s move`
  } catch { /* fall through */ }
  const n = move.value?.name
  if (n) return /\bmove\b/i.test(n) ? n : `${n} — move plan`
  return 'Your move'
})
const generatedLabel = computed(() =>
  new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
)
const genLine = computed(() =>
  scenario.value === 'destination-pending'
    ? `Generated ${generatedLabel.value} · A planning copy — a few sections open up once your destination is set`
    : `Generated ${generatedLabel.value} · A planning copy — every figure here is an estimate`
)

const shortDate = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const windowLabel = computed(() => {
  const m = move.value
  if (!m) return 'TBD'
  const start = m.desired_start_date || m.move_date
  const end = m.desired_end_date
  if (!start) return 'TBD'
  if (!end || end === start) return shortDate(start)
  const s = new Date(start.length === 10 ? `${start}T00:00:00` : start)
  const e = new Date(end.length === 10 ? `${end}T00:00:00` : end)
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${s.toLocaleDateString('en-US', { month: 'short' })} ${s.getDate()}–${e.getDate()}, ${e.getFullYear()}`
  }
  if (s.getFullYear() === e.getFullYear()) {
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${shortDate(end)}`
  }
  return `${shortDate(start)} – ${shortDate(end)}`
})

// ── Trip / route ─────────────────────────────────────────────
const overnightCount = computed(() => (waypoints.value || []).filter((w) => w.overnight_recommended).length)
const driveDays = computed(() => {
  const d = distanceMiles.value
  if (overnightCount.value > 0) return overnightCount.value + 1
  if (d != null) return Math.max(1, Math.ceil(d / SAFE_DAY_MILES))
  return 1
})
const distanceSub = computed(() =>
  scenario.value === 'local' ? 'DRIVING · SAME DAY' : `DRIVING · ${driveDays.value} DAY${driveDays.value === 1 ? '' : 'S'}`
)

const legs = computed<Leg[]>(() => {
  if (scenario.value !== 'road-trip') return []
  const o = origin.value, dst = destination.value
  if (!o || !dst) return []
  const wps = [...(waypoints.value || [])].sort((a, b) => a.sequence_order - b.sequence_order)
  const stops = [o.city, ...wps.map((w) => [w.city, w.state].filter(Boolean).join(', ')), dst.city]
  const out: Leg[] = []
  let night = 0
  for (let i = 1; i < stops.length; i++) {
    const wp = i - 1 < wps.length ? wps[i - 1] : null
    let miles: number | null = null
    if (wp) {
      miles = num(wp.segment_distance_miles)
      if (miles == null) {
        const here = num(wp.distance_from_origin_miles)
        const prev = i >= 2 ? num(wps[i - 2]?.distance_from_origin_miles) : 0
        if (here != null && prev != null) miles = here - prev
      }
    } else {
      const total = distanceMiles.value
      const last = wps.length ? num(wps[wps.length - 1]?.distance_from_origin_miles) : 0
      if (total != null && last != null) miles = total - last
    }
    const leg: Leg = {
      from: stops[i - 1],
      to: stops[i],
      miles: miles != null && miles > 0 ? `${fmt(miles)} mi` : '— mi',
    }
    if (wp?.overnight_recommended) leg.overnight = `Night ${++night}`
    if (i === stops.length - 1) leg.arrive = true
    out.push(leg)
  }
  return out
})

// ── Special handling (flags approach from ShareView) ─────────
type RawSpecial = SpecialItem & { maxDim: number }
const specialAll = computed<RawSpecial[]>(() => {
  const s = snapshot.value
  if (!s?.items) return []
  const rank: Record<Flag, number> = { oversized: 0, heavy: 1, fragile: 2 }
  const out: RawSpecial[] = []
  for (const it of s.items) {
    const w = num(it.weight_lbs)
    const maxDim = Math.max(num(it.length_in) ?? 0, num(it.width_in) ?? 0, num(it.height_in) ?? 0)
    const oversized = (w ?? 0) >= OVERSIZED_LBS || maxDim >= OVERSIZED_DIM_IN
    const heavy = (w ?? 0) >= HEAVY_LBS
    const flag: Flag | null = oversized ? 'oversized' : heavy ? 'heavy' : it.fragile ? 'fragile' : null
    if (!flag) continue
    out.push({ name: it.name, weightLbs: w, flag, maxDim, note: handlingNote(flag, w, maxDim, !!it.fragile) })
  }
  // Sort oversized → heavy → fragile, weight desc. Cap 6 (below).
  out.sort((a, b) => (rank[a.flag] !== rank[b.flag] ? rank[a.flag] - rank[b.flag] : (b.weightLbs ?? 0) - (a.weightLbs ?? 0)))
  return out
})
const special = computed(() => specialAll.value.slice(0, SPECIAL_CAP))
const specialOverflow = computed(() => Math.max(0, specialAll.value.length - SPECIAL_CAP))

function handlingNote(flag: Flag, w: number | null, maxDim: number, fragile: boolean): string {
  const parts: string[] = []
  if ((w ?? 0) >= OVERSIZED_LBS) parts.push('2 people + a dolly and straps')
  else if ((w ?? 0) >= HEAVY_LBS) parts.push('2 people to lift — no solo carries')
  if (maxDim >= OVERSIZED_DIM_IN) parts.push(`${Math.round(maxDim)} in on the longest side — check doorways and stair turns first`)
  if (fragile) parts.push(flag === 'fragile' ? 'blanket-wrap and corner-protect; never stack anything on top' : 'fragile — pad well and load against a truck wall')
  if (!parts.length) parts.push('handle with care and keep it padded')
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('. ') + '.'
}

// ── Truck + labor (from the estimate engine) ─────────────────
const truck = computed(() => {
  const e = estimate.value
  const t = totals.value
  if (!e?.truck?.recommendation || !t) return null
  const rec = e.truck.recommendation
  const catalogued = Math.round(t.volumeCuFt)
  const fillPct = rec.capacityCuFt > 0 ? Math.min(100, Math.max(0, Math.round((catalogued / rec.capacityCuFt) * 100))) : 0
  const roomCount = snapshotTotals.value?.roomCount ?? 0
  const missing = snapshotTotals.value?.missingWeight ?? 0
  const roomsBit = roomCount ? `${roomCount} room${roomCount === 1 ? '' : 's'}` : 'your catalogued items'
  return {
    size: rec.size,
    cap: `~${fmt(rec.capacityCuFt)} cu ft · up to ~${fmt(rec.maxWeightLbs)} lb`,
    fillPct,
    fillLabel: `${fmt(catalogued)} cu ft catalogued`,
    bufferLabel: 'buffer for uncatalogued rooms',
    reasoning:
      `Your catalogue covers ${roomsBit} (~${fmt(catalogued)} cu ft, measured items only). ` +
      `We sized to a ${rec.size} so there's room for anything you haven't logged yet, plus padding and a tight, safe load.` +
      (missing > 0 ? ` ${fmt(missing)} item${missing === 1 ? '' : 's'} still need real weights, so a final walkthrough could shift this a size either way.` : ' A final walkthrough confirms the size.'),
  }
})

const hrs = (h: number) => {
  const half = Math.round(h * 2) / 2
  const label = Number.isInteger(half) ? `${half}` : `${Math.floor(half)}½`
  return `~${label} hr${half === 1 ? '' : 's'}`
}
const labor = computed(() => {
  const e = estimate.value
  if (!e?.labor) return null
  const lo = Math.min(e.labor.numMovers, e.labor.recommendedMovers)
  const hi = Math.max(e.labor.numMovers, e.labor.recommendedMovers)
  const heavies = specialAll.value.filter((x) => (x.weightLbs ?? 0) >= OVERSIZED_LBS).slice(0, 2)
  const heavyBit = heavies.length
    ? `${heavies.map((h) => `the ${fmt(h.weightLbs!)}-lb ${h.name.toLowerCase()}`).join(' and ')} each need 2 people and a dolly. `
    : ''
  const o = moveLoc('origin')
  const flights = o?.number_of_flights ?? move.value?.number_of_flights ?? 0
  const stairBit = flights > 0 && !(o?.has_elevator ?? move.value?.has_elevator)
    ? `Add time for the ${flights}-flight walk-up at origin; there's no elevator.`
    : 'These are working estimates — stairs, long carries and weather all add time.'
  return {
    loadHrs: hrs(e.labor.loadingHours),
    unloadHrs: hrs(e.labor.unloadingHours),
    crew: lo === hi ? `${hi}` : `${lo}–${hi}`,
    note: (heavyBit ? heavyBit.charAt(0).toUpperCase() + heavyBit.slice(1) : '') + stairBit,
  }
})

// ── Cost paths — ranges come from the engine, never summed ───
const costPending = computed(() => scenario.value === 'destination-pending' || (!hasDistance.value && !estimateError.value && scenario.value !== 'local'))

const costIntro = computed(() => {
  if (scenario.value === 'destination-pending')
    return "Once you tell Nexus where you're headed, this section fills in with two side-by-side cost paths — rent-and-drive versus full-service — each as an honest range."
  if (scenario.value === 'local')
    return 'Across-town moves are usually a one-day job. You can rent a truck and hire a couple of movers by the hour, or book a full hourly crew who bring the truck — here’s the rough spread.'
  return 'A long-distance move gives you a real choice: rent a truck and drive it yourself, or hand the whole thing to a full-service crew. Here’s what each path tends to run for a load this size.'
})

const diy = computed<CostPath | null>(() => {
  const c = estimate.value?.cost
  if (!c) return null
  const local = scenario.value === 'local'
  const lines: CostLine[] = [
    { label: local ? 'Truck rental (day rate)' : 'Truck rental', detail: `${c.diy.truckSize} · ${local ? 'local · 1 day' : `one-way · ~${driveDays.value} days`}`, amt: 'Included' },
    { label: 'Fuel', detail: hasDistance.value ? `~${fmt(distanceMiles.value!)} mi of driving` : 'distance-based', amt: 'Included' },
    { label: 'Packing materials', detail: `boxes, tape, pads for ~${fmt(totals.value?.items ?? 0)} items`, amt: 'Included' },
  ]
  if (!local && overnightCount.value > 0)
    lines.push({ label: 'Lodging on the road', detail: `${overnightCount.value} night${overnightCount.value === 1 ? '' : 's'}`, amt: 'Included' })
  lines.push({ label: 'Not in this range', detail: c.diy.notes.replace(/^Does not include /i, '').replace(/\.$/, ''), amt: '—' })
  return {
    name: local ? 'Rent a truck + hire help' : 'Rent & drive it yourself',
    tag: 'Usually lower cost',
    range: `$${fmt(c.diy.low)}–$${fmt(c.diy.high)}`,
    best: local
      ? `you can drive a ${c.diy.truckSize.toLowerCase()} and just want muscle for the heavy lifting.`
      : `you've got the time, a valid license for a ${c.diy.truckSize.toLowerCase()}, and a couple of helpers at each end.`,
    lines,
  }
})

const pro = computed<CostPath | null>(() => {
  const c = estimate.value?.cost
  if (!c) return null
  const local = scenario.value === 'local'
  const lines: CostLine[] = [
    { label: 'Crew & transport', detail: `${c.professional.movers}+ movers · door to door`, amt: 'Included' },
    { label: 'Loading & unloading', detail: 'their crew, both ends', amt: 'Included' },
    { label: 'Packing service', detail: c.professional.includesPacking ? 'full packing included' : 'not included — pack yourself or add it', amt: c.professional.includesPacking ? 'Included' : '—' },
    { label: 'How it’s priced', detail: c.professional.notes.replace(/\.$/, ''), amt: '—' },
  ]
  return {
    name: local ? 'Book an hourly crew' : 'Hire a full-service mover',
    tag: 'Least effort',
    range: `$${fmt(c.professional.low)}–$${fmt(c.professional.high)}`,
    best: local
      ? 'you’d rather hand over the keys and have it done by dinner.'
      : specialAll.value.length
        ? 'you’d rather not touch a box, or the heavy items and access feel like too much.'
        : 'you’d rather not touch a box and want one crew accountable end to end.',
    lines,
  }
})

const costNote = computed(() => {
  const c = estimate.value?.cost
  if (!c) return ''
  const warn = c.dataWarning ? ` ${c.dataWarning}` : ''
  return `${c.caveat}${warn} Treat these as a starting point, not a bill.`
})

// ── Rollup ───────────────────────────────────────────────────
const rollup = computed(() => {
  const t = totals.value
  const st = snapshotTotals.value
  if (!t) return null
  const roomCount = st?.roomCount ?? 0
  return {
    items: t.items,
    estWeightLbs: Math.round(t.weightLbs),
    volumeCuFt: Math.round(t.volumeCuFt),
    specialCount: specialAll.value.length,
    roomsSub: roomCount ? `across ${roomCount} room${roomCount === 1 ? '' : 's'}` : 'from your inventory',
  }
})
const boxes = computed(() => {
  const cs = snapshot.value?.containers
  if (!Array.isArray(cs) || cs.length === 0) return null
  const packed = cs.filter((c) => c.sealed).length
  const toPack = cs.length - packed
  return { packed, toPack, pct: Math.round((packed / cs.length) * 100) }
})
const rollupNote = computed(() => {
  const st = snapshotTotals.value
  const t = totals.value
  if (!st || !t) return 'This plan is built from your current inventory. As you catalogue more, the truck size, weight and both cost ranges will tighten. The full item list lives in your Mover Inventory.'
  const missing = st.missingWeight
  const missingBit = missing > 0 ? `, and ${fmt(missing)} of ${fmt(t.items)} items still need real weights` : ''
  const roomsBit = st.roomCount ? `a partial pass across ${st.roomCount} room${st.roomCount === 1 ? '' : 's'}` : 'a partial pass'
  return `This plan is built from your current inventory — ${roomsBit}${missingBit}. As you catalogue the rest, the truck size, weight and both cost ranges will tighten. The full item list lives in your Mover Inventory.`
})

const routeSubhead = computed(() =>
  scenario.value === 'road-trip'
    ? 'Split into safe days with overnight stops'
    : scenario.value === 'local'
      ? 'One short trip'
      : 'Waiting on a destination'
)
const localHead = computed(() =>
  hasDistance.value ? `${fmt(distanceMiles.value!)} mi · same day` : 'A short hop · same day'
)
</script>

<template>
  <div class="plan-page">
    <div v-if="loading" class="state">Building your move plan…</div>

    <template v-else>
      <div class="toolbar no-print">
        <button class="print-btn" @click="printPage">Save or print PDF</button>
      </div>

      <div class="sheet">
        <!-- (1) Running header — repeats on every printed page -->
        <header class="run-head">
          <div class="brand">
            <svg class="brand-mark" width="22" height="22" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <defs>
                <linearGradient id="nxPlanRouteA" x1="38" y1="42" x2="90" y2="96" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#4F5BF0" /><stop offset="100%" stop-color="#2F35B4" />
                </linearGradient>
                <radialGradient id="nxPlanGlowA" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stop-color="#FFD8BF" /><stop offset="45%" stop-color="#F98D5B" /><stop offset="100%" stop-color="#F98D5B" stop-opacity="0" />
                </radialGradient>
              </defs>
              <path d="M38 96 L38 42 L90 96 L90 48" stroke="url(#nxPlanRouteA)" stroke-width="17" stroke-linecap="round" stroke-linejoin="round" />
              <circle cx="90" cy="42" r="18" fill="url(#nxPlanGlowA)" />
              <circle cx="90" cy="42" r="9.5" fill="#F98D5B" />
              <circle cx="90" cy="42" r="4.4" fill="#FFE2D4" />
            </svg>
            <span class="brand-word">Nexus Moves</span>
          </div>
          <span class="run-eyebrow">Move Plan · Your planning copy</span>
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
                    <p class="eyebrow">Move Plan</p>
                    <h1>{{ heading }}</h1>
                    <p class="title-sub">{{ genLine }}</p>
                  </div>
                  <div class="window-box">
                    <span class="win-label">Move window</span>
                    <span class="win-val">{{ windowLabel }}</span>
                  </div>
                </section>

                <!-- (3) Trip summary card -->
                <section class="trip-card">
                  <div v-if="moveError" class="load-note trip-note">Move details couldn’t be loaded right now — the rest of this plan still stands.</div>
                  <div v-else class="trip-cols">
                    <div class="trip-end">
                      <span class="col-lbl">Leaving from</span>
                      <span class="trip-city">{{ origin?.city || 'Origin' }}</span>
                      <span v-if="origin?.line" class="trip-line">{{ origin.line }}</span>
                      <div v-if="origin?.access.length" class="chips">
                        <span v-for="(c, i) in origin.access" :key="i" class="chip">{{ c }}</span>
                      </div>
                    </div>
                    <div class="trip-mid">
                      <template v-if="hasDistance">
                        <svg class="mid-arrow" width="34" height="16" viewBox="0 0 34 16" fill="none" aria-hidden="true">
                          <path d="M2 8 H27" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 4" />
                          <path d="M24 3 L30 8 L24 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                        </svg>
                        <span class="mid-val">{{ fmt(distanceMiles!) }} mi</span>
                        <span class="mid-sub">{{ distanceSub }}</span>
                      </template>
                      <span v-else class="mid-pending">distance<br />pending</span>
                    </div>
                    <div class="trip-end trip-to">
                      <span class="col-lbl">Heading to</span>
                      <template v-if="destination">
                        <span class="trip-city dest"><span class="beacon-dot" aria-hidden="true"></span>{{ destination.city }}</span>
                        <span v-if="destination.line" class="trip-line">{{ destination.line }}</span>
                        <div v-if="destination.access.length" class="chips">
                          <span v-for="(c, i) in destination.access" :key="i" class="chip chip-card">{{ c }}</span>
                        </div>
                      </template>
                      <template v-else>
                        <span class="trip-city pending"><span class="beacon-dot" aria-hidden="true"></span>Destination pending</span>
                        <span class="trip-line muted">Tell Nexus where you’re headed and we’ll finish the plan — distance, route and both cost paths.</span>
                      </template>
                    </div>
                  </div>
                </section>

                <!-- (4) Honest promise banner — always shown -->
                <section class="honest">
                  <TriangleAlert :size="19" class="honest-icon" aria-hidden="true" />
                  <div>
                    <p class="honest-head">Every figure here is an estimate to help you decide</p>
                    <p class="honest-body">
                      This is a planning copy — not a quote, and not a guarantee. Real numbers depend on an
                      on-site survey, how much you end up packing, and when you move. We’d rather hand you an
                      honest range than a confident wrong number, so nothing below is locked in.
                    </p>
                  </div>
                </section>

                <!-- (5) What it might cost -->
                <section class="doc-section cost-section">
                  <div class="sec-head">
                    <h2>What it might cost</h2>
                    <span class="sec-sub">Two honest paths — your call on which fits</span>
                  </div>
                  <p class="sec-intro">{{ costIntro }}</p>

                  <div v-if="costPending" class="empty-card">
                    <p class="empty-head">Cost paths open once we know the destination</p>
                    <p class="empty-body">
                      Distance, fuel, truck rental and mover pricing all hinge on where you’re going. Set your
                      destination and we’ll lay out the DIY and full-service ranges side by side — the same way
                      as everything else here.
                    </p>
                  </div>
                  <div v-else-if="estimateError || !diy || !pro" class="load-note">
                    The estimate engine couldn’t be reached, so no cost ranges this time. Reload to try again —
                    the rest of the plan doesn’t depend on it.
                  </div>
                  <template v-else>
                    <div class="cost-row">
                      <div v-if="costPath !== 'pro'" class="cost-card">
                        <div class="cost-top">
                          <div class="cost-name-row">
                            <span class="cost-ico"><Truck :size="17" aria-hidden="true" /></span>
                            <span class="cost-name">{{ diy.name }}</span>
                            <span class="cost-tag">{{ diy.tag }}</span>
                          </div>
                          <div class="cost-range">{{ diy.range }}</div>
                          <div class="cost-est">Estimated total</div>
                        </div>
                        <div v-if="showBreakdown" class="cost-lines">
                          <div v-for="(l, i) in diy.lines" :key="i" class="cost-line">
                            <div class="cl-text">
                              <span class="cl-label">{{ l.label }}</span>
                              <span class="cl-detail">{{ l.detail }}</span>
                            </div>
                            <span class="cl-amt">{{ l.amt }}</span>
                          </div>
                        </div>
                        <div class="cost-best"><b>Best if</b> {{ diy.best }}</div>
                      </div>

                      <div v-if="costPath !== 'diy'" class="cost-card">
                        <div class="cost-top">
                          <div class="cost-name-row">
                            <span class="cost-ico"><Users :size="17" aria-hidden="true" /></span>
                            <span class="cost-name">{{ pro.name }}</span>
                            <span class="cost-tag">{{ pro.tag }}</span>
                          </div>
                          <div class="cost-range">{{ pro.range }}</div>
                          <div class="cost-est">Estimated total</div>
                        </div>
                        <div v-if="showBreakdown" class="cost-lines">
                          <div v-for="(l, i) in pro.lines" :key="i" class="cost-line">
                            <div class="cl-text">
                              <span class="cl-label">{{ l.label }}</span>
                              <span class="cl-detail">{{ l.detail }}</span>
                            </div>
                            <span class="cl-amt">{{ l.amt }}</span>
                          </div>
                        </div>
                        <div class="cost-best"><b>Best if</b> {{ pro.best }}</div>
                      </div>
                    </div>
                    <div class="dot-note">
                      <span class="dot dot-accent" aria-hidden="true"></span>
                      <span>{{ costNote }}</span>
                    </div>
                  </template>
                </section>

                <!-- (6) Recommended truck + Labor & crew -->
                <section class="pair-row">
                  <div class="pair-card truck-card">
                    <div class="card-head">
                      <h2 class="card-title">Recommended truck</h2>
                      <span class="card-eyebrow">We recommend</span>
                    </div>
                    <template v-if="truck">
                      <div class="truck-line">
                        <span class="truck-size">{{ truck.size }}</span>
                        <span class="truck-cap">{{ truck.cap }}</span>
                      </div>
                      <div class="cap-bar-wrap">
                        <div class="cap-bar" role="img" :aria-label="`${truck.fillPct} percent of truck capacity catalogued`">
                          <div class="cap-fill" :style="{ width: truck.fillPct + '%' }"></div>
                        </div>
                        <div class="cap-labels">
                          <span>{{ truck.fillLabel }}</span>
                          <span>{{ truck.bufferLabel }}</span>
                        </div>
                      </div>
                      <p class="card-body-text">{{ truck.reasoning }}</p>
                    </template>
                    <div v-else class="load-note">Truck sizing needs the estimate engine — it couldn’t be reached just now.</div>
                  </div>

                  <div class="pair-card">
                    <div class="card-head">
                      <h2 class="card-title">Labor &amp; crew</h2>
                      <span class="card-eyebrow">Est. hours</span>
                    </div>
                    <template v-if="labor">
                      <div class="labor-figs">
                        <div class="fig">
                          <span class="fig-num">{{ labor.loadHrs }}</span>
                          <span class="fig-lbl">Loading</span>
                        </div>
                        <div class="fig">
                          <span class="fig-num">{{ labor.unloadHrs }}</span>
                          <span class="fig-lbl">Unloading</span>
                        </div>
                        <div class="fig">
                          <span class="fig-num crew">{{ labor.crew }}</span>
                          <span class="fig-lbl">Crew</span>
                        </div>
                      </div>
                      <p class="card-body-text">{{ labor.note }}</p>
                    </template>
                    <div v-else class="load-note">Labor estimates need the estimate engine — it couldn’t be reached just now.</div>
                  </div>
                </section>

                <!-- (7) The drive -->
                <section class="doc-section">
                  <div class="sec-head">
                    <h2>The drive</h2>
                    <span class="sec-sub">{{ routeSubhead }}</span>
                  </div>

                  <div v-if="scenario === 'road-trip'" class="route-card">
                    <div class="route-summary">
                      <div><span class="rs-num">{{ hasDistance ? fmt(distanceMiles!) + ' mi' : '—' }}</span> <span class="rs-lbl">driving</span></div>
                      <div><span class="rs-num">{{ driveDays }}</span> <span class="rs-lbl">on the road</span></div>
                      <div><span class="rs-num">{{ overnightCount }}</span> <span class="rs-lbl">overnights</span></div>
                    </div>
                    <div class="route-body">
                      <div v-if="waypointsError" class="load-note">The stop-by-stop route couldn’t be loaded — the totals above still hold.</div>
                      <template v-else>
                        <div v-for="(g, i) in legs" :key="i" class="leg-row">
                          <span class="leg-dot" :class="{ arrive: g.arrive, mid: !g.arrive && i > 0 }" aria-hidden="true"></span>
                          <div class="leg-main">
                            <span class="leg-cities">{{ g.from }} <span class="leg-arrow">→</span> {{ g.to }}</span>
                            <span v-if="g.overnight" class="pill pill-night"><Moon :size="9" aria-hidden="true" /> {{ g.overnight }}</span>
                            <span v-if="g.arrive" class="pill pill-arrive">Arrive</span>
                          </div>
                          <span class="leg-miles">{{ g.miles }}</span>
                        </div>
                        <div v-if="!legs.length" class="load-note">No overnight stops planned yet — for a drive this long we’d suggest breaking it into ~{{ SAFE_DAY_MILES }}-mile days.</div>
                      </template>
                      <div class="dot-note pace-note">
                        <span class="dot dot-beacon" aria-hidden="true"></span>
                        <span>We keep days to roughly {{ SAFE_DAY_MILES }} miles so you’re never wrestling a loaded truck exhausted. Book overnight stops ahead in busy seasons — highway-town motels fill up.</span>
                      </div>
                    </div>
                  </div>

                  <div v-else-if="scenario === 'local'" class="local-card">
                    <div class="local-viz" aria-hidden="true">
                      <span class="lv-dot origin"></span>
                      <svg width="40" height="14" viewBox="0 0 40 14" fill="none">
                        <path d="M2 7 H33" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 4" opacity="0.45" />
                        <path d="M30 3 L36 7 L30 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                      </svg>
                      <span class="lv-dot beacon"></span>
                    </div>
                    <div>
                      <div class="local-head">{{ localHead }}</div>
                      <div class="local-blurb">
                        No overnight route to plan. Load in the morning, drive across, and unload the same
                        afternoon. If it runs long, a second trip is easy at this distance.
                      </div>
                    </div>
                  </div>

                  <div v-else class="empty-card">
                    <p class="empty-head">Your route maps itself once the destination is set</p>
                    <p class="empty-body">
                      If it’s a long haul, we’ll split the drive into safe ~{{ SAFE_DAY_MILES }}-mile days and
                      suggest overnight stops. If it’s across town, we’ll just say so — no route card needed.
                    </p>
                  </div>
                </section>

                <!-- (8) Special handling -->
                <section class="doc-section sh-section">
                  <div class="sec-head">
                    <h2>Special handling</h2>
                    <span class="sec-sub">Anyone loading the truck should read this first</span>
                  </div>
                  <div v-if="inventoryError" class="load-note">Your inventory couldn’t be loaded, so no special-handling list this time — check the Mover Inventory directly.</div>
                  <div v-else-if="!special.length" class="empty-card">
                    <p class="empty-head">Nothing flagged yet</p>
                    <p class="empty-body">As you catalogue items, anything oversized, heavy (≥{{ HEAVY_LBS }} lb) or fragile shows up here with plain-language handling notes.</p>
                  </div>
                  <template v-else>
                    <div class="sh-grid">
                      <div v-for="(x, i) in special" :key="i" class="sh-card">
                        <div class="sh-weight">
                          <span class="sh-wt">{{ x.weightLbs != null ? fmt(x.weightLbs) : '—' }}</span>
                          <span class="sh-unit">lbs</span>
                        </div>
                        <div class="sh-body">
                          <div class="sh-top">
                            <span class="sh-name">{{ x.name }}</span>
                            <span class="pill" :class="`pill-${x.flag}`">{{ x.flag }}</span>
                          </div>
                          <div class="sh-note">{{ x.note }}</div>
                        </div>
                      </div>
                    </div>
                    <p v-if="specialOverflow" class="sh-more">+ {{ specialOverflow }} more flagged item{{ specialOverflow === 1 ? '' : 's' }} — the full list lives in your Mover Inventory.</p>
                  </template>
                </section>

                <!-- (9) What we're moving -->
                <section class="doc-section rollup-section">
                  <div class="sec-head">
                    <h2>What we’re moving</h2>
                    <span class="sec-sub">Rolled up from your inventory</span>
                  </div>
                  <div v-if="!rollup" class="load-note">Inventory totals couldn’t be loaded — the Mover Inventory has the full picture.</div>
                  <template v-else>
                    <div class="tiles">
                      <div class="tile">
                        <div class="tile-bar bar-shimmer" aria-hidden="true"></div>
                        <span class="tile-lbl">Items</span>
                        <span class="tile-num">{{ fmt(rollup.items) }}</span>
                        <span class="tile-sub">{{ rollup.roomsSub }}</span>
                      </div>
                      <div class="tile">
                        <div class="tile-bar bar-accent" aria-hidden="true"></div>
                        <span class="tile-lbl">Est. weight</span>
                        <span class="tile-num">{{ fmt(rollup.estWeightLbs) }} <span class="tile-unit">lbs</span></span>
                        <span class="tile-sub">conservative estimate</span>
                      </div>
                      <div class="tile">
                        <div class="tile-bar bar-accent" aria-hidden="true"></div>
                        <span class="tile-lbl">Volume</span>
                        <span class="tile-num">{{ fmt(rollup.volumeCuFt) }} <span class="tile-unit">cu ft</span></span>
                        <span class="tile-sub">measured items only</span>
                      </div>
                      <div class="tile">
                        <div class="tile-bar bar-beacon" aria-hidden="true"></div>
                        <span class="tile-lbl">Special handling</span>
                        <span class="tile-num">{{ fmt(rollup.specialCount) }} <span class="tile-unit">items</span></span>
                        <span class="tile-sub">heavy, oversized &amp; fragile</span>
                      </div>
                    </div>
                    <div v-if="boxes" class="boxes-row">
                      <span class="boxes-text"><b>{{ fmt(boxes.packed) }}</b> boxes packed · <b>{{ fmt(boxes.toPack) }}</b> to go</span>
                      <div class="boxes-track" role="img" :aria-label="`${boxes.pct} percent of boxes packed`">
                        <div class="boxes-fill" :style="{ width: boxes.pct + '%' }"></div>
                      </div>
                      <span class="boxes-pct">{{ boxes.pct }}% packed</span>
                    </div>
                    <p class="rollup-note">{{ rollupNote }}</p>
                  </template>
                </section>

                <!-- (11) Closing line -->
                <div class="closing">
                  <svg class="closing-mark" width="15" height="15" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <defs>
                      <linearGradient id="nxPlanRouteB" x1="38" y1="42" x2="90" y2="96" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stop-color="#4F5BF0" /><stop offset="100%" stop-color="#2F35B4" />
                      </linearGradient>
                    </defs>
                    <path d="M38 96 L38 42 L90 96 L90 48" stroke="url(#nxPlanRouteB)" stroke-width="17" stroke-linecap="round" stroke-linejoin="round" />
                    <circle cx="90" cy="42" r="9.5" fill="#F98D5B" />
                    <circle cx="90" cy="42" r="4.4" fill="#FFE2D4" />
                  </svg>
                  <span>Built with Nexus Moves to help you plan — not a quote.</span>
                </div>

              </td>
            </tr>
          </tbody>
          <tfoot class="frame-spacer"><tr><td><div class="foot-space"></div></td></tr></tfoot>
        </table>

        <!-- (10) Running footer — repeats on every printed page -->
        <footer class="run-foot">
          <span>Estimates only · not a quote or a guarantee</span>
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
.plan-page {
  min-height: 100vh;
  background: var(--bg);
  padding: var(--sp-7) var(--sp-6) var(--sp-11);
  font-family: var(--font-ui);
  font-size: 15px;
  line-height: var(--lh-body);
  color: var(--text-primary);
}
.state { text-align: center; padding: 80px 20px; color: var(--text-secondary); }

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
.title-block { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-6); }
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
.window-box { display: flex; flex-direction: column; align-items: flex-end; text-align: right; flex: none; }
.win-label { font-family: var(--font-mono); font-size: 10px; font-weight: var(--fw-semibold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-tertiary); }
.win-val { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 22px; line-height: 1.15; color: var(--text-primary); margin-top: var(--sp-2); white-space: nowrap; font-variant-numeric: tabular-nums; }

/* ── (3) Trip summary card ──────────────────────────────────── */
.trip-card {
  margin-top: var(--sp-6);
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--surface-card); box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.trip-cols { display: flex; align-items: stretch; }
.trip-end { flex: 1; padding: var(--sp-5) var(--sp-6); min-width: 0; }
.trip-to { background: var(--surface-sunk); }
.col-lbl { display: block; font-family: var(--font-mono); font-size: 10px; font-weight: var(--fw-semibold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-tertiary); margin-bottom: var(--sp-3); }
.trip-city { font-family: var(--font-display); font-weight: var(--fw-semibold); font-size: 18px; letter-spacing: var(--ls-title); color: var(--text-primary); }
.trip-city.dest, .trip-city.pending { display: inline-flex; align-items: center; gap: var(--sp-3); }
.trip-city.pending { color: var(--text-tertiary); }
.trip-line { display: block; font-size: 12.5px; color: var(--text-secondary); margin-top: var(--sp-1); }
.trip-line.muted { color: var(--text-tertiary); }
.beacon-dot {
  width: 9px; height: 9px; border-radius: var(--r-pill); background: var(--beacon);
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--beacon) 18%, transparent);
  display: inline-block; flex: none;
}
.chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-4); }
.chip {
  font-family: var(--font-mono); font-size: 9.5px; color: var(--text-secondary);
  background: var(--surface-hover); border-radius: var(--r-pill); padding: 4px 9px;
}
.chip-card { background: var(--surface-card); border: 1px solid var(--border); }
.trip-mid {
  flex: none; width: 132px;
  border-left: 1px solid var(--border-soft); border-right: 1px solid var(--border-soft);
  background: var(--surface-sunk);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: var(--sp-4) var(--sp-3); text-align: center;
}
.mid-arrow { color: var(--accent); margin-bottom: var(--sp-3); }
.mid-val { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 18px; line-height: 1; letter-spacing: var(--ls-display); color: var(--text-primary); font-variant-numeric: tabular-nums; }
.mid-sub { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.06em; color: var(--text-tertiary); margin-top: var(--sp-2); }
.mid-pending { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-tertiary); }
.trip-note { margin: var(--sp-5) var(--sp-6); }

/* ── (4) Honest banner ──────────────────────────────────────── */
.honest {
  display: flex; gap: var(--sp-4); align-items: flex-start;
  margin-top: var(--sp-4); padding: var(--sp-5) var(--sp-6);
  background: var(--warning-surface); border: 1px solid var(--border);
  border-radius: var(--r-lg); color: var(--warning-ink);
}
.honest-icon { flex: none; margin-top: 1px; color: var(--warning-ink); }
.honest-head { margin: 0; font-family: var(--font-display); font-weight: var(--fw-semibold); font-size: 15px; }
.honest-body { margin: var(--sp-2) 0 0; font-size: 13px; line-height: var(--lh-body); }

/* ── Section scaffolding ────────────────────────────────────── */
.doc-section { margin-top: var(--sp-8); }
.sec-head { display: flex; align-items: baseline; gap: var(--sp-3); margin-bottom: var(--sp-4); }
h2 {
  margin: 0; font-family: var(--font-display); font-weight: var(--fw-bold);
  font-size: 19px; letter-spacing: var(--ls-title); color: var(--text-primary);
}
.sec-sub { font-size: 12.5px; color: var(--text-tertiary); }
.sec-intro { margin: 0 0 var(--sp-4); font-size: 12.5px; line-height: var(--lh-body); color: var(--text-secondary); max-width: 660px; }

/* Quiet per-card degradation notice — never a blank page. */
.load-note {
  font-size: 12px; line-height: var(--lh-body); color: var(--text-tertiary);
  border: 1px dashed var(--accent-quiet-2); border-radius: var(--r-md);
  background: var(--surface-sunk); padding: var(--sp-4) var(--sp-5);
}

/* Designed empty states — dashed border on sunk surface. */
.empty-card {
  border: 1px dashed var(--accent-quiet-2); border-radius: var(--r-lg);
  background: var(--surface-sunk); padding: var(--sp-7) var(--sp-6); text-align: center;
}
.empty-head { margin: 0; font-family: var(--font-display); font-weight: var(--fw-semibold); font-size: 16px; letter-spacing: var(--ls-title); color: var(--text-primary); }
.empty-body { margin: var(--sp-2) auto 0; font-size: 12.5px; line-height: var(--lh-body); color: var(--text-secondary); max-width: 480px; }

/* ── (5) Cost cards ─────────────────────────────────────────── */
.cost-row { display: flex; gap: var(--sp-4); align-items: stretch; }
.cost-card {
  flex: 1; min-width: 0; display: flex; flex-direction: column;
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--surface-card); box-shadow: var(--shadow-sm); overflow: hidden;
}
.cost-top { padding: var(--sp-5) var(--sp-5) var(--sp-4); }
.cost-name-row { display: flex; align-items: center; gap: var(--sp-3); }
.cost-ico {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: var(--r-xs);
  background: var(--accent-quiet); color: var(--accent); flex: none;
}
.cost-name { font-family: var(--font-display); font-weight: var(--fw-semibold); font-size: 15px; letter-spacing: var(--ls-title); color: var(--text-primary); min-width: 0; }
.cost-tag {
  margin-left: auto; flex: none;
  font-family: var(--font-mono); font-size: 8.5px; font-weight: var(--fw-medium);
  letter-spacing: 0.06em; text-transform: uppercase;
  padding: 3px 8px; border-radius: var(--r-pill);
  background: var(--accent-quiet); color: var(--accent-press);
}
.cost-range { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 27px; line-height: 1; letter-spacing: var(--ls-display); color: var(--text-primary); margin-top: var(--sp-4); font-variant-numeric: tabular-nums; }
.cost-est { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-tertiary); margin-top: var(--sp-2); }
.cost-lines { padding: 0 var(--sp-5); }
.cost-line { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-4); padding: 9px 0; border-top: 1px solid var(--border-soft); }
.cl-text { min-width: 0; }
.cl-label { display: block; font-size: 12.5px; font-weight: var(--fw-medium); color: var(--text-primary); }
.cl-detail { display: block; font-family: var(--font-mono); font-size: 9.5px; color: var(--text-tertiary); margin-top: 2px; line-height: 1.3; }
.cl-amt { font-family: var(--font-mono); font-size: 11.5px; font-weight: var(--fw-medium); color: var(--text-secondary); white-space: nowrap; flex: none; padding-top: 1px; }
.cost-best {
  margin-top: auto; padding: var(--sp-4) var(--sp-5) var(--sp-5);
  border-top: 1px solid var(--border-soft); background: var(--surface-sunk);
  font-size: 12px; line-height: var(--lh-body); color: var(--text-secondary);
}
.cost-best b { color: var(--text-primary); font-weight: var(--fw-semibold); }

.dot-note {
  display: flex; align-items: flex-start; gap: var(--sp-3);
  margin-top: var(--sp-4); padding: var(--sp-4) var(--sp-5);
  border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-sunk);
  font-size: 12px; line-height: var(--lh-body); color: var(--text-secondary);
}
.dot { width: 6px; height: 6px; border-radius: var(--r-pill); margin-top: 5px; flex: none; }
.dot-accent { background: var(--accent); }
.dot-beacon { background: var(--beacon); }

/* ── (6) Truck + labor pair ─────────────────────────────────── */
.pair-row { display: flex; gap: var(--sp-4); margin-top: var(--sp-8); align-items: stretch; }
.pair-card {
  flex: 1; min-width: 0; display: flex; flex-direction: column;
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--surface-card); box-shadow: var(--shadow-sm);
  padding: var(--sp-5) var(--sp-6);
}
.truck-card { flex: 1.35; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-4); }
.card-title { font-size: 17px; }
.card-eyebrow { font-family: var(--font-mono); font-size: 9px; font-weight: var(--fw-semibold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-tertiary); }
.truck-line { display: flex; align-items: baseline; gap: var(--sp-3); flex-wrap: wrap; }
.truck-size { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 30px; line-height: 1; letter-spacing: var(--ls-display); color: var(--text-primary); }
.truck-cap { font-size: 12.5px; color: var(--text-tertiary); }
.cap-bar-wrap { margin-top: var(--sp-5); }
.cap-bar { display: flex; height: 12px; border-radius: var(--r-pill); overflow: hidden; background: var(--surface-hover); border: 1px solid var(--border); }
.cap-fill { background: var(--shimmer); }
.cap-labels { display: flex; justify-content: space-between; gap: var(--sp-3); margin-top: var(--sp-2); font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.04em; color: var(--text-tertiary); }
.card-body-text { margin: var(--sp-4) 0 0; font-size: 12px; line-height: var(--lh-body); color: var(--text-secondary); }
.labor-figs { display: flex; gap: var(--sp-7); }
.fig { display: flex; flex-direction: column; }
.fig-num { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 24px; line-height: 1; letter-spacing: var(--ls-display); color: var(--text-primary); font-variant-numeric: tabular-nums; }
.fig-num.crew { color: var(--accent); }
.fig-lbl { font-family: var(--font-mono); font-size: 9px; font-weight: var(--fw-semibold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-tertiary); margin-top: var(--sp-2); }

/* ── (7) The drive ──────────────────────────────────────────── */
.route-card {
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--surface-card); box-shadow: var(--shadow-sm); overflow: hidden;
}
.route-summary {
  display: flex; gap: var(--sp-7); flex-wrap: wrap;
  padding: var(--sp-4) var(--sp-6);
  border-bottom: 1px solid var(--border-soft); background: var(--surface-sunk);
}
.rs-num { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 19px; letter-spacing: var(--ls-display); color: var(--text-primary); font-variant-numeric: tabular-nums; }
.rs-lbl { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
.route-body { padding: var(--sp-2) var(--sp-6) var(--sp-4); }
.leg-row { display: flex; align-items: center; gap: var(--sp-5); padding: 11px 0; border-bottom: 1px solid var(--border-soft); }
.leg-dot { width: 10px; height: 10px; border-radius: var(--r-pill); background: var(--accent); flex: none; }
.leg-dot.mid { background: var(--accent-hover); }
.leg-dot.arrive { background: var(--beacon); box-shadow: 0 0 0 4px color-mix(in oklab, var(--beacon) 18%, transparent); }
.leg-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.leg-cities { font-size: 13.5px; font-weight: var(--fw-medium); color: var(--text-primary); }
.leg-arrow { color: var(--accent-quiet-2); }
.leg-miles { font-family: var(--font-mono); font-size: 12px; font-weight: var(--fw-medium); color: var(--text-secondary); white-space: nowrap; flex: none; font-variant-numeric: tabular-nums; }
.pace-note { border: 0; background: transparent; padding: var(--sp-4) 0 0; margin-top: var(--sp-1); }

.local-card {
  display: flex; align-items: center; gap: var(--sp-6);
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--surface-card); box-shadow: var(--shadow-sm);
  padding: var(--sp-6) var(--sp-6);
}
.local-viz { display: flex; align-items: center; gap: var(--sp-4); flex: none; color: var(--accent); }
.lv-dot { width: 11px; height: 11px; border-radius: var(--r-pill); }
.lv-dot.origin { background: var(--accent); }
.lv-dot.beacon { background: var(--beacon); box-shadow: 0 0 0 4px color-mix(in oklab, var(--beacon) 18%, transparent); }
.local-head { font-family: var(--font-display); font-weight: var(--fw-semibold); font-size: 16px; letter-spacing: var(--ls-title); color: var(--text-primary); }
.local-blurb { font-size: 12.5px; line-height: var(--lh-body); color: var(--text-secondary); margin-top: var(--sp-2); }

/* Pills */
.pill {
  display: inline-flex; align-items: center; gap: 4px; flex: none;
  font-family: var(--font-mono); font-size: 8.5px; font-weight: var(--fw-medium);
  letter-spacing: 0.06em; text-transform: uppercase;
  border-radius: var(--r-pill); padding: 2px 7px; white-space: nowrap;
}
.pill-night { background: var(--accent-quiet); color: var(--accent-press); }
.pill-arrive { background: color-mix(in oklab, var(--beacon) 18%, transparent); color: var(--warning-ink); }
.pill-oversized { background: color-mix(in oklab, var(--beacon) 18%, transparent); color: var(--warning-ink); }
.pill-heavy { background: var(--accent-quiet); color: var(--accent-press); }
.pill-fragile { background: color-mix(in oklab, var(--cyan-600) 12%, transparent); color: var(--cyan-600); }

/* ── (8) Special handling ───────────────────────────────────── */
.sh-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--sp-4); }
.sh-card {
  display: flex; gap: var(--sp-4);
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--surface-card); box-shadow: var(--shadow-sm);
  padding: var(--sp-4) var(--sp-5);
}
.sh-weight { flex: none; text-align: center; min-width: 52px; }
.sh-wt { display: block; font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 20px; line-height: 1; letter-spacing: var(--ls-display); color: var(--text-primary); font-variant-numeric: tabular-nums; }
.sh-unit { display: block; font-family: var(--font-mono); font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); margin-top: var(--sp-2); }
.sh-body { min-width: 0; border-left: 1px solid var(--border-soft); padding-left: var(--sp-4); }
.sh-top { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.sh-name { font-weight: var(--fw-semibold); font-size: 13px; line-height: 1.2; color: var(--text-primary); }
.sh-note { font-size: 11.5px; line-height: 1.4; color: var(--text-secondary); margin-top: var(--sp-2); }
.sh-more { margin: var(--sp-3) 0 0; font-size: 12px; color: var(--text-secondary); }

/* ── (9) Rollup tiles + boxes bar ───────────────────────────── */
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--sp-4); }
.tile {
  display: flex; flex-direction: column;
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--surface-card); box-shadow: var(--shadow-sm); overflow: hidden;
  padding: 0 var(--sp-5) var(--sp-4);
}
.tile-bar { height: 3px; margin: 0 calc(-1 * var(--sp-5)) var(--sp-4); }
.bar-shimmer { background: var(--shimmer); }
.bar-accent { background: var(--accent); }
.bar-beacon { background: var(--beacon); }
.tile-lbl { font-family: var(--font-mono); font-size: 9.5px; font-weight: var(--fw-semibold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--text-secondary); }
.tile-num { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 26px; line-height: 1.2; color: var(--text-primary); margin-top: var(--sp-3); font-variant-numeric: tabular-nums; }
.tile-unit { font-family: var(--font-ui); font-size: 12px; font-weight: var(--fw-medium); color: var(--text-tertiary); }
.tile-sub { font-size: 11.5px; color: var(--text-tertiary); margin-top: var(--sp-1); }

.boxes-row {
  display: flex; align-items: center; gap: var(--sp-5);
  margin-top: var(--sp-4); padding: var(--sp-4) var(--sp-5);
  border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-sunk);
}
.boxes-text { font-size: 12.5px; color: var(--text-secondary); flex: none; }
.boxes-text b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.boxes-track { flex: 1; height: 8px; border-radius: var(--r-pill); background: var(--surface-hover); border: 1px solid var(--border-soft); overflow: hidden; }
.boxes-fill { height: 100%; border-radius: var(--r-pill); background: var(--shimmer); }
.boxes-pct { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-tertiary); flex: none; font-variant-numeric: tabular-nums; }
.rollup-note { margin: var(--sp-4) 0 0; font-size: 12px; line-height: var(--lh-body); color: var(--text-secondary); max-width: 680px; }

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
  .plan-page { padding: var(--sp-5) var(--sp-4) var(--sp-9); }
  .frame-body { padding: var(--sp-6) var(--sp-5) var(--sp-7); }
  .run-head, .run-foot { padding-left: var(--sp-5); padding-right: var(--sp-5); }
  .trip-cols { flex-direction: column; }
  .trip-mid { width: auto; border-left: 0; border-right: 0; border-top: 1px solid var(--border-soft); border-bottom: 1px solid var(--border-soft); }
  .cost-row, .pair-row { flex-direction: column; }
  .tiles { grid-template-columns: repeat(2, 1fr); }
  .sh-grid { grid-template-columns: 1fr; }
  .title-block { flex-direction: column; align-items: flex-start; }
  .window-box { align-items: flex-start; text-align: left; margin-top: var(--sp-4); }
  h1 { font-size: 27px; }
}
@media (max-width: 460px) {
  .tiles { grid-template-columns: 1fr; }
  .labor-figs { gap: var(--sp-5); }
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

  .plan-page {
    padding: 0; background: var(--surface-card);
    font-size: 12.5px;
    orphans: 3; widows: 3;
  }
  .plan-page * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
  .trip-card, .honest, .cost-card, .pair-card, .pair-row, .route-card, .local-card,
  .empty-card, .sh-card, .tile, .boxes-row, .dot-note, .closing, .load-note {
    break-inside: avoid; page-break-inside: avoid;
  }
  h1, h2, .sec-head, .title-block { break-after: avoid; page-break-after: avoid; }
  .doc-section { break-inside: auto; }
  /* Keep the heart of the document — heading, intro, both cost
     cards and the assumptions note — on one page together. */
  .cost-section { break-inside: avoid; page-break-inside: avoid; }
  .leg-row { break-inside: avoid; page-break-inside: avoid; }
  .sh-section, .rollup-section { break-inside: avoid; page-break-inside: avoid; }

  /* Modest print scale */
  h1 { font-size: 30px; }
  h2 { font-size: 17px; }
  .cost-range { font-size: 24px; }
  .tile-num { font-size: 23px; }
  .truck-size { font-size: 27px; }
  .win-val { font-size: 20px; }
}
</style>
