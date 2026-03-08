<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { inventoryStore } from '../../../stores/InventoryStore'
import { storeToRefs } from 'pinia'
import axios from 'axios'
import { useQuasar } from 'quasar'
import { useRouter } from 'vue-router'

const props = defineProps<{
  user?: string
  currentSavedMoveId?: number | null
  savedMoves?: any[]
  originLocation?: string | null
  destinationLocation?: string | null
  moveDate?: string | null
  moveDateEnd?: string | null
  recommendedTruckSize?: string | null
}>()

const store = inventoryStore()
const $q = useQuasar()
const router = useRouter()
const { locations, containers, collections } = storeToRefs(store)

const core_url = import.meta.env.MODE == 'development'
  ? 'http://localhost:3050'
  : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'

// Tab management
const moveDayTab = ref<'overview' | 'timeline' | 'checklist' | 'crew'>('overview')

// Move sessions
const moveSessions = ref<any[]>([])
const activeSession = ref<any | null>(null)

// Sorted sessions by date
const sortedSessions = computed(() => {
  return [...moveSessions.value].sort((a, b) => {
    const dateA = new Date(a.session_date || a.move_date).getTime()
    const dateB = new Date(b.session_date || b.move_date).getTime()
    return dateA - dateB
  })
})
const sessionDetails = ref<any | null>(null)
const loadingSessions = ref(false)
const loadingDetails = ref(false)

// Progress stats
const progressStats = ref<any>({
  boxes_loaded: 0,
  boxes_unloaded: 0,
  boxes_unpacked: 0,
  total_containers: 0,
  damage_reports_count: 0,
  crew_count: 0
})

// Dialogs
const showCreateSession = ref(false)
const showScanDialog = ref(false)
const showDamageDialog = ref(false)
const showCrewDialog = ref(false)
const showLoadingPlanDialog = ref(false)

const userData = ref<any>({})
if (typeof window !== 'undefined') {
  try {
    userData.value = JSON.parse(localStorage.getItem('user_data') || '{}')
  } catch (e) {
    userData.value = {}
  }
}
const planPreviewOverride = ref<'basic' | 'pro' | null>(localStorage.getItem('plan_preview') as 'basic' | 'pro' | null)
const basePlan = computed(() => (userData.value?.plan || 'basic').toLowerCase())
const effectivePlan = computed(() => (planPreviewOverride.value || basePlan.value) as 'basic' | 'pro')
const isProPlan = computed(() => effectivePlan.value === 'pro')
const goToPricing = () => router.push('/pricing')

onMounted(() => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === 'plan_preview') {
      planPreviewOverride.value = (event.newValue as 'basic' | 'pro' | null) || null
    }
  }
  const handleCustom = (event: Event) => {
    planPreviewOverride.value = ((event as CustomEvent).detail as 'basic' | 'pro' | null) || null
  }
  window.addEventListener('storage', handleStorage)
  window.addEventListener('plan-preview-change', handleCustom as EventListener)
  onBeforeUnmount(() => {
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener('plan-preview-change', handleCustom as EventListener)
  })
})

// Loose items and loading zones
const looseItems = ref<any[]>([])
const loadingPlan = ref<any | null>(null)
// Map recommendation format (e.g. "10 ft") to API format (e.g. "10ft")
const normalizeTruckSize = (size: string | null | undefined) => {
  if (!size) return ''
  return size.toLowerCase().replace(/\s+/g, '')
}
const truckSize = ref<string>(normalizeTruckSize(props.recommendedTruckSize))

const normalizeSessionDate = (value?: string | null) => {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value?.slice(0, 10) || null
  }
  return parsed.toISOString().split('T')[0]
}

const moveWindow = ref({
  start: normalizeSessionDate(props.moveDate),
  end: normalizeSessionDate(props.moveDateEnd || props.moveDate)
})

watch(() => props.moveDate, (newStart) => {
  moveWindow.value.start = normalizeSessionDate(newStart)
  if (!moveWindow.value.end || (moveWindow.value.start && moveWindow.value.end && moveWindow.value.end < moveWindow.value.start)) {
    moveWindow.value.end = moveWindow.value.start
  }
})

watch(() => props.moveDateEnd, (newEnd) => {
  moveWindow.value.end = normalizeSessionDate(newEnd) || moveWindow.value.start || null
})

const formatWindowDate = (value: string | null) => {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString()
}

const moveWindowLabel = computed(() => {
  const start = formatWindowDate(moveWindow.value.start)
  const end = formatWindowDate(moveWindow.value.end)
  if (start && end) {
    if (moveWindow.value.start === moveWindow.value.end) {
      return start
    }
    return `${start} → ${end}`
  }
  if (start) return start
  return 'Not scheduled'
})

const sessionWindowStart = computed(() => moveWindow.value.start)
const sessionWindowEnd = computed(() => moveWindow.value.end)

const sessionTypeState = computed(() => newSession.value.session_type)
const isLoadingSession = computed(() => sessionTypeState.value === 'loading')
const isUnloadingSession = computed(() => sessionTypeState.value === 'unloading')
const isTransferSession = computed(() => sessionTypeState.value === 'transfer')
const isDrivingSession = computed(() => sessionTypeState.value === 'driving')

// New session form
type TransferEndMode = 'location' | 'truck'

const buildNewSessionDefaults = () => ({
  saved_move_id: null as number | null,
  session_date: '',
  origin_location_id: null as string | null,
  destination_location_id: null as string | null,
  notes: '',
  session_name: '',
  session_type: 'loading' as 'loading' | 'driving' | 'unloading' | 'transfer',
  start_location_id: null as string | null,
  start_collection_id: null as number | null,
  end_mode: 'location' as TransferEndMode,
  end_location_id: null as string | null,
  end_collection_id: null as number | null,
  end_zone_index: 0,
  truck_size_hint: normalizeTruckSize(props.recommendedTruckSize) || '',
  truck_mode: 'new' as 'new' | 'existing',  // New: choose to create new truck or use existing
  existing_truck_id: null as number | null,   // New: selected existing truck ID
  start_waypoint_id: null as number | null,   // For driving sessions
  end_waypoint_id: null as number | null      // For driving sessions
})

const newSession = ref(buildNewSessionDefaults())

const applySessionTypeDefaults = () => {
  if (isLoadingSession.value) {
    if (originLocationId.value) {
      newSession.value.start_location_id = originLocationId.value
    }
    newSession.value.end_mode = 'truck'
    if (!newSession.value.truck_mode) {
      newSession.value.truck_mode = 'new'
    }
    newSession.value.end_location_id = null
    newSession.value.end_collection_id = null
  } else if (isUnloadingSession.value) {
    newSession.value.end_mode = 'location'
    if (destinationLocationId.value) {
      newSession.value.end_location_id = destinationLocationId.value
    }
  } else if (isTransferSession.value) {
    newSession.value.end_mode = 'truck'
  }
}

const enforceStartLocationForType = () => {
  if (isLoadingSession.value && originLocationId.value) {
    newSession.value.start_location_id = originLocationId.value
    return
  }
  const options = startOptionsForType.value
  if (!options.length) {
    newSession.value.start_location_id = null
    return
  }
  const current = newSession.value.start_location_id ? String(newSession.value.start_location_id) : null
  const hasCurrent = current ? options.some(option => String(option.value) === current) : false
  if (!hasCurrent) {
    newSession.value.start_location_id = options[0].value
  }
}

// Drag and drop state
const draggedItem = ref<any | null>(null)
const draggedType = ref<'container' | 'item' | null>(null)
const dragOverZone = ref<number | null>(null)
const isSmartLoading = ref(false)

const truckZoneOrder = ['Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone E', 'Zone F']
const truckSizeOptionList = [
  { label: 'Cargo Van / Sprinter', value: 'van' },
  { label: '10 ft Truck', value: '10ft' },
  { label: '15 ft Truck', value: '15ft' },
  { label: '17 ft Truck', value: '17ft' },
  { label: '20 ft Truck', value: '20ft' },
  { label: '26 ft Truck', value: '26ft' }
]
const truckZoneCountMap: Record<string, number> = {
  van: 2,
  '10ft': 2,
  '12ft': 2,
  '15ft': 3,
  '17ft': 3,
  '20ft': 4,
  '22ft': 4,
  '26ft': 5
}

const currentTruckSizeHint = computed(() => newSession.value.truck_size_hint || truckSize.value || normalizeTruckSize(props.recommendedTruckSize))
const currentTruckZoneCount = computed(() => {
  const normalized = currentTruckSizeHint.value || ''
  return truckZoneCountMap[normalized] || 3
})

const truckZoneOptions = computed(() => {
  return truckZoneOrder.slice(0, currentTruckZoneCount.value).map((label, index) => ({
    label: `Truck ${label}`,
    value: index
  }))
})

type StartOption = { label: string, value: string, sourceType: string, locationType?: string | null }
const eligibleStartOptions = ref<StartOption[]>([])
const startOptionsLoading = ref(false)

// Existing trucks for reuse
interface ExistingTruck {
  id: number
  name: string
  truck_identifier: string | null
  truck_size: string | null
  zone_count: number
}
const existingTrucks = ref<ExistingTruck[]>([])
const existingTrucksLoading = ref(false)

// Waypoints for driving sessions
interface Waypoint {
  id: number
  city: string
  state: string
  sequence_order: number
}
const waypoints = ref<Waypoint[]>([])
const waypointsLoading = ref(false)

const existingTruckOptions = computed(() => {
  return existingTrucks.value.map(truck => ({
    label: truck.truck_identifier || truck.name,
    value: truck.id,
    size: truck.truck_size,
    zones: truck.zone_count
  }))
})

const waypointOptions = computed(() => {
  return waypoints.value.map(wp => ({
    label: `${wp.city}${wp.state ? `, ${wp.state}` : ''}`,
    value: wp.id,
    sequence: wp.sequence_order
  }))
})

const sessionTypeOptions = [
  { label: 'Loading', value: 'loading', icon: 'upload', description: 'Load items from the move origin into a truck' },
  { label: 'Unloading', value: 'unloading', icon: 'download', description: 'Unload a truck into a destination/dropoff location' },
  { label: 'Transfer', value: 'transfer', icon: 'swap_horiz', description: 'Move inventory between trucks' },
  { label: 'Driving', value: 'driving', icon: 'local_shipping', description: 'Track drive time between waypoints' }
]

const fetchWaypoints = async () => {
  if (!props.currentSavedMoveId) {
    waypoints.value = []
    return
  }
  waypointsLoading.value = true
  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }
    const response = await axios.get(`${core_url}/api/waypoints/${props.currentSavedMoveId}`, { headers })
    waypoints.value = response.data || []
  } catch (error) {
    console.error('Failed to fetch waypoints:', error)
    waypoints.value = []
  } finally {
    waypointsLoading.value = false
  }
}

const fetchExistingTrucks = async () => {
  if (!props.currentSavedMoveId) return
  existingTrucksLoading.value = true
  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }
    const response = await axios.get(`${core_url}/api/move-day/moves/${props.currentSavedMoveId}/trucks`, { headers })
    existingTrucks.value = response.data || []
  } catch (error) {
    console.error('Failed to fetch existing trucks:', error)
    existingTrucks.value = []
  } finally {
    existingTrucksLoading.value = false
  }
}

// Note: savedMoves now comes from parent component (Move Planning)

// Scan form
const scanForm = ref({
  scan_target: 'container' as 'container' | 'item', // New field to select what to scan
  container_id: null as number | null,
  item_id: null as number | null, // New field for loose items
  scan_type: 'loaded' as 'loaded' | 'unloaded' | 'arrived_at_room' | 'unpacked',
  destination_room: '',
  notes: ''
})

// Damage form
const damageForm = ref({
  container_id: null as number | null,
  item_id: null as number | null,
  severity: 'minor' as 'minor' | 'moderate' | 'severe',
  description: ''
})

// Crew form
const crewForm = ref({
  name: '',
  role: '',
  phone: '',
  email: '',
  notes: ''
})

// Computed
const locationOptions = computed(() => {
  return locations.value.map(l => ({
    label: l.label,
    value: String(l.value),
    description: l.address
  }))
})

const collectionOptions = computed(() => {
  return collections.value.map(col => ({
    label: col.label,
    value: Number(col.value),
    location_id: Number(col.location)
  }))
})

const collectionOptionsByLocation = computed(() => {
  const map: Record<number, { label: string, value: number }[]> = {}
  collectionOptions.value.forEach(col => {
    if (!map[col.location_id]) {
      map[col.location_id] = []
    }
    map[col.location_id].push({ label: col.label, value: col.value })
  })
  return map
})

const currentMoveRecord = computed(() => {
  if (!props.currentSavedMoveId || !props.savedMoves) return null
  return props.savedMoves.find((m: any) => Number(m.id) === Number(props.currentSavedMoveId)) || null
})

const plannedOriginLocation = computed(() => {
  const originId = props.originLocation || currentMoveRecord.value?.origin_location_id
  if (!originId) return null
  return locations.value.find(l => String(l.value) === String(originId)) || null
})

const plannedDestinationLocation = computed(() => {
  const destId = props.destinationLocation || currentMoveRecord.value?.destination_location_id
  if (!destId) return null
  return locations.value.find(l => String(l.value) === String(destId)) || null
})

const originLocationId = computed(() => (plannedOriginLocation.value ? String(plannedOriginLocation.value.value) : null))
const destinationLocationId = computed(() => (plannedDestinationLocation.value ? String(plannedDestinationLocation.value.value) : null))

const endModeOptions = computed(() => [
  { label: 'Specific location', value: 'location' },
  { label: 'Truck', value: 'truck' }
])

const startOptionsForType = computed(() => {
  if (isLoadingSession.value) {
    return eligibleStartOptions.value.filter(option => option.sourceType === 'origin')
  }
  if (isUnloadingSession.value || isTransferSession.value) {
    return eligibleStartOptions.value.filter(option => option.sourceType === 'truck')
  }
  return eligibleStartOptions.value
})

const forceTruckDestination = computed(() => isLoadingSession.value || isTransferSession.value)
const forceLocationDestination = computed(() => isUnloadingSession.value)
const showEndModeToggle = computed(() => !forceTruckDestination.value && !forceLocationDestination.value)

const startSelectLabel = computed(() => {
  if (isLoadingSession.value) {
    return 'Transfer From (Move Origin)'
  }
  if (isUnloadingSession.value || isTransferSession.value) {
    return 'Transfer From Truck'
  }
  return 'Transfer From'
})

const startSelectHint = computed(() => {
  if (isLoadingSession.value) {
    return 'Loading sessions always begin at the move origin.'
  }
  if (isUnloadingSession.value) {
    return 'Choose the truck you are unloading.'
  }
  if (isTransferSession.value) {
    return 'Choose the truck you are transferring inventory from.'
  }
  return 'Start at the origin or the destination of a completed session.'
})

watch(() => newSession.value.session_type, () => {
  applySessionTypeDefaults()
  enforceStartLocationForType()
}, { immediate: true })

watch(startOptionsForType, () => {
  enforceStartLocationForType()
}, { immediate: true })

watch(originLocationId, () => {
  if (isLoadingSession.value) {
    applySessionTypeDefaults()
    enforceStartLocationForType()
  }
})

watch(destinationLocationId, () => {
  if (isUnloadingSession.value) {
    applySessionTypeDefaults()
  }
})

const startCollectionChoices = computed(() => {
  if (!newSession.value.start_location_id) return []
  return collectionOptionsByLocation.value[Number(newSession.value.start_location_id)] || []
})

const endCollectionChoices = computed(() => {
  if (!newSession.value.end_location_id) return []
  return collectionOptionsByLocation.value[Number(newSession.value.end_location_id)] || []
})

const getLocationLabel = (locationId: string | number | null) => {
  if (!locationId) return ''
  const match = locationOptions.value.find(option => String(option.value) === String(locationId))
  return match?.label || `Location ${locationId}`
}

const containerOptions = computed(() => {
  return containers.value.map(c => ({
    label: `${c.label} ${c.box_number ? `(#${c.box_number})` : ''}`,
    value: c.value
  }))
})

const looseItemOptions = computed(() => {
  return looseItems.value.map(item => ({
    label: `${item.name} ${item.room ? `(${item.room})` : ''}`,
    value: item.id
  }))
})

const hasLoadedMove = computed(() => !!props.currentSavedMoveId)

const sessionStage = computed(() => activeSession.value?.stage || 'planning')
const allowPlanningEdits = computed(() => sessionStage.value === 'planning')
const canScan = computed(() => sessionStage.value !== 'planning')
const stageChip = computed(() => {
  switch (sessionStage.value) {
    case 'action':
      return { color: 'primary', label: 'Action Stage' }
    case 'complete':
      return { color: 'positive', label: 'Complete' }
    default:
      return { color: 'grey-6', label: 'Planning Stage' }
  }
})

const savedMoveOptions = computed(() => {
  if (!props.savedMoves) return []
  return props.savedMoves.map((m: any) => ({
    label: m.move_name || `${m.origin_location_name} → ${m.destination_location_name}`,
    value: m.id
  }))
})

const progressPercentage = computed(() => {
  if (progressStats.value.total_containers === 0) return 0
  return Math.round((progressStats.value.boxes_loaded / progressStats.value.total_containers) * 100)
})

// Get current move info for display
const currentMoveName = computed(() => {
  if (!props.currentSavedMoveId || !props.savedMoves) return null
  const move = props.savedMoves.find((m: any) => m.id === props.currentSavedMoveId)
  return move?.move_name || null
})

const currentMoveLocations = computed(() => {
  // originLocation and destinationLocation are string IDs that match location.value
  const origin = locations.value.find(l => String(l.value) === String(props.originLocation))
  const destination = locations.value.find(l => String(l.value) === String(props.destinationLocation))

  if (origin && destination) {
    return `${origin.label} → ${destination.label}`
  }
  return null
})

const unloadProgressPercentage = computed(() => {
  if (progressStats.value.boxes_loaded === 0) return 0
  return Math.round((progressStats.value.boxes_unloaded / progressStats.value.boxes_loaded) * 100)
})

// Loading zone computed properties
const unassignedContainers = computed(() => {
  if (!loadingPlan.value) return []
  return loadingPlan.value.containers?.filter((c: any) => !c.loading_zone) || []
})

const unassignedItems = computed(() => {
  if (!loadingPlan.value) return []
  return loadingPlan.value.loose_items?.filter((i: any) => !i.loading_zone) || []
})

const containersByZone = computed(() => {
  if (!loadingPlan.value) return {}
  const zones: Record<number, any[]> = {}
  loadingPlan.value.containers?.forEach((c: any) => {
    if (c.loading_zone) {
      if (!zones[c.loading_zone]) zones[c.loading_zone] = []
      zones[c.loading_zone].push(c)
    }
  })
  return zones
})

const itemsByZone = computed(() => {
  if (!loadingPlan.value) return {}
  const zones: Record<number, any[]> = {}
  loadingPlan.value.loose_items?.forEach((i: any) => {
    if (i.loading_zone) {
      if (!zones[i.loading_zone]) zones[i.loading_zone] = []
      zones[i.loading_zone].push(i)
    }
  })
  return zones
})

// Methods
const loadMoveSessions = async () => {
  if (!props.user || !props.currentSavedMoveId) {
    console.log('[MoveDay] loadMoveSessions skipped - missing user or saved move id')
    moveSessions.value = []
    activeSession.value = null
    sessionDetails.value = null
    return
  }

  loadingSessions.value = true
  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    const response = await axios.get(`${core_url}/api/move-day/sessions`, {
      headers
    })

    console.log('[MoveDay] move-day/sessions response:', response.data)

    const filtered = (response.data || []).filter((session: any) => String(session.saved_move_id) === String(props.currentSavedMoveId))
    console.log('[MoveDay] filtered sessions for saved move', props.currentSavedMoveId, filtered)
    moveSessions.value = filtered

    if (props.currentSavedMoveId) {
      await loadEligibleStartOptions()
    }

    // If there's an active session, select it
    const activeSessionData = moveSessions.value.find(s => s.saved_move_id === props.currentSavedMoveId && (s.status === 'in_progress' || s.status === 'loading' || s.status === 'unloading'))
    console.log('[MoveDay] auto-select candidate', activeSessionData)
    if (activeSessionData) {
      await selectSession(activeSessionData)
    }
  } catch (error) {
    console.error('Error loading move sessions:', error)
    $q.notify({ type: 'negative', message: 'Failed to load move sessions' })
  } finally {
    loadingSessions.value = false
  }
}

const selectSession = async (session: any) => {
  activeSession.value = session
  // Only load details for loading/unloading sessions
  // Driving sessions just show basic info (status)
  if (session.session_type !== 'driving') {
    await loadSessionDetails(session.id)
    await loadProgressStats(session.id)
  }
}

// Helper function to get icon for session type
const getSessionIcon = (sessionType: string) => {
  switch (sessionType) {
    case 'loading':
      return 'inventory_2' // Box icon
    case 'unloading':
      return 'unarchive' // Box open icon
    case 'driving':
      return 'local_shipping' // Truck icon
    case 'transfer':
      return 'swap_horiz' // Transfer icon
    default:
      return 'event' // Default calendar icon
  }
}

// Helper function to get color class for session type
const getSessionColorClass = (sessionType: string) => {
  switch (sessionType) {
    case 'loading':
      return 'session-type-loading'
    case 'unloading':
      return 'session-type-unloading'
    case 'driving':
      return 'session-type-driving'
    case 'transfer':
      return 'session-type-transfer'
    default:
      return ''
  }
}

const loadSessionDetails = async (sessionId: number) => {
  if (!props.user) return

  loadingDetails.value = true
  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    const response = await axios.get(`${core_url}/api/move-day/sessions/${sessionId}`, {
      // No params needed - uses auth token
      headers
    })

    sessionDetails.value = response.data

    // Populate truck size if available
    if (response.data.truck_size) {
      truckSize.value = normalizeTruckSize(response.data.truck_size)
    }
  } catch (error) {
    console.error('Error loading session details:', error)
    $q.notify({ type: 'negative', message: 'Failed to load session details' })
  } finally {
    loadingDetails.value = false
  }
}

const loadProgressStats = async (sessionId: number) => {
  if (!props.user) return

  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    const response = await axios.get(`${core_url}/api/move-day/sessions/${sessionId}/progress`, {
      // No params needed - uses auth token
      headers
    })

    progressStats.value = response.data
  } catch (error) {
    console.error('Error loading progress stats:', error)
  }
}

const loadLooseItems = async () => {
  if (!props.user) return

  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    const response = await axios.get(`${core_url}/api/move-day/loose-items`, { headers })
    looseItems.value = response.data
  } catch (error) {
    console.error('Error loading loose items:', error)
  }
}

const loadEligibleStartOptions = async () => {
  if (!props.user || !props.currentSavedMoveId) {
    eligibleStartOptions.value = []
    return
  }

  startOptionsLoading.value = true
  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    const response = await axios.get(`${core_url}/api/saved-moves/${props.currentSavedMoveId}/eligible-sources`, {
      headers
    })

    const moveInfo = response.data.move || {}
    moveWindow.value.start = normalizeSessionDate(moveInfo.desired_start_date) || moveWindow.value.start
    moveWindow.value.end = normalizeSessionDate(moveInfo.desired_end_date) || moveWindow.value.end || moveWindow.value.start

    const originFallbackId = plannedOriginLocation.value?.value
      ?? (currentMoveRecord.value?.origin_location_id ? Number(currentMoveRecord.value.origin_location_id) : null)

    const baseOptions: StartOption[] = []
    if (originFallbackId) {
      const originLabel = plannedOriginLocation.value?.label
        || locations.value.find(l => Number(l.value) === Number(originFallbackId))?.label
        || 'Move Origin'
      baseOptions.push({
        label: originLabel,
        value: String(originFallbackId),
        sourceType: 'origin',
        locationType: plannedOriginLocation.value?.location_type || null
      })
    }

    const apiOptions = (response.data.sources || []).map((source: any) => {
      const normalizedSourceType = source.source_type === 'truck'
        ? 'truck'
        : source.source_type === 'origin'
          ? 'origin'
          : (source.source_type || 'session')
      return {
        label: source.label || (normalizedSourceType === 'truck' ? 'Truck' : 'Session Destination'),
        value: String(source.location_id),
        sourceType: normalizedSourceType,
        locationType: source.location_type || null
      }
    }).filter((opt: StartOption) => opt.value && !baseOptions.some(b => b.value === opt.value))

    eligibleStartOptions.value = [...baseOptions, ...apiOptions]

    if (!newSession.value.start_location_id && eligibleStartOptions.value.length > 0) {
      newSession.value.start_location_id = eligibleStartOptions.value[0].value
    }
    enforceStartLocationForType()
  } catch (error) {
    console.error('Error loading eligible start locations:', error)
    const fallbackId = plannedOriginLocation.value?.value
      ?? (currentMoveRecord.value?.origin_location_id ? Number(currentMoveRecord.value.origin_location_id) : null)
    if (fallbackId) {
      const fallbackLabel = plannedOriginLocation.value?.label
        || locations.value.find(l => Number(l.value) === Number(fallbackId))?.label
        || 'Move Origin'
      eligibleStartOptions.value = [{
        label: fallbackLabel,
        value: String(fallbackId),
        sourceType: 'origin',
        locationType: plannedOriginLocation.value?.location_type || null
      }]
      if (!newSession.value.start_location_id) {
        newSession.value.start_location_id = Number.isFinite(fallbackId) ? String(fallbackId) : null
      }
    } else {
      eligibleStartOptions.value = []
    }
    enforceStartLocationForType()
  } finally {
    startOptionsLoading.value = false
  }
}

const setTruckSize = async (size: string) => {
  if (!activeSession.value) return

  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    await axios.put(`${core_url}/api/move-day/sessions/${activeSession.value.id}/truck`, {
      truck_size: size
    }, { headers })

    truckSize.value = size
    $q.notify({ type: 'positive', message: `Truck size set to ${size}` })
    await loadSessionDetails(activeSession.value.id)
  } catch (error) {
    console.error('Error setting truck size:', error)
    $q.notify({ type: 'negative', message: 'Failed to set truck size' })
  }
}

const openLoadingPlan = async () => {
  if (!activeSession.value) return

  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    console.log('Fetching loading plan for session:', activeSession.value.id)
    const response = await axios.get(`${core_url}/api/move-day/sessions/${activeSession.value.id}/loading-plan`, { headers })
    console.log('Loading plan response:', response.data)
    console.log('Containers:', response.data.containers)
    console.log('Loose items:', response.data.loose_items)
    loadingPlan.value = response.data
    showLoadingPlanDialog.value = true
  } catch (error) {
    console.error('Error loading loading plan:', error)
    $q.notify({ type: 'negative', message: 'Failed to load loading plan' })
  }
}

const loadLoadingPlan = async () => {
  if (!activeSession.value) return

  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    const response = await axios.get(`${core_url}/api/move-day/sessions/${activeSession.value.id}/loading-plan`, { headers })
    loadingPlan.value = response.data
  } catch (error) {
    console.error('Error loading loading plan:', error)
    $q.notify({ type: 'negative', message: 'Failed to load loading plan' })
  }
}

const assignZones = async () => {
  if (!activeSession.value) return

  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    await axios.post(`${core_url}/api/move-day/sessions/${activeSession.value.id}/assign-zones`, {}, { headers })

    $q.notify({ type: 'positive', message: 'Loading zones assigned successfully' })
    await loadLoadingPlan()
  } catch (error) {
    console.error('Error assigning zones:', error)
    $q.notify({ type: 'negative', message: 'Failed to assign zones' })
  }
}

const createSession = async () => {
  if (!props.user) return

  if (!props.currentSavedMoveId && !newSession.value.saved_move_id) {
    $q.notify({ type: 'warning', message: 'Save your move plan before creating sessions.' })
    return
  }

  if (!newSession.value.session_name || !newSession.value.session_name.trim()) {
    $q.notify({ type: 'warning', message: 'Session name is required.' })
    return
  }

  if (!newSession.value.session_date) {
    $q.notify({ type: 'warning', message: 'Select a session date within your move window.' })
    return
  }

  if (!newSession.value.start_location_id) {
    $q.notify({ type: 'warning', message: 'Choose a starting location for this session.' })
    return
  }

  if (newSession.value.end_mode === 'location' && !newSession.value.end_location_id) {
    $q.notify({ type: 'warning', message: 'Choose where this session will finish.' })
    return
  }

  if (newSession.value.end_mode === 'truck') {
    // If using existing truck, make sure one is selected
    if (newSession.value.truck_mode === 'existing' && existingTruckOptions.value.length > 0) {
      if (!newSession.value.existing_truck_id) {
        $q.notify({ type: 'warning', message: 'Select an existing truck for this session.' })
        return
      }
    } else if (truckZoneOptions.value.length === 0) {
      // Creating new truck - need truck size
      $q.notify({ type: 'warning', message: 'Select a truck size to create zones for this session.' })
      return
    }
  }

  if (
    sessionWindowStart.value &&
    sessionWindowEnd.value &&
    (newSession.value.session_date < sessionWindowStart.value || newSession.value.session_date > sessionWindowEnd.value)
  ) {
    $q.notify({ type: 'warning', message: 'Session date must be within your desired move window.' })
    return
  }

  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    const originId = newSession.value.origin_location_id
      ? Number(newSession.value.origin_location_id)
      : (props.originLocation ? Number(props.originLocation) : null)
    const destId = newSession.value.destination_location_id
      ? Number(newSession.value.destination_location_id)
      : (props.destinationLocation ? Number(props.destinationLocation) : null)

    const payload = {
      owner: props.user,
      saved_move_id: props.currentSavedMoveId || newSession.value.saved_move_id,
      session_date: newSession.value.session_date,
      origin_location_id: originId,
      destination_location_id: destId,
      notes: newSession.value.notes,
      session_name: newSession.value.session_name || null,
      session_type: newSession.value.session_type,
      start_location_id: newSession.value.start_location_id ? Number(newSession.value.start_location_id) : null,
      start_collection_id: newSession.value.start_collection_id,
      end_mode: newSession.value.end_mode,
      end_location_id: newSession.value.end_mode === 'location' && newSession.value.end_location_id
        ? Number(newSession.value.end_location_id)
        : null,
      end_collection_id: newSession.value.end_mode === 'location' ? newSession.value.end_collection_id : null,
      end_truck_zone_index: newSession.value.end_mode === 'truck' ? newSession.value.end_zone_index : null,
      truck_size_hint: newSession.value.end_mode === 'truck' ? currentTruckSizeHint.value : null,
      existing_truck_id: newSession.value.end_mode === 'truck' && newSession.value.truck_mode === 'existing' && newSession.value.existing_truck_id
        ? Number(newSession.value.existing_truck_id)
        : null,
      start_waypoint_id: newSession.value.session_type === 'driving' && newSession.value.start_waypoint_id
        ? Number(newSession.value.start_waypoint_id)
        : null,
      end_waypoint_id: newSession.value.session_type === 'driving' && newSession.value.end_waypoint_id
        ? Number(newSession.value.end_waypoint_id)
        : null
    }

    const response = await axios.post(`${core_url}/api/move-day/sessions`, payload, { headers })
    console.log('[MoveDay] createSession response:', response.data)

    $q.notify({ type: 'positive', message: 'Move session created' })
    showCreateSession.value = false
    await loadMoveSessions()

    // Select the newly created session
    if (response.data && response.data.id) {
      console.log('[MoveDay] Created session ID:', response.data.id)
      console.log('[MoveDay] All sessions after creation:', moveSessions.value)
      const createdSession = moveSessions.value.find(s => s.id === response.data.id)
      console.log('[MoveDay] Found session in list?', createdSession)
      if (createdSession) {
        await selectSession(createdSession)
      } else {
        console.error('[MoveDay] Could not find created session in list! Attempting to refetch...')
        await loadMoveSessions()
        const retrySession = moveSessions.value.find(s => s.id === response.data.id)
        if (retrySession) {
          console.log('[MoveDay] Found session after refetch:', retrySession)
          await selectSession(retrySession)
        } else {
          console.error('[MoveDay] Session still not found after refetch.')
        }
      }
    }

    // Reset form
    newSession.value = buildNewSessionDefaults()
  } catch (error) {
    console.error('Error creating session:', error)
    $q.notify({ type: 'negative', message: 'Failed to create session' })
  }
}

const deleteSession = async (sessionId: number) => {
  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    await axios.delete(`${core_url}/api/move-day/sessions/${sessionId}`, { headers })

    $q.notify({ type: 'positive', message: 'Move session deleted' })

    // Clear active session if it was deleted
    if (activeSession.value && activeSession.value.id === sessionId) {
      activeSession.value = null
      sessionDetails.value = null
    }

    // Reload sessions
    await loadMoveSessions()
  } catch (error) {
    console.error('Error deleting session:', error)
    $q.notify({ type: 'negative', message: 'Failed to delete session' })
  }
}

const confirmDeleteSession = () => {
  if (!activeSession.value) return

  $q.dialog({
    title: 'Confirm Delete',
    message: `Are you sure you want to delete the session "${activeSession.value.session_name || 'this session'}"? This cannot be undone.`,
    cancel: true,
    persistent: true
  }).onOk(() => {
    deleteSession(activeSession.value.id)
  })
}

const updateSessionStatus = async (status: string) => {
  if (!activeSession.value || !props.user) return

  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    await axios.put(`${core_url}/api/move-day/sessions/${activeSession.value.id}/status`, {
      status,
      user: props.user
    }, { headers })

    $q.notify({ type: 'positive', message: `Status updated to ${status}` })
    await loadMoveSessions()
    await loadSessionDetails(activeSession.value.id)
  } catch (error) {
    console.error('Error updating status:', error)
    $q.notify({ type: 'negative', message: 'Failed to update status' })
  }
}

const updateSessionDate = async (sessionId: number, newDate: string) => {
  if (!props.user) return

  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    await axios.put(`${core_url}/api/move-day/sessions/${sessionId}/date`, {
      session_date: newDate
    }, { headers })

    $q.notify({ type: 'positive', message: 'Session date updated' })
    await loadMoveSessions()
    // If this is the active session, reload its details
    if (activeSession.value?.id === sessionId) {
      await loadSessionDetails(sessionId)
    }
  } catch (error: any) {
    console.error('Error updating session date:', error)
    const errorMessage = error.response?.data?.error || 'Failed to update session date'
    $q.notify({ type: 'negative', message: errorMessage })
  }
}

const formatSessionDate = (dateValue: string | null | undefined): string => {
  if (!dateValue) return ''
  try {
    const date = new Date(dateValue)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return ''
  }
}

const recordScan = async () => {
  if (!activeSession.value) return

  // Validate that either container or item is selected
  if (scanForm.value.scan_target === 'container' && !scanForm.value.container_id) return
  if (scanForm.value.scan_target === 'item' && !scanForm.value.item_id) return

  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    // Use different endpoints for containers vs items
    const endpoint = scanForm.value.scan_target === 'container'
      ? `${core_url}/api/move-day/scans`
      : `${core_url}/api/move-day/scans/item`

    // Prepare the payload based on scan target
    const payload = {
      move_session_id: activeSession.value.id,
      scanned_by: props.user,
      scan_type: scanForm.value.scan_type,
      destination_room: scanForm.value.destination_room || null,
      notes: scanForm.value.notes || null,
      ...(scanForm.value.scan_target === 'container'
        ? { container_id: scanForm.value.container_id }
        : { item_id: scanForm.value.item_id })
    }

    await axios.post(endpoint, payload, { headers })

    $q.notify({
      type: 'positive',
      message: scanForm.value.scan_target === 'container' ? 'Box scan recorded' : 'Item scan recorded'
    })
    showScanDialog.value = false
    await loadSessionDetails(activeSession.value.id)
    await loadProgressStats(activeSession.value.id)

    // Reset form
    scanForm.value = {
      scan_target: 'container',
      container_id: null,
      item_id: null,
      scan_type: 'loaded',
      destination_room: '',
      notes: ''
    }
  } catch (error: any) {
    console.error('Error recording scan:', error)
    // Check if error is about item being in a container
    if (error.response?.data?.container_id) {
      $q.notify({
        type: 'negative',
        message: 'This item is in a container. Please scan the container instead.',
        timeout: 5000
      })
    } else {
      $q.notify({ type: 'negative', message: 'Failed to record scan' })
    }
  }
}

const reportDamage = async () => {
  if (!activeSession.value || !damageForm.value.description) return

  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    await axios.post(`${core_url}/api/move-day/damage-reports`, {
      move_session_id: activeSession.value.id,
      reported_by: props.user,
      ...damageForm.value
    }, { headers })

    $q.notify({ type: 'positive', message: 'Damage report submitted' })
    showDamageDialog.value = false
    await loadSessionDetails(activeSession.value.id)
    await loadProgressStats(activeSession.value.id)

    // Reset form
    damageForm.value = {
      container_id: null,
      item_id: null,
      severity: 'minor',
      description: ''
    }
  } catch (error) {
    console.error('Error reporting damage:', error)
    $q.notify({ type: 'negative', message: 'Failed to report damage' })
  }
}

const addCrewMember = async () => {
  if (!activeSession.value || !crewForm.value.name) return

  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    await axios.post(`${core_url}/api/move-day/crew`, {
      move_session_id: activeSession.value.id,
      ...crewForm.value
    }, { headers })

    $q.notify({ type: 'positive', message: 'Crew member added' })
    showCrewDialog.value = false
    await loadSessionDetails(activeSession.value.id)

    // Reset form
    crewForm.value = {
      name: '',
      role: '',
      phone: '',
      email: '',
      notes: ''
    }
  } catch (error) {
    console.error('Error adding crew member:', error)
    $q.notify({ type: 'negative', message: 'Failed to add crew member' })
  }
}

const formatDate = (dateString: string) => {
  if (!dateString) return 'Not set'
  return new Date(dateString).toLocaleDateString()
}

const formatDateTime = (dateString: string) => {
  if (!dateString) return 'Not set'
  return new Date(dateString).toLocaleString()
}


const getSeverityColor = (severity: string) => {
  const colors: Record<string, string> = {
    minor: 'warning',
    moderate: 'orange',
    severe: 'negative'
  }
  return colors[severity] || 'grey'
}

// Drag and drop handlers for loading zones
const handleDragStart = (item: any, type: 'container' | 'item') => {
  if (!allowPlanningEdits.value) return
  draggedItem.value = item
  draggedType.value = type
}

const handleDragOver = (event: DragEvent, zone: number | null) => {
  if (!allowPlanningEdits.value) return
  event.preventDefault()
  dragOverZone.value = zone
}

const handleDragLeave = () => {
  dragOverZone.value = null
}

const handleDrop = async (event: DragEvent, targetZone: number | null) => {
  if (!allowPlanningEdits.value) return
  event.preventDefault()
  dragOverZone.value = null

  if (!draggedItem.value || !draggedType.value || !activeSession.value) return

  try {
    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    // Call appropriate API endpoint based on type
    // Use container_id or item_id directly (not scan_id)
    const endpoint = draggedType.value === 'container'
      ? `${core_url}/api/move-day/sessions/${activeSession.value.id}/containers/${draggedItem.value.id}/zone`
      : `${core_url}/api/move-day/sessions/${activeSession.value.id}/items/${draggedItem.value.id}/zone`

    await axios.put(endpoint, {
      loading_zone: targetZone
    }, { headers })

    // Reload loading plan to reflect changes
    await loadLoadingPlan()
    $q.notify({
      type: 'positive',
      message: targetZone
        ? `Moved to Zone ${targetZone}`
        : 'Removed from loading plan'
    })
  } catch (error) {
    console.error('Error updating zone:', error)
    $q.notify({ type: 'negative', message: 'Failed to update loading zone' })
  } finally {
    draggedItem.value = null
    draggedType.value = null
  }
}

// Smart load algorithm - automatically assign zones based on weight/fragility
const smartLoad = async () => {
  if (!activeSession.value) return

  isSmartLoading.value = true
  try {
    await assignZones()
    $q.notify({
      type: 'positive',
      message: 'Smart transfer plan complete! Items organized by weight and fragility.'
    })
  } catch (error) {
    console.error('Error in smart load:', error)
  } finally {
    isSmartLoading.value = false
  }
}

watch(() => newSession.value.end_mode, (mode) => {
  if (mode === 'truck') {
    newSession.value.end_location_id = null
    newSession.value.end_collection_id = null
  } else {
    newSession.value.end_zone_index = 0
  }
})

watch(() => currentTruckZoneCount.value, () => {
  const limit = truckZoneOptions.value.length
  if (newSession.value.end_zone_index >= limit) {
    newSession.value.end_zone_index = 0
  }
})

watch(() => newSession.value.start_location_id, () => {
  newSession.value.start_collection_id = null
})

watch(() => newSession.value.end_location_id, () => {
  newSession.value.end_collection_id = null
})

watch(() => props.currentSavedMoveId, (newId) => {
  if (newId) {
    loadEligibleStartOptions()
    loadMoveSessions()
  } else {
    eligibleStartOptions.value = []
    moveSessions.value = []
    activeSession.value = null
    sessionDetails.value = null
  }
})

watch(showCreateSession, async (isOpen) => {
  if (isOpen) {
    if (props.currentSavedMoveId) {
      await loadEligibleStartOptions()
      fetchExistingTrucks()  // Load existing trucks for this move
      fetchWaypoints()       // Load waypoints for driving sessions
    }
    const defaults = {
      ...buildNewSessionDefaults(),
      saved_move_id: props.currentSavedMoveId || null,
      session_date: sessionWindowStart.value || '',
      origin_location_id: props.originLocation ? String(props.originLocation) : null,
      destination_location_id: props.destinationLocation ? String(props.destinationLocation) : null,
      start_location_id: eligibleStartOptions.value[0]?.value || (props.originLocation ? String(props.originLocation) : null),
      end_location_id: props.destinationLocation ? String(props.destinationLocation) : null,
      truck_size_hint: normalizeTruckSize(props.recommendedTruckSize) || truckSize.value || ''
    }
    if (!defaults.end_location_id && locationOptions.value.length > 0) {
      defaults.end_location_id = String(locationOptions.value[0].value)
    }
    newSession.value = defaults
  }
})

onMounted(() => {
  loadLooseItems()
  if (props.currentSavedMoveId) {
    loadEligibleStartOptions()
    loadMoveSessions()
  }
  // savedMoves now comes from parent component, no need to load separately
})

// Expose methods and data to parent component
defineExpose({
  moveSessions,
  activeSession,
  showCreateSession,
  selectSession,
  createSession,
  deleteSession
})
</script>

<template>
  <div class="moveday-container">
    <!-- Session Selector (always visible when move is loaded) -->
    <div v-if="props.currentSavedMoveId" class="q-pa-md q-mb-md bg-grey-2 rounded-borders">
      <!-- Breadcrumb Header (only show when session is active) -->
      <div v-if="activeSession" class="q-mb-md q-pa-md bg-grey-2 rounded-borders">
        <div class="row items-center justify-between">
          <div class="col-auto">
            <div class="text-h5">
              {{ currentMoveName || sessionDetails?.session?.move_name || 'Move' }}
              <span class="text-grey-6">/</span>
              {{ activeSession.session_name || 'Session' }}
            </div>
            <q-badge class="q-mt-xs" :color="stageChip.color" text-color="white">
              {{ stageChip.label }}
            </q-badge>
          </div>
          <div class="col-auto row items-center q-gutter-sm">
            <q-select
              v-model="activeSession.status"
              :options="[
                { label: 'Not Started', value: 'not_started' },
                { label: 'In Progress', value: 'in_progress' },
                { label: 'Complete', value: 'complete' }
              ]"
              outlined
              dense
              emit-value
              map-options
              style="min-width: 150px"
              @update:model-value="updateSessionStatus"
            />
            <q-btn
              icon="delete"
              color="negative"
              outline
              round
              dense
              @click="confirmDeleteSession"
            >
              <q-tooltip>Delete Session</q-tooltip>
            </q-btn>
          </div>
        </div>
      </div>

      <!-- Session Selector Pills - Progress Line Design (always visible) -->
      <div class="q-mt-md">
        <div class="text-caption text-grey-7 q-mb-sm">Sessions</div>
        <div class="session-progress-wrapper">
          <div class="session-progress-container">
            <div
              v-for="(session, index) in sortedSessions"
              :key="session.id"
              class="session-progress-item"
            >
              <!-- Session Pill -->
              <div
                class="session-pill"
                :class="[
                  { 'session-pill-active': activeSession?.id === session.id },
                  getSessionColorClass(session.session_type)
                ]"
                @click="selectSession(session)"
              >
                <!-- Icon Circle (for session type) -->
                <div class="session-icon-circle" :class="getSessionColorClass(session.session_type)">
                  <q-icon :name="getSessionIcon(session.session_type)" size="18px" />
                </div>

                <!-- Session Info - Full details when selected -->
                <div v-if="activeSession?.id === session.id" class="session-pill-content">
                  <div class="session-name text-weight-medium">
                    {{ session.session_name || 'Session' }}
                    <span class="session-type-badge text-caption">{{ session.session_type }}</span>
                  </div>
                  <div
                    class="session-date text-caption"
                    style="cursor: pointer"
                    @click.stop
                  >
                    <q-popup-edit
                      v-model="session.session_date"
                      buttons
                      label-set="Save"
                      label-cancel="Cancel"
                      @save="(val) => updateSessionDate(session.id, val)"
                    >
                      <template v-slot="scope">
                        <q-input
                          type="date"
                          v-model="scope.value"
                          dense
                          autofocus
                          @keyup.enter="scope.set"
                        />
                      </template>
                    </q-popup-edit>
                    {{ formatSessionDate(session.session_date || session.move_date) }}
                    <q-icon name="edit" size="12px" class="q-ml-xs" />
                  </div>
                </div>
                <!-- Compact view when not selected - just date -->
                <div v-else class="session-pill-content-compact">
                  <div class="session-date-compact text-caption">
                    {{ formatSessionDate(session.session_date || session.move_date) }}
                  </div>
                </div>
              </div>

              <!-- Connecting Line -->
              <div
                v-if="index < sortedSessions.length - 1"
                class="session-progress-line"
                :class="{ 'session-progress-line-active': activeSession && sortedSessions.findIndex(s => s.id === activeSession.id) > index }"
              ></div>
            </div>

            <!-- Add Session Button -->
            <div class="session-progress-item">
              <div
                v-if="sortedSessions.length > 0"
                class="session-progress-line"
              ></div>
              <div
                class="session-pill session-pill-add"
                @click="showCreateSession = true"
              >
                <div class="session-number-circle session-add-circle">
                  <q-icon name="add" size="20px" />
                </div>
                <div class="session-pill-content">
                  <div class="session-name text-weight-medium">Add Session</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Sub-tabs -->
      <div class="subnav q-mb-md">
        <q-btn-group flat class="pill-tabs">
          <q-btn
            flat
            dense
            no-caps
            :class="{ 'pill-tab-active': moveDayTab === 'overview' }"
            class="pill-tab"
            label="Overview"
            @click="moveDayTab = 'overview'"
          />
          <q-btn
            flat
            dense
            no-caps
            :class="{ 'pill-tab-active': moveDayTab === 'timeline' }"
            class="pill-tab"
            label="Timeline"
            @click="moveDayTab = 'timeline'"
          />
          <q-btn
            flat
            dense
            no-caps
            :class="{ 'pill-tab-active': moveDayTab === 'checklist' }"
            class="pill-tab"
            label="Progress"
            @click="moveDayTab = 'checklist'"
          />
          <q-btn
            flat
            dense
            no-caps
            :class="{ 'pill-tab-active': moveDayTab === 'crew' }"
            class="pill-tab"
            label="Crew"
            @click="moveDayTab = 'crew'"
          />
        </q-btn-group>
      </div>

      <!-- Overview Tab -->
      <div v-if="moveDayTab === 'overview'">
        <div class="row q-col-gutter-md">
          <!-- Progress Cards -->
          <div class="col-12 col-md-4">
            <q-card flat bordered>
              <q-card-section>
                <div class="text-h4 text-primary">{{ progressStats.boxes_loaded }} / {{ progressStats.total_containers }}</div>
                <div class="text-caption text-grey-7">Boxes Loaded</div>
                <q-linear-progress :value="progressPercentage / 100" color="primary" class="q-mt-sm" />
              </q-card-section>
            </q-card>
          </div>
          <div class="col-12 col-md-4">
            <q-card flat bordered>
              <q-card-section>
                <div class="text-h4 text-cyan">{{ progressStats.boxes_unloaded }} / {{ progressStats.boxes_loaded }}</div>
                <div class="text-caption text-grey-7">Boxes Unloaded</div>
                <q-linear-progress :value="unloadProgressPercentage / 100" color="cyan" class="q-mt-sm" />
              </q-card-section>
            </q-card>
          </div>
          <div class="col-12 col-md-4">
            <q-card flat bordered>
              <q-card-section>
                <div class="text-h4 text-orange">{{ progressStats.damage_reports_count }}</div>
                <div class="text-caption text-grey-7">Damage Reports</div>
              </q-card-section>
            </q-card>
          </div>
        </div>

        <!-- Truck Configuration -->
        <div class="q-mt-md">
          <q-card flat bordered>
            <q-card-section>
            <div class="text-h6 q-mb-md">Truck & Transfer Configuration</div>
              <div class="row q-col-gutter-md">
                <div class="col-12 col-md-6">
                  <q-select
                    v-model="truckSize"
                    :options="['van', '10ft', '15ft', '17ft', '20ft', '26ft']"
                    label="Truck Size"
                    outlined
                    dense
                    @update:model-value="setTruckSize"
                  >
                    <template v-slot:hint>
                      {{ activeSession?.num_zones ? `${activeSession.num_zones} loading zones` : 'Select truck size' }}
                    </template>
                  </q-select>
                </div>
                <div class="col-12 col-md-6">
                  <q-btn
                    unelevated
                    color="primary"
                    icon="view_in_ar"
                    label="Assign Transfer Zones"
                    class="full-width"
                    :disable="!truckSize || !allowPlanningEdits"
                    @click="openLoadingPlan"
                  />
                </div>
              </div>
            </q-card-section>
          </q-card>
        </div>

        <!-- Quick Actions -->
        <div class="q-mt-md">
          <div class="text-h6 q-mb-md">Quick Actions</div>
          <div class="row q-col-gutter-sm">
            <div class="col-12 col-md-3">
              <q-btn
                unelevated
                color="primary"
                icon="qr_code_scanner"
                label="Scan Box"
                class="full-width"
                @click="showScanDialog = true"
                :disable="!canScan"
              />
            </div>
            <div class="col-12 col-md-3">
              <q-btn
                unelevated
                color="warning"
                icon="report_problem"
                label="Report Damage"
                class="full-width"
                @click="showDamageDialog = true"
                :disable="!canScan"
              />
            </div>
            <div class="col-12 col-md-3">
              <q-btn
                unelevated
                color="secondary"
                icon="group_add"
                label="Add Crew"
                class="full-width"
                @click="showCrewDialog = true"
              />
            </div>
            <div class="col-12 col-md-3">
              <q-btn
                unelevated
                color="grey-7"
                icon="print"
                label="Print Labels"
                class="full-width"
                disable
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Timeline Tab -->
      <div v-else-if="moveDayTab === 'timeline'">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-h6 q-mb-md">Activity Timeline</div>
            <q-timeline color="primary" v-if="sessionDetails?.timeline?.length > 0">
              <q-timeline-entry
                v-for="event in sessionDetails.timeline"
                :key="event.id"
                :title="event.description"
                :subtitle="formatDateTime(event.created_at)"
                :icon="event.event_type.includes('damage') ? 'report_problem' : 'check_circle'"
              >
                <div v-if="event.created_by">By: {{ event.created_by }}</div>
              </q-timeline-entry>
            </q-timeline>
            <div v-else class="text-center text-grey-6 q-pa-lg">
              No activity yet
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Progress Tab -->
      <div v-else-if="moveDayTab === 'checklist'">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-h6 q-mb-md">Recent Scans</div>
            <q-list v-if="sessionDetails?.scans?.length > 0" separator>
              <q-item v-for="scan in sessionDetails.scans" :key="scan.id">
                <q-item-section avatar>
                  <q-avatar :color="scan.scan_type === 'loaded' ? 'primary' : 'cyan'" text-color="white" icon="inventory_2" />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ scan.container_name }}</q-item-label>
                  <q-item-label caption>{{ scan.scan_type }} - {{ formatDateTime(scan.scanned_at) }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-badge :label="scan.scan_type" />
                </q-item-section>
              </q-item>
            </q-list>
            <div v-else class="text-center text-grey-6 q-pa-lg">
              No scans recorded yet
            </div>
          </q-card-section>
        </q-card>

        <!-- Damage Reports -->
        <q-card flat bordered class="q-mt-md" v-if="sessionDetails?.damage_reports?.length > 0">
          <q-card-section>
            <div class="text-h6 q-mb-md">Damage Reports</div>
            <q-list separator>
              <q-item v-for="report in sessionDetails.damage_reports" :key="report.id">
                <q-item-section>
                  <q-item-label>{{ report.description }}</q-item-label>
                  <q-item-label caption>{{ report.container_name || report.item_name }} - {{ formatDateTime(report.reported_at) }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-badge :color="getSeverityColor(report.severity)" :label="report.severity" />
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </div>

      <!-- Crew Tab -->
      <div v-else-if="moveDayTab === 'crew'">
        <q-card flat bordered>
          <q-card-section>
            <div class="row items-center justify-between q-mb-md">
              <div class="text-h6">Move Crew</div>
              <q-btn color="primary" icon="add" label="Add Member" @click="showCrewDialog = true" unelevated dense />
            </div>
            <q-list v-if="sessionDetails?.crew?.length > 0" separator>
              <q-item v-for="member in sessionDetails.crew" :key="member.id">
                <q-item-section avatar>
                  <q-avatar color="primary" text-color="white" icon="person" />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ member.name }}</q-item-label>
                  <q-item-label caption>{{ member.role || 'Helper' }}</q-item-label>
                  <q-item-label caption v-if="member.phone">{{ member.phone }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
            <div v-else class="text-center text-grey-6 q-pa-lg">
              No crew members added yet
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Create Session Dialog -->
    <q-dialog v-model="showCreateSession">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">New Move Session</div>
          <div v-if="currentMoveName || currentMoveLocations" class="text-caption text-grey-7 q-mt-xs">
            This session will use the move details from the Planning tab
          </div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-banner v-if="!hasLoadedMove" class="bg-orange-1 text-orange-10 q-mb-md" rounded>
            Save your move plan first so sessions stay linked to the right locations and dates.
          </q-banner>

          <div v-if="currentMoveName || currentMoveLocations" class="q-mb-md q-pa-sm bg-blue-1 rounded-borders">
            <div class="text-caption text-grey-7">Auto-populated from:</div>
            <div class="text-subtitle2">{{ currentMoveName || 'Current Move' }}</div>
            <div v-if="currentMoveLocations" class="text-body2">{{ currentMoveLocations }}</div>
            <div class="text-caption">Move window: {{ moveWindowLabel }}</div>
          </div>

          <!-- Session Type Selector -->
          <div class="q-mb-md">
            <div class="text-body2 text-weight-medium q-mb-sm">Session Type</div>
            <q-btn-toggle
              v-model="newSession.session_type"
              :options="sessionTypeOptions"
              spread
              no-caps
              rounded
              unelevated
              toggle-color="primary"
              class="session-type-toggle"
            />
          </div>

          <div class="row q-col-gutter-md q-mb-md">
            <div class="col-12 col-md-6">
              <q-input
                v-model="newSession.session_name"
                label="Session Name"
                placeholder="e.g. Loading Day 1"
                outlined
                dense
                :rules="[val => !!val || 'Session name is required']"
                lazy-rules
              />
            </div>
            <div class="col-12 col-md-6">
              <q-input
                v-model="newSession.session_date"
                type="date"
                label="Session Date"
                outlined
                dense
                :hint="`Within ${moveWindowLabel}`"
                :min="sessionWindowStart || undefined"
                :max="sessionWindowEnd || undefined"
                :rules="[val => !!val || 'Session date is required']"
              >
                <template v-slot:prepend>
                  <q-icon name="event" />
                </template>
              </q-input>
            </div>
          </div>

          <!-- Driving Session - Waypoint Selectors -->
          <div v-if="newSession.session_type === 'driving'" class="transfer-block q-mb-lg">
            <div class="text-body1 text-weight-medium q-mb-sm">
              <q-icon name="local_shipping" class="q-mr-sm" />
              Driving Route
            </div>
            <div class="text-caption text-grey-7 q-mb-md">
              Select the waypoints for this driving segment. Add waypoints in the Move Planning tab first.
            </div>
            <div class="row q-col-gutter-md">
              <div class="col-12 col-md-6">
                <q-select
                  v-model="newSession.start_waypoint_id"
                  :options="waypointOptions"
                  label="Start Waypoint"
                  outlined
                  dense
                  emit-value
                  map-options
                  :loading="waypointsLoading"
                  :disable="waypointOptions.length === 0"
                >
                  <template v-slot:prepend>
                    <q-icon name="trip_origin" color="primary" />
                  </template>
                </q-select>
              </div>
              <div class="col-12 col-md-6">
                <q-select
                  v-model="newSession.end_waypoint_id"
                  :options="waypointOptions"
                  label="End Waypoint"
                  outlined
                  dense
                  emit-value
                  map-options
                  :loading="waypointsLoading"
                  :disable="waypointOptions.length === 0"
                >
                  <template v-slot:prepend>
                    <q-icon name="place" color="positive" />
                  </template>
                </q-select>
              </div>
            </div>
            <q-banner v-if="waypointOptions.length === 0" class="bg-orange-1 text-orange-10 q-mt-md" rounded>
              <q-icon name="info" class="q-mr-sm" />
              No waypoints defined. Add waypoints in the Move Planning tab under "Costs & Route" to create driving sessions.
            </q-banner>
          </div>

          <!-- Non-Driving Sessions - Location Transfer -->
          <div v-if="newSession.session_type !== 'driving'" class="transfer-block q-mb-lg">
            <div class="text-body1 text-weight-medium q-mb-sm">{{ startSelectLabel }}</div>
            <div class="text-caption text-grey-7 q-mb-xs">
              {{ startSelectHint }}
            </div>
            <q-select
              v-model="newSession.start_location_id"
              :options="startOptionsForType"
              label="Start Source"
              outlined
              dense
              emit-value
              map-options
              option-value="value"
              option-label="label"
              :loading="startOptionsLoading"
              :disable="isLoadingSession || startOptionsForType.length === 0"
            />
            <q-banner
              v-if="!startOptionsLoading && startOptionsForType.length === 0"
              class="bg-orange-1 text-orange-10 q-mt-sm"
              rounded
            >
              <q-icon name="info" class="q-mr-sm" />
              Set up a prior session to provide an eligible starting point for this session type.
            </q-banner>
            <q-select
              v-if="startCollectionChoices.length > 0"
              v-model="newSession.start_collection_id"
              :options="startCollectionChoices"
              label="Source Collection (optional)"
              outlined
              dense
              emit-value
              map-options
              option-value="value"
              option-label="label"
              class="q-mt-sm"
            />
          </div>

          <div v-if="newSession.session_type !== 'driving'" class="transfer-block q-mb-lg">
            <div class="text-body1 text-weight-medium q-mb-sm">Transfer To</div>
            <div v-if="showEndModeToggle">
              <q-option-group
                v-model="newSession.end_mode"
                :options="endModeOptions"
                color="primary"
                inline
              />
            </div>
            <div v-else class="text-caption text-grey-7 q-mb-sm">
              <template v-if="forceTruckDestination">
                This session ends in a truck. Choose an existing truck or create a new one.
              </template>
              <template v-else-if="forceLocationDestination">
                This session ends at a specific location or dropoff.
              </template>
            </div>
            <div v-if="newSession.end_mode === 'location'" class="q-mt-md">
              <q-select
                v-model="newSession.end_location_id"
                :options="locationOptions"
                label="Destination Location"
                outlined
                dense
                emit-value
                map-options
                option-value="value"
                option-label="label"
                :display-value="getLocationLabel(newSession.end_location_id)"
                class="q-mb-sm"
              />
              <q-select
                v-if="endCollectionChoices.length > 0"
                v-model="newSession.end_collection_id"
                :options="endCollectionChoices"
                label="Destination Collection (optional)"
                outlined
                dense
                emit-value
                map-options
                option-value="value"
                option-label="label"
              />
            </div>
            <div v-else class="q-mt-md">
              <!-- Truck mode selection: new or existing -->
              <q-option-group
                v-if="existingTruckOptions.length > 0"
                v-model="newSession.truck_mode"
                :options="[
                  { label: 'Create new truck', value: 'new' },
                  { label: 'Use existing truck', value: 'existing' }
                ]"
                color="primary"
                inline
                class="q-mb-md"
              />

              <!-- New truck options -->
              <div v-if="newSession.truck_mode === 'new' || existingTruckOptions.length === 0" class="row q-col-gutter-sm">
                <div class="col-12 col-md-6">
                  <q-select
                    v-model="newSession.truck_size_hint"
                    :options="truckSizeOptionList"
                    label="Truck Size"
                    outlined
                    dense
                    emit-value
                    map-options
                  />
                </div>
                <div class="col-12 col-md-6">
                  <q-banner rounded class="bg-blue-1 text-primary q-pa-sm">
                    <div class="text-body2">Zones auto-created</div>
                    <div class="text-caption text-grey-7">
                      We'll add {{ truckZoneOptions.length }} truck zones (front to rear). You can fine-tune assignments after the session starts.
                    </div>
                  </q-banner>
                </div>
              </div>

              <!-- Existing truck selection -->
              <div v-else>
                <q-select
                  v-model="newSession.existing_truck_id"
                  :options="existingTruckOptions"
                  label="Select Truck"
                  outlined
                  dense
                  emit-value
                  map-options
                  :loading="existingTrucksLoading"
                >
                  <template v-slot:option="scope">
                    <q-item v-bind="scope.itemProps">
                      <q-item-section>
                        <q-item-label>{{ scope.opt.label }}</q-item-label>
                        <q-item-label caption>
                          {{ scope.opt.size || 'Unknown size' }} &bull; {{ scope.opt.zones }} zones
                        </q-item-label>
                      </q-item-section>
                    </q-item>
                  </template>
                </q-select>
                <div class="text-caption text-grey-7 q-mt-sm">
                  Items will be loaded into this truck's existing zones.
                </div>
              </div>

              <div v-if="newSession.truck_mode === 'new' || existingTruckOptions.length === 0" class="text-caption text-grey-7 q-mt-sm">
                We'll create truck zones as collections so your truck can be the next session's start location.
              </div>
            </div>
          </div>

          <q-input v-model="newSession.notes" label="Notes" type="textarea" outlined dense rows="3" />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey" v-close-popup />
          <q-btn unelevated label="Create" color="primary" @click="createSession" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Scan Dialog -->
    <q-dialog v-model="showScanDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">{{ scanForm.scan_target === 'container' ? 'Scan Box' : 'Scan Loose Item' }}</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-option-group
            v-model="scanForm.scan_target"
            :options="[
              { label: 'Box/Container', value: 'container' },
              { label: 'Loose Item', value: 'item' }
            ]"
            color="primary"
            inline
            class="q-mb-md"
          />

          <q-select
            v-if="scanForm.scan_target === 'container'"
            v-model="scanForm.container_id"
            :options="containerOptions"
            label="Select Box"
            outlined
            dense
            emit-value
            map-options
            class="q-mb-md"
          />

          <q-select
            v-if="scanForm.scan_target === 'item'"
            v-model="scanForm.item_id"
            :options="looseItemOptions"
            label="Select Item"
            outlined
            dense
            emit-value
            map-options
            class="q-mb-md"
          />

          <q-select
            v-model="scanForm.scan_type"
            :options="['loaded', 'unloaded', 'arrived_at_room', 'unpacked']"
            label="Scan Type"
            outlined
            dense
            class="q-mb-md"
          />
          <q-input
            v-if="scanForm.scan_type === 'arrived_at_room' || scanForm.scan_type === 'unloaded'"
            v-model="scanForm.destination_room"
            label="Destination Room"
            outlined
            dense
            class="q-mb-md"
          />
          <q-input v-model="scanForm.notes" label="Notes" type="textarea" outlined dense rows="2" />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey" v-close-popup />
          <q-btn unelevated label="Record Scan" color="primary" @click="recordScan" :disable="!canScan" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Damage Dialog -->
    <q-dialog v-model="showDamageDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">Report Damage</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-select
            v-model="damageForm.container_id"
            :options="containerOptions"
            label="Box (optional)"
            outlined
            dense
            emit-value
            map-options
            clearable
            class="q-mb-md"
          />
          <q-select
            v-model="damageForm.severity"
            :options="['minor', 'moderate', 'severe']"
            label="Severity"
            outlined
            dense
            class="q-mb-md"
          />
          <q-input v-model="damageForm.description" label="Description" type="textarea" outlined dense rows="4" />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey" v-close-popup />
          <q-btn unelevated label="Submit Report" color="warning" @click="reportDamage" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Crew Dialog -->
    <q-dialog v-model="showCrewDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">Add Crew Member</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input v-model="crewForm.name" label="Name" outlined dense class="q-mb-md" />
          <q-input v-model="crewForm.role" label="Role" outlined dense class="q-mb-md" />
          <q-input v-model="crewForm.phone" label="Phone" outlined dense class="q-mb-md" />
          <q-input v-model="crewForm.email" label="Email" type="email" outlined dense class="q-mb-md" />
          <q-input v-model="crewForm.notes" label="Notes" type="textarea" outlined dense rows="2" />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey" v-close-popup />
          <q-btn unelevated label="Add Member" color="primary" @click="addCrewMember" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Transfer Plan Dialog -->
    <q-dialog v-model="showLoadingPlanDialog" maximized>
      <q-card>
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Truck Transfer Plan</div>
          <q-space />
            <template v-if="isProPlan">
              <q-btn
                unelevated
                color="primary"
                icon="auto_fix_high"
                label="Smart Transfer"
                :loading="isSmartLoading"
                :disable="!allowPlanningEdits"
                @click="smartLoad"
                class="q-mr-md"
              >
                <q-tooltip>Automatically assign items to zones by weight and fragility</q-tooltip>
              </q-btn>
          </template>
          <template v-else>
            <q-btn
              outline
              color="grey-5"
              text-color="grey-7"
              icon="lock"
              label="Smart Transfer (Pro)"
              class="q-mr-md"
              @click="goToPricing"
            >
              <q-tooltip>Upgrade to Pro to unlock Smart Load</q-tooltip>
            </q-btn>
          </template>
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section v-if="loadingPlan" class="loading-plan-container">
          <div class="text-subtitle2 q-mb-md">
            Truck Size: {{ activeSession?.truck_size }} | Zones: {{ activeSession?.num_zones }}
            <q-badge color="grey" class="q-ml-md">Drag items between zones to organize your transfer</q-badge>
          </div>

          <div class="row q-col-gutter-md">
            <!-- Unassigned Items Column -->
            <div class="col-12 col-md-3">
              <q-card
                flat
                bordered
                class="zone-card"
                :class="{ 'drag-over': dragOverZone === null }"
                @dragover="handleDragOver($event, null)"
                @dragleave="handleDragLeave"
                @drop="handleDrop($event, null)"
              >
                <q-card-section class="bg-grey-3">
                  <div class="text-h6 text-grey-9">
                    <q-icon name="inbox" class="q-mr-sm" />
                    Transfer Staging
                  </div>
                  <div class="text-caption text-grey-7">
                    {{ unassignedContainers.length + unassignedItems.length }} items
                  </div>
                </q-card-section>

                <q-card-section class="zone-items-container">
                  <!-- Unassigned Containers -->
                  <div v-if="unassignedContainers.length > 0" class="q-mb-md">
                    <div class="text-caption text-grey-7 q-mb-xs">Boxes/Containers:</div>
                    <q-chip
                      v-for="container in unassignedContainers"
                      :key="container.id"
                      :draggable="allowPlanningEdits"
                      clickable
                      color="blue-grey-2"
                      text-color="blue-grey-9"
                      icon="inventory_2"
                      class="draggable-item q-mb-xs"
                      @dragstart="handleDragStart(container, 'container')"
                      @dragend="handleDragLeave"
                    >
                      {{ container.container_name }} #{{ container.box_number }}
                      <q-tooltip>{{ container.weight_lbs }} lbs • Drag to assign to zone</q-tooltip>
                    </q-chip>
                  </div>

                  <!-- Unassigned Loose Items -->
                  <div v-if="unassignedItems.length > 0">
                    <div class="text-caption text-grey-7 q-mb-xs">Loose Items:</div>
                    <q-chip
                      v-for="item in unassignedItems"
                      :key="item.id"
                      :draggable="allowPlanningEdits"
                      clickable
                      color="grey-3"
                      text-color="grey-9"
                      :icon="item.fragile ? 'warning' : 'label'"
                      class="draggable-item q-mb-xs"
                      @dragstart="handleDragStart(item, 'item')"
                      @dragend="handleDragLeave"
                    >
                      {{ item.item_name }}
                      <q-tooltip>{{ item.weight_lbs }} lbs{{ item.fragile ? ' • Fragile' : '' }} • Drag to assign to zone</q-tooltip>
                    </q-chip>
                  </div>

                  <div v-if="unassignedContainers.length === 0 && unassignedItems.length === 0" class="text-grey-6 text-center q-pa-md">
                    <q-icon name="check_circle" size="32px" color="positive" />
                    <div class="text-caption q-mt-sm">All items assigned!</div>
                  </div>
                </q-card-section>
              </q-card>
            </div>

            <!-- Zone Columns -->
            <div class="col-12 col-md-9">
              <div class="row q-col-gutter-md">
                <div
                  v-for="zone in activeSession?.num_zones || 3"
                  :key="zone"
                  :class="activeSession?.num_zones === 3 ? 'col-12 col-md-4' : 'col-12 col-md-3'"
                >
                  <q-card
                    flat
                    bordered
                    class="zone-card"
                    :class="{ 'drag-over': dragOverZone === zone }"
                    @dragover="handleDragOver($event, zone)"
                    @dragleave="handleDragLeave"
                    @drop="handleDrop($event, zone)"
                  >
                    <q-card-section
                      :class="{
                        'bg-orange-9 text-white': zone === 1,
                        'bg-blue-9 text-white': zone !== 1 && zone !== activeSession?.num_zones,
                        'bg-green-9 text-white': zone === activeSession?.num_zones
                      }"
                    >
                      <div class="text-h6">
                        <q-icon :name="zone === 1 ? 'fitness_center' : zone === activeSession?.num_zones ? 'bubble_chart' : 'widgets'" class="q-mr-sm" />
                        Zone {{ zone }}
                      </div>
                      <div class="text-caption">
                        {{ zone === 1 ? 'Front (Heavy)' : zone === activeSession?.num_zones ? 'Rear (Light/Fragile)' : 'Middle' }}
                      </div>
                      <div class="text-caption">
                        {{ (containersByZone[zone] || []).length + (itemsByZone[zone] || []).length }} items
                      </div>
                    </q-card-section>

                    <q-card-section class="zone-items-container">
                      <!-- Containers in this zone -->
                      <div v-if="containersByZone[zone]?.length > 0" class="q-mb-md">
                        <div class="text-caption text-grey-7 q-mb-xs">Boxes/Containers:</div>
                        <q-chip
                          v-for="container in containersByZone[zone]"
                          :key="container.id"
                          :draggable="allowPlanningEdits"
                          clickable
                          color="blue-2"
                          text-color="blue-9"
                          icon="inventory_2"
                          class="draggable-item q-mb-xs"
                          @dragstart="handleDragStart(container, 'container')"
                          @dragend="handleDragLeave"
                        >
                          {{ container.container_name }} #{{ container.box_number }}
                          <q-badge v-if="container.load_priority" color="primary" floating>{{ container.load_priority }}</q-badge>
                          <q-tooltip>{{ container.weight_lbs }} lbs • Priority {{ container.load_priority || 'N/A' }} • Drag to move</q-tooltip>
                        </q-chip>
                      </div>

                      <!-- Loose items in this zone -->
                      <div v-if="itemsByZone[zone]?.length > 0">
                        <div class="text-caption text-grey-7 q-mb-xs">Loose Items:</div>
                        <q-chip
                          v-for="item in itemsByZone[zone]"
                          :key="item.id"
                          :draggable="allowPlanningEdits"
                          clickable
                          color="green-2"
                          text-color="green-9"
                          :icon="item.fragile ? 'warning' : 'label'"
                          class="draggable-item q-mb-xs"
                          @dragstart="handleDragStart(item, 'item')"
                          @dragend="handleDragLeave"
                        >
                          {{ item.item_name }}
                          <q-badge v-if="item.load_priority" color="secondary" floating>{{ item.load_priority }}</q-badge>
                          <q-tooltip>{{ item.weight_lbs }} lbs{{ item.fragile ? ' • Fragile' : '' }} • Priority {{ item.load_priority || 'N/A' }} • Drag to move</q-tooltip>
                        </q-chip>
                      </div>

                      <div v-if="!containersByZone[zone]?.length && !itemsByZone[zone]?.length" class="text-grey-6 text-center q-pa-md empty-zone">
                        <q-icon name="move_down" size="24px" />
                        <div class="text-caption q-mt-sm">Drop items here</div>
                      </div>
                    </q-card-section>
                  </q-card>
                </div>
              </div>
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Close" color="primary" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<style scoped>
.moveday-container {
  max-width: 100%;
  background: #F7F8FA;
  min-height: 100vh;
}

.moveday-header {
  background: white;
  border-bottom: 1px solid #E0E0E0;
}

.subnav {
  display: flex;
  justify-content: center;
}

.pill-tabs {
  background: #F0F2F5;
  border-radius: 8px;
  padding: 4px;
  display: inline-flex;
  gap: 4px;
}

.pill-tab {
  border-radius: 6px;
  padding: 8px 20px;
  transition: all 0.2s;
  color: #5F6368;
  font-weight: 500;
}

.pill-tab:hover {
  background: rgba(0, 0, 0, 0.05);
}

.pill-tab-active {
  background: white !important;
  color: #1976D2 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

/* Session Progress Line styles */
.session-progress-wrapper {
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 8px;
}

.session-progress-container {
  display: flex;
  align-items: flex-start;
  padding: 12px;
  min-width: max-content;
}

.session-progress-item {
  display: flex;
  align-items: center;
  position: relative;
}

.session-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 12px;
  background: #F5F5F5;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 140px;
  position: relative;
}

.session-pill:hover {
  background: #E8E8E8;
  transform: translateY(-2px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.session-pill-active {
  background: #E3F2FD;
  box-shadow: 0 2px 8px rgba(25, 118, 210, 0.2);
}

.session-pill-active:hover {
  background: #BBDEFB;
}

.session-icon-circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #9E9E9E;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s ease;
  flex-shrink: 0;
}

.session-pill-active .session-icon-circle {
  box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.2);
}

/* Session Type Colors for Icons */
.session-type-loading .session-icon-circle {
  background: #1976D2; /* Blue for loading */
}

.session-type-unloading .session-icon-circle {
  background: #388E3C; /* Green for unloading */
}

.session-type-driving .session-icon-circle {
  background: #7B1FA2; /* Purple for driving */
}

.session-type-transfer .session-icon-circle {
  background: #F57C00; /* Orange for transfer */
}

/* Session Type Border Colors */
.session-type-loading {
  border-left: 4px solid #1976D2;
}

.session-type-unloading {
  border-left: 4px solid #388E3C;
}

.session-type-driving {
  border-left: 4px solid #7B1FA2;
}

.session-type-transfer {
  border-left: 4px solid #F57C00;
}

/* Session type badge */
.session-type-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.08);
  border-radius: 4px;
  font-size: 11px;
  text-transform: capitalize;
  color: #616161;
}

.session-pill-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.session-pill-content-compact {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.session-date-compact {
  font-size: 11px;
  color: #757575;
  white-space: nowrap;
}

.session-name {
  font-size: 14px;
  white-space: nowrap;
  color: #424242;
  font-weight: 500;
}

.session-pill-active .session-name {
  color: #1976D2;
  font-weight: 600;
}

.session-date {
  font-size: 12px;
  color: #757575;
  display: flex;
  align-items: center;
}

.session-pill-active .session-date {
  color: #1565C0;
}

.session-progress-line {
  width: 40px;
  height: 3px;
  background: #E0E0E0;
  margin: 0 4px;
  align-self: center;
  margin-top: -30px;
  transition: all 0.3s ease;
}

.session-progress-line-active {
  background: #1976D2;
}

/* Add Session Button styles */
.session-pill-add {
  background: #F0F4F8;
  border: 2px dashed #B0BEC5;
}

.session-pill-add:hover {
  background: #E3F2FD;
  border-color: #1976D2;
  transform: translateY(-2px);
}

.session-add-circle {
  background: #B0BEC5;
}

.session-pill-add:hover .session-add-circle {
  background: #1976D2;
}

/* Loading plan drag and drop styles */
.loading-plan-container {
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}

.zone-card {
  min-height: 400px;
  transition: all 0.2s ease;
}

.zone-card.drag-over {
  background-color: #E3F2FD;
  border: 2px dashed #1976D2;
  box-shadow: 0 4px 8px rgba(25, 118, 210, 0.2);
}

.zone-items-container {
  min-height: 300px;
  max-height: 500px;
  overflow-y: auto;
}

.draggable-item {
  cursor: grab;
  transition: all 0.2s ease;
  display: inline-flex !important;
  margin-right: 8px;
}

.draggable-item:active {
  cursor: grabbing;
  opacity: 0.7;
}

.draggable-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
}

.empty-zone {
  opacity: 0.6;
  transition: opacity 0.2s ease;
}

.zone-card.drag-over .empty-zone {
  opacity: 1;
}
</style>
