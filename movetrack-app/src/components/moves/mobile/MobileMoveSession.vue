<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useQuasar } from "quasar";
import { useRoute, useRouter } from "vue-router";
import axios from "axios";
import FooterVue from "../../layout/Footer.vue";
import ReloPrepLogo from "../../brand/ReloPrepLogo.vue";
import MobileNavDrawer from "../../layout/MobileNavDrawer.vue";
import { inventoryStore } from "../../../stores/InventoryStore"
import { BrowserMultiFormatReader } from "@zxing/browser";
import { CircleCheck, FolderOpen, TriangleAlert } from "lucide-vue-next";

const props = defineProps({
  user: { type: String, required: true },
});

const emits = defineEmits<{
  (e: "app:loading", loading: boolean): void;
}>();

const $q = useQuasar();
const router = useRouter();
const route = useRoute();
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3050";
const store = inventoryStore();

// State
const selectedMove = ref<any>(null);
const moves = ref<any[]>([]);
const showLeft = ref(false);
const showMoveDialog = ref(false);
const selectedLocationId = ref<string | number | null>(null);

const selectedSession = ref<any>(null);
const sessions = ref<any[]>([]);
const allSessions = ref<any[]>([]);
const containerZoneMap = ref<Map<string, string>>(new Map());
const itemZoneMap = ref<Map<string, string>>(new Map());

const boxInput = ref("");
const pendingScanEntity = ref<{
  type: "container" | "item";
  id: string;
  label: string;
  collectionId?: string | null;
  zoneLabel?: string | null;
  containerId?: string | null;
} | null>(null);
const scanDisplayLabel = ref("");

const TRUCK_ZONE_LABELS = [
  "Zone A",
  "Zone B",
  "Zone C",
  "Zone D",
  "Zone E",
  "Zone F",
];

const formatZoneLabel = (zoneValue?: number | null) => {
  if (zoneValue === null || zoneValue === undefined) return null;
  const numeric = Number(zoneValue);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const preset = TRUCK_ZONE_LABELS[numeric - 1];
  if (preset) return preset;
  return `Zone ${numeric}`;
};

const clearZoneAssignments = () => {
  containerZoneMap.value = new Map();
  itemZoneMap.value = new Map();
};

const getContainerZoneLabel = (containerId?: string | number | null) => {
  if (containerId === null || containerId === undefined) return null;
  return containerZoneMap.value.get(String(containerId)) || null;
};

const getItemZoneLabel = (itemId?: string | number | null) => {
  if (itemId === null || itemId === undefined) return null;
  return itemZoneMap.value.get(String(itemId)) || null;
};

const resolveCollectionLabel = (collectionId?: string | number | null) => {
  if (collectionId === null || collectionId === undefined) {
    return null;
  }
  const normalized = String(collectionId);
  const match = store.collections.find(
    (collection: any) => String(collection.value) === normalized,
  );
  return match?.label || null;
};

const collectSessionLocationIds = (session: any | null | undefined) => {
  if (!session) return [];
  const ids = [
    session.origin_location_id,
    session.destination_location_id,
    session.session_start_location_id,
    session.session_end_location_id,
  ];
  return ids
    .filter((id) => id !== null && id !== undefined)
    .map((id) => String(id));
};

const collectMoveLocationIds = (move: any | null | undefined) => {
  if (!move) return [];
  const ids = [move.origin_location_id, move.destination_location_id];
  return ids
    .filter((id) => id !== null && id !== undefined)
    .map((id) => String(id));
};

const locationLocks = computed(() => {
  const locks = new Map<
    string,
    { moveId: string | null; moveName: string | null; sessionId: string | number }
  >();
  allSessions.value.forEach((session: any) => {
    if (!session || session.status !== "in_progress") return;
    const moveId = session.saved_move_id ? String(session.saved_move_id) : null;
    const lockInfo = {
      moveId,
      moveName: session.move_name || session.session_name || null,
      sessionId: session.id,
    };
    collectSessionLocationIds(session).forEach((locId) => {
      if (!locks.has(locId)) {
        locks.set(locId, lockInfo);
      }
    });
  });
  return locks;
});

const findLockForMove = (move: any | null | undefined) => {
  if (!move) return null;
  const moveId = move.id ? String(move.id) : null;
  for (const locId of collectMoveLocationIds(move)) {
    const lock = locationLocks.value.get(locId);
    if (lock && (!moveId || lock.moveId !== moveId)) {
      return { lock, locationId: locId };
    }
  }
  return null;
};

const conflictingLocationLock = computed(() => {
  const activeMoveId = selectedMove.value?.id
    ? String(selectedMove.value.id)
    : null;
  const combined = new Set<string>();
  collectMoveLocationIds(selectedMove.value).forEach((id) => combined.add(id));
  collectSessionLocationIds(selectedSession.value).forEach((id) => combined.add(id));

  for (const locId of combined) {
    const lock = locationLocks.value.get(locId);
    if (lock && (!activeMoveId || lock.moveId !== activeMoveId)) {
      return lock;
    }
  }
  return null;
});
const canSetSessionInProgress = computed(() => !conflictingLocationLock.value);
const inProgressRestrictionMessage = computed(() => {
  if (!conflictingLocationLock.value) return "";
  const name = conflictingLocationLock.value.moveName || conflictingLocationLock.value.moveId;
  return `Move "${name}" is already in progress at this location.`;
});
const canOpenStatusDialog = computed(() => {
  if (!selectedSession.value) return false;
  if (selectedSession.value.status === "in_progress") return true;
  return !conflictingLocationLock.value;
});
const loading = ref(false);
const showScanDialog = ref(false);
const showShareDialog = ref(false);
const inviteEmail = ref("");
const invitePhone = ref("");
const showManifestPicker = ref(false);
const manifestSelection = ref<string | null>(null);
const qrVideoRef = ref<HTMLVideoElement | null>(null);
const qrReader = ref<BrowserMultiFormatReader | null>(null);
const qrReaderControls = ref<any>(null);
const qrScannerActive = ref(false);
const qrScanError = ref<string | null>(null);
const lastScannedValue = ref<string | null>(null);

type ManifestOption = {
  label: string;
  value: string;
  scanValue: string | number;
  type: "container" | "item";
};

const handleSelectMoveFromDrawer = (moveId: string | number) => {
  const target = moves.value.find((move) => String(move.id) === String(moveId));
  if (!target) return;
  const conflict = findLockForMove(target);
  if (conflict) {
    $q.dialog({
      title: "Move currently in progress",
      message:
        "Move \"" +
        (conflict.lock.moveName || conflict.lock.moveId) +
        "\" is already active at this location.",
      ok: true,
    });
  }
  selectMove(target, false);
};

const sendInvite = () => {
  showShareDialog.value = false;
  inviteEmail.value = "";
  invitePhone.value = "";
  $q.notify({ type: "positive", message: "Invite ready to share" });
};

// Computed
// Semantic StatusPill tone (accent = in progress, success = complete).
const sessionStatusColor = computed(() => {
  if (!selectedSession.value) return "neutral";
  switch (selectedSession.value.status) {
    case "in_progress":
      return "accent";
    case "complete":
      return "success";
    case "not_started":
      return "neutral";
    default:
      return "neutral";
  }
});

const sessionStatusLabel = computed(() => {
  if (!selectedSession.value) return "No session";
  switch (selectedSession.value.status) {
    case "in_progress":
      return "In progress";
    case "complete":
      return "Complete";
    case "not_started":
      return "Not started";
    default:
      return selectedSession.value.status;
  }
});

const isMoveOwner = computed(() => {
  if (!selectedMove.value || !props.user) return false;
  return String(selectedMove.value.user_id) === String(props.user);
});

const sessionTimeline = computed(() => {
  const sorted = [...sessions.value].sort((a, b) => {
    const aTime = new Date(
      a.start_time || a.move_date || a.created_at || 0,
    ).getTime();
    const bTime = new Date(
      b.start_time || b.move_date || b.created_at || 0,
    ).getTime();
    return aTime - bTime;
  });
  return sorted.map((session, index) => ({
    id: session.id,
    label: session.session_name || `Session ${index + 1}`,
    status: session.status,
    index: index + 1,
  }));
});

const shareLink = computed(() => {
  if (!selectedMove.value) return "";
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/mobile/moves/${selectedMove.value.id}`;
});

const isSessionReadyForScanning = computed(() => {
  if (!selectedSession.value) return false;
  if (selectedSession.value.status !== "in_progress") return false;
  if (conflictingLocationLock.value) return false;
  return true;
});

const canSubmitScan = computed(() => {
  return isSessionReadyForScanning.value && pendingScanEntity.value !== null;
});

const scanRestrictionMessage = computed(() => {
  if (!selectedSession.value) return "Select a session to begin scanning.";
  if (conflictingLocationLock.value) {
    return inProgressRestrictionMessage.value;
  }
  if (selectedSession.value.status !== "in_progress") {
    return "Set this session to In progress before scanning.";
  }
  return "";
});

const resolveScanPayload = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/\/qr\//i.test(trimmed)) {
    return { qr_token: trimmed };
  }
  if (/^(qr_|ct_|it_)/i.test(trimmed)) {
    return { qr_token: trimmed };
  }
  return { container_id: trimmed };
};

const scanSelectionLabel = computed(() => scanDisplayLabel.value || pendingScanEntity.value?.label || boxInput.value.trim());
const scanZoneLabel = computed(() => pendingScanEntity.value?.zoneLabel || null);

const activeTimelineIndex = computed(() => {
  if (!selectedSession.value) return null;
  const activeNode = sessionTimeline.value.find(
    (node) => node.id === selectedSession.value?.id,
  );
  return activeNode ? activeNode.index : null;
});

const manifestOptions = computed<ManifestOption[]>(() => {
  const options: ManifestOption[] = [];
  const containerList = Array.isArray(store.containers)
    ? store.containers
    : [];
  const looseItems = Array.isArray(store.items) ? store.items : [];

  containerList.forEach((container: any) => {
    if (!container) return;
    const displayLabel =
      container.label ||
      container.box_number ||
      `Box ${container.value ?? ""}`.trim();
    options.push({
      label: displayLabel,
      value: `container-${container.value}`,
      scanValue: container.value ?? displayLabel,
      type: "container",
    });
  });

  looseItems
    .filter((item: any) => !item?.container)
    .forEach((item: any) => {
      if (!item) return;
      const displayLabel = item.label || `Item ${item.value ?? ""}`.trim();
      options.push({
        label: displayLabel,
        value: `item-${item.value}`,
        scanValue: item.value ?? displayLabel,
        type: "item",
      });
    });

  return options;
});

const loadSessionLoadingPlan = async (sessionId: number | null) => {
  if (!sessionId) {
    clearZoneAssignments();
    return;
  }
  try {
    const headers: Record<string, string> = {};
    const token = localStorage.getItem("session_token");
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await axios.get(
      `${API_BASE}/api/move-day/sessions/${sessionId}/loading-plan`,
      { headers },
    );
    const containerAssignments = new Map<string, string>();
    const itemAssignments = new Map<string, string>();
    const planContainers = Array.isArray(response.data?.containers)
      ? response.data.containers
      : [];
    planContainers.forEach((entry: any) => {
      if (!entry?.id) return;
      const zoneLabel = formatZoneLabel(entry.loading_zone);
      if (zoneLabel) {
        containerAssignments.set(String(entry.id), zoneLabel);
      }
    });
    const planItems = Array.isArray(response.data?.loose_items)
      ? response.data.loose_items
      : [];
    planItems.forEach((entry: any) => {
      if (!entry?.id) return;
      const zoneLabel = formatZoneLabel(entry.loading_zone);
      if (zoneLabel) {
        itemAssignments.set(String(entry.id), zoneLabel);
      }
    });
    containerZoneMap.value = containerAssignments;
    itemZoneMap.value = itemAssignments;
  } catch (error) {
    console.error("[MobileMoveSession] Failed to load loading plan", error);
    clearZoneAssignments();
  }
};

const extractTokenFromValue = (value: string) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  const urlMatch = trimmed.match(/\/qr\/(?:container|item)\/([^/?#]+)/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  if (/^(ct_|it_|qr_)/i.test(trimmed)) {
    return trimmed;
  }
  return null;
};

const setScanDisplayLabel = (raw: string | null, explicitLabel?: string | null) => {
  if (explicitLabel) {
    console.log("[MobileMoveSession] Display label via explicit:", explicitLabel);
    scanDisplayLabel.value = explicitLabel;
  } else if (!raw) {
    scanDisplayLabel.value = "";
  } else {
    const trimmed = raw.trim();
    scanDisplayLabel.value =
      pendingScanEntity.value?.label || trimmed;
    console.log("[MobileMoveSession] Display label via pending/raw:", scanDisplayLabel.value);
  }
};

const resolveScanEntity = (rawValue: string | null, explicitType?: "container" | "item") => {
  pendingScanEntity.value = null;
  if (!rawValue) {
    console.log("[MobileMoveSession] resolveScanEntity called with empty value");
    return;
  }
  const trimmed = rawValue.trim();
  const token = extractTokenFromValue(trimmed);

  const matchContainer = store.containers.find(
    (c) =>
      String(c.value) === trimmed ||
      c.qr_code === trimmed ||
      (token && c.qr_code === token),
  );
  if (matchContainer && (explicitType === undefined || explicitType === "container")) {
    const collectionId =
      matchContainer.collection !== undefined && matchContainer.collection !== null
        ? String(matchContainer.collection)
        : null;
    const explicitZoneLabel = getContainerZoneLabel(matchContainer.value);
    pendingScanEntity.value = {
      type: "container",
      id: String(matchContainer.value),
      label:
        matchContainer.label ||
        (matchContainer.box_number
          ? `Box ${matchContainer.box_number}`
          : `Container ${matchContainer.value}`),
      collectionId,
      zoneLabel: explicitZoneLabel || resolveCollectionLabel(collectionId),
    };
    console.log("[MobileMoveSession] Resolved container entity:", pendingScanEntity.value);
    return;
  }

  const matchItem = store.items.find(
    (i) =>
      String(i.value) === trimmed ||
      i.qr_code === trimmed ||
      (token && i.qr_code === token),
  );
  if (matchItem && matchItem.container) {
    console.log(
      "[MobileMoveSession] Ignoring QR match for nested item",
      matchItem.value,
      "inside container",
      matchItem.container,
    );
  }
  if (
    matchItem &&
    !matchItem.container &&
    (explicitType === undefined || explicitType === "item")
  ) {
    const collectionId =
      matchItem.collection !== undefined && matchItem.collection !== null
        ? String(matchItem.collection)
        : null;
    const explicitZoneLabel = getItemZoneLabel(matchItem.value);
    pendingScanEntity.value = {
      type: "item",
      id: String(matchItem.value),
      label: matchItem.label || `Item ${matchItem.value}`,
      collectionId,
      zoneLabel: explicitZoneLabel || resolveCollectionLabel(collectionId),
    };
    console.log("[MobileMoveSession] Resolved item entity:", pendingScanEntity.value);
    return;
  }

  console.log("[MobileMoveSession] Failed to resolve entity for value:", rawValue);
};

const goToItemsFromDrawer = (locationId: string | number) => {
  selectedLocationId.value = locationId;
  const normalized = locationId != null ? String(locationId) : null;
  if (normalized) {
    router.push({
      name: "mobile-locations",
      params: { locationId: normalized },
    });
  } else {
    router.push({ name: "mobile-locations" });
  }
  showLeft.value = false;
};

// Methods
const fetchMoves = async () => {
  try {
    loading.value = true;
    const token = localStorage.getItem("session_token");
    const response = await axios.get(`${API_BASE}/api/saved-moves`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    moves.value = Array.isArray(response.data) ? response.data : [];
    await maybeAutoSelectMove();
  } catch (error) {
    console.error("Error fetching moves:", error);
    $q.notify({
      type: "negative",
      message: "Failed to load moves",
      position: "top",
    });
  } finally {
    loading.value = false;
  }
};

const fetchSessions = async (moveId: number) => {
  try {
    loading.value = true;
    const token = localStorage.getItem("session_token");
    const response = await axios.get(`${API_BASE}/api/move-day/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = Array.isArray(response.data) ? response.data : [];
    allSessions.value = data;
    // Filter sessions by selected move
    const list = data.filter((s: any) => s.saved_move_id === moveId);
    sessions.value = list;
    if (list.length) {
      const first = list.sort((a: any, b: any) => {
        const aTime = new Date(
          a.start_time || a.move_date || a.created_at || 0,
        ).getTime();
        const bTime = new Date(
          b.start_time || b.move_date || b.created_at || 0,
        ).getTime();
        return aTime - bTime;
      })[0];
      selectedSession.value = first;
      await loadSessionLoadingPlan(first?.id ?? null);
    } else {
      selectedSession.value = null;
      clearZoneAssignments();
    }
  } catch (error) {
    console.error("Error fetching sessions:", error);
    $q.notify({
      type: "negative",
      message: "Failed to load sessions",
      position: "top",
    });
    clearZoneAssignments();
  } finally {
    loading.value = false;
  }
};

const getRouteMoveId = (): string | null => {
  const param = route.params.moveId;
  if (Array.isArray(param)) {
    return param[0] ? String(param[0]) : null;
  }
  if (typeof param === "string" && param.length > 0) {
    return param;
  }
  const queryMoveId = route.query.moveId;
  if (typeof queryMoveId === "string" && queryMoveId.length > 0) {
    return queryMoveId;
  }
  return null;
};

const maybeAutoSelectMove = async () => {
  if (!moves.value.length) {
    selectedMove.value = null;
    selectedSession.value = null;
    sessions.value = [];
    return;
  }

  const moveIdFromRoute = getRouteMoveId();
  let targetMove = moveIdFromRoute
    ? moves.value.find((move) => String(move.id) === String(moveIdFromRoute))
    : null;

  if (!targetMove && !selectedMove.value) {
    targetMove = moves.value[0];
  }

  if (targetMove) {
    if (
      selectedMove.value &&
      String(selectedMove.value.id) === String(targetMove.id)
    ) {
      return;
    }
    await selectMove(targetMove, false);
  }
};

const selectMove = async (move: any, notify = true) => {
  selectedMove.value = move;
  selectedSession.value = null;
  sessions.value = [];
  showLeft.value = false;
  clearZoneAssignments();

  if (move?.id) {
    const currentParam = Array.isArray(route.params.moveId)
      ? route.params.moveId[0]
      : route.params.moveId;
    if (String(move.id) !== (currentParam ? String(currentParam) : "")) {
      router.replace({
        name: "mobile-moves",
        params: { moveId: String(move.id) },
      });
    }
  }

  if (notify) {
    $q.notify({
      type: "positive",
      message: `Selected move: ${move.name}`,
      position: "top",
    });
  }

  await fetchSessions(move.id);
};

const onSessionChange = async (sessionId: number) => {
  selectedSession.value = sessions.value.find((s) => s.id === sessionId);
  await loadSessionLoadingPlan(selectedSession.value?.id ?? null);
};

const changeStatus = () => {
  if (!selectedSession.value) return;
  if (
    selectedSession.value.status !== "in_progress" &&
    conflictingLocationLock.value
  ) {
    return;
  }

  const statuses = [
    { label: "Not started", value: "not_started" },
    {
      label: "In progress",
      value: "in_progress",
      disable: !canSetSessionInProgress.value,
    },
    { label: "Complete", value: "complete" },
  ];

  $q.dialog({
    title: "Change status",
    message:
      !canSetSessionInProgress.value && inProgressRestrictionMessage.value
        ? inProgressRestrictionMessage.value
        : "Select new status:",
    options: {
      type: "radio",
      model: selectedSession.value.status,
      items: statuses,
    },
    cancel: true,
  }).onOk(async (newStatus: string) => {
    try {
      loading.value = true;
      const token = localStorage.getItem("session_token");
      await axios.put(
        `${API_BASE}/api/move-day/sessions/${selectedSession.value.id}/status`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      selectedSession.value.status = newStatus;

      $q.notify({
        type: "positive",
        message: `Status changed to "${statuses.find((s) => s.value === newStatus)?.label}"`,
        position: "top",
      });
    } catch (error) {
      console.error("Error updating status:", error);
      $q.notify({
        type: "negative",
        message: "Failed to update status",
        position: "top",
      });
    } finally {
      loading.value = false;
    }
  });
};

const handleScan = async (scanType: "loaded" | "unloaded") => {
  if (!canSubmitScan.value || !pendingScanEntity.value) return;

  try {
    loading.value = true;
    const token = localStorage.getItem("session_token");
    const payload = resolveScanPayload(boxInput.value);
    if (!payload) {
      $q.notify({
        type: "warning",
        message: "Select or scan a box before recording.",
        position: "top",
      });
      return;
    }

    if (pendingScanEntity.value.type === "container") {
      const resolvedPayload =
        payload && ("qr_token" in payload)
          ? { qr_token: payload.qr_token }
          : { container_id: Number(pendingScanEntity.value.id) };

      await axios.post(
        `${API_BASE}/api/move-day/scans`,
        {
          move_session_id: selectedSession.value.id,
          scan_type: scanType,
          scanned_by: props.user,
          ...resolvedPayload,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } else if (pendingScanEntity.value.type === "item") {
      const resolvedPayload =
        payload && ("qr_token" in payload)
          ? { qr_token: payload.qr_token }
          : { item_id: Number(pendingScanEntity.value.id) };

      await axios.post(
        `${API_BASE}/api/move-day/scans/item`,
        {
          move_session_id: selectedSession.value.id,
          scan_type: scanType,
          scanned_by: props.user,
          ...resolvedPayload,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    }

    const selectionLabel = pendingScanEntity.value?.label || "QR code";

    $q.notify({
      type: "positive",
      message: `${selectionLabel} ${scanType === "loaded" ? "loaded" : "unloaded"}`,
      position: "top",
      icon: "check_circle",
    });

    boxInput.value = "";
    setScanDisplayLabel(null);
    pendingScanEntity.value = null;
  } catch (error: any) {
    console.error("Error recording scan:", error);
    $q.notify({
      type: "negative",
      message: error.response?.data?.error || "Failed to record scan",
      position: "top",
    });
  } finally {
    loading.value = false;
  }
};

const openQRScanner = () => {
  showScanDialog.value = true;
};

const stopQrScanner = () => {
  if (qrReaderControls.value?.stop) {
    try {
      qrReaderControls.value.stop();
    } catch (e) {
      console.warn("QR controls stop failed", e);
    }
  }
  qrReaderControls.value = null;
  qrReader.value = null;
  qrScannerActive.value = false;
};

const handleQrCapture = (text: string) => {
  const normalized = text?.trim();
  if (!normalized) return;
  if (normalized === lastScannedValue.value) {
    stopQrScanner();
    return;
  }
  lastScannedValue.value = normalized;
  boxInput.value = normalized;
  resolveScanEntity(normalized);
  const label = pendingScanEntity.value?.label;
  setScanDisplayLabel(normalized, label);
  qrScanError.value = null;
  stopQrScanner();
  $q.notify({
    type: "positive",
    message: "QR code captured",
    position: "top",
  });
};

const startQrScanner = async () => {
  if (qrScannerActive.value) {
    return;
  }
  if (!showScanDialog.value) {
    return;
  }
  await nextTick();
  if (!qrVideoRef.value) {
    return;
  }
  try {
    qrScanError.value = null;
    qrReader.value = new BrowserMultiFormatReader();
    qrScannerActive.value = true;
    qrReaderControls.value = await qrReader.value.decodeFromVideoDevice(
      undefined,
      qrVideoRef.value,
      (result, err) => {
        if (result?.getText()) {
          handleQrCapture(result.getText());
        } else if (
          err &&
          err.name !== "NotFoundException" &&
          err.name !== "ChecksumException" &&
          err.name !== "FormatException"
        ) {
          qrScanError.value = "Unable to read QR code. Adjust lighting and try again.";
        }
      },
    );
  } catch (error: any) {
    qrScannerActive.value = false;
    if (error?.name === "NotAllowedError") {
      qrScanError.value = "Camera access denied. Please enable camera permissions.";
    } else if (error?.name === "NotFoundException") {
      qrScanError.value = "No camera detected on this device.";
    } else {
      qrScanError.value = "Unable to start camera.";
    }
  }
};

const restartQrScanner = () => {
  if (!showScanDialog.value) return;
  lastScannedValue.value = null;
  stopQrScanner();
  startQrScanner();
};

watch(manifestSelection, (newValue) => {
  if (!newValue) return;
  const match = manifestOptions.value.find(
    (option) => option.value === newValue,
  );
  if (!match) return;
  boxInput.value = String(match.scanValue ?? "");
  showManifestPicker.value = false;
  resolveScanEntity(String(match.scanValue ?? ""), match.type);
  const label =
    match.label ||
    pendingScanEntity.value?.label ||
    String(match.scanValue ?? "");
  setScanDisplayLabel(String(match.scanValue ?? ""), label);
});

watch(showScanDialog, (isOpen) => {
  if (isOpen) {
    showManifestPicker.value = false;
    manifestSelection.value = null;
    lastScannedValue.value = null;
    startQrScanner();
  } else {
    stopQrScanner();
    showManifestPicker.value = false;
    manifestSelection.value = null;
    qrScanError.value = null;
    lastScannedValue.value = null;
    setScanDisplayLabel(null);
  }
});


onMounted(() => {
  fetchMoves();
  if (props.user) {
    if (store.items.length || store.containers.length) {
      console.log(
        "[MobileMoveSession] Inventory already loaded",
        store.items.length,
        "items /",
        store.containers.length,
        "containers",
      );
    } else {
      console.log(
        "[MobileMoveSession] Loading inventory for QR resolution. user:",
        props.user,
      );
      store
        .loadInventory(props.user)
        .then(() => {
          console.log(
            "[MobileMoveSession] Inventory loaded",
            store.items.length,
            "items /",
            store.containers.length,
            "containers",
          );
        })
        .catch((error) => {
          console.error("[MobileMoveSession] Unable to load inventory", error);
        });
    }
  }
});

watch(
  () => route.params.moveId,
  () => {
    if (moves.value.length) {
      maybeAutoSelectMove();
    }
  },
);

watch(
  () => route.query.moveId,
  () => {
    if (moves.value.length) {
      maybeAutoSelectMove();
    }
  },
);
</script>

<template>
  <q-layout view="hHh lpR fFf" class="mobile-layout">
    <!-- Header -->
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-btn dense flat round icon="menu" @click="showLeft = !showLeft" />

        <q-toolbar-title class="text-subtitle1 text-weight-medium">
          Move sessions
        </q-toolbar-title>

        <ReloPrepLogo
          :width="30"
          logo-src="https://storage.googleapis.com/widowmaker-site-images/verimove_app_logo_white.png"
          style="margin-left: 8px"
        />
      </q-toolbar>
    </q-header>

    <MobileNavDrawer
      v-model="showLeft"
      :selected-location-id="
        selectedLocationId ? String(selectedLocationId) : null
      "
      :saved-moves="moves"
      :saved-moves-loading="false"
      :active-move-id="selectedMove?.id ?? null"
      @select-location="goToItemsFromDrawer"
      @select-move="handleSelectMoveFromDrawer"
    />

    <!-- Main Content -->
    <q-page-container>
      <q-page class="move-page q-pa-md">
        <!-- No Move Selected -->
        <q-card v-if="!selectedMove" class="move-card q-mb-md">
          <q-card-section class="text-center">
            <FolderOpen
              :size="48"
              class="empty-state__icon q-mb-md"
              aria-hidden="true"
            />
            <div class="empty-state__title">No move selected</div>
            <div class="empty-state__hint q-mb-md">
              Use the menu to select a move
            </div>
            <q-btn
              class="block-btn"
              color="primary"
              unelevated
              no-caps
              label="Open menu"
              @click="showLeft = true"
            />
          </q-card-section>
        </q-card>

        <!-- Move Selected -->
        <template v-if="selectedMove">
          <!-- Move Info -->
          <q-card class="move-card q-mb-md">
            <q-card-section>
              <div class="move-card-header">
                <div>
                  <div class="move-name">
                    {{ selectedMove.name }}
                  </div>
                  <div class="move-route">
                    {{ selectedMove.origin_address }} →
                    {{ selectedMove.destination_address }}
                  </div>
                </div>
                <q-btn
                  v-if="isMoveOwner"
                  flat
                  round
                  icon="ios_share"
                  class="icon-action"
                  aria-label="Share move"
                  @click="showShareDialog = true"
                >
                  <q-tooltip>Share move</q-tooltip>
                </q-btn>
              </div>
              <div v-if="sessionTimeline.length" class="session-timeline">
                <button
                  v-for="node in sessionTimeline"
                  :key="node.id"
                  type="button"
                  class="timeline-node"
                  :aria-label="node.label"
                  :class="{
                    active: selectedSession?.id === node.id,
                    complete: node.status === 'complete',
                    adjacent:
                      activeTimelineIndex &&
                      Math.abs(node.index - activeTimelineIndex) === 1,
                    'adjacent-secondary':
                      activeTimelineIndex &&
                      Math.abs(node.index - activeTimelineIndex) === 2,
                    distant:
                      activeTimelineIndex &&
                      Math.abs(node.index - activeTimelineIndex) > 2,
                  }"
                  @click="onSessionChange(node.id)"
                >
                  <span class="node-content">
                    <template v-if="selectedSession?.id === node.id">
                      <span class="node-label">{{ node.label }}</span>
                      <CircleCheck
                        v-if="node.status === 'complete'"
                        :size="16"
                        class="q-ml-sm"
                        aria-hidden="true"
                      />
                    </template>
                    <template
                      v-else-if="
                        activeTimelineIndex &&
                        Math.abs(node.index - activeTimelineIndex) === 1
                      "
                    >
                      <span class="node-number">{{ node.index }}</span>
                    </template>
                    <template
                      v-else-if="
                        activeTimelineIndex &&
                        Math.abs(node.index - activeTimelineIndex) === 2
                      "
                    >
                      <span class="node-number node-number--secondary">
                        {{ node.index }}
                      </span>
                    </template>
                  </span>
                </button>
              </div>
            </q-card-section>
          </q-card>

          <!-- Session Selector -->
          <q-card v-if="selectedSession" class="move-card q-mb-md">
            <q-card-section>
              <div class="card-label q-mb-sm">Session status</div>
              <button
                type="button"
                class="status-pill"
                :class="[
                  `status-pill--${sessionStatusColor}`,
                  { 'status-pill--static': !canOpenStatusDialog },
                ]"
                @click="canOpenStatusDialog && changeStatus()"
              >
                {{ sessionStatusLabel }}
                <q-tooltip>Tap to change status</q-tooltip>
              </button>
            </q-card-section>
          </q-card>

          <div
            v-if="selectedSession && !isSessionReadyForScanning"
            class="nudge-banner q-mb-md"
            role="status"
          >
            <TriangleAlert
              :size="20"
              class="nudge-banner__icon"
              aria-hidden="true"
            />
            <span>{{ scanRestrictionMessage }}</span>
          </div>

          <q-page-sticky
            v-if="selectedSession"
            position="bottom"
            :offset="[16, 16]"
          >
            <div class="scan-actions">
              <q-btn
                class="fab-button"
                unelevated
                no-caps
                icon="qr_code_scanner"
                label="Scan box / item"
                @click="openQRScanner"
                :disable="!isSessionReadyForScanning"
              />
            </div>
          </q-page-sticky>
        </template>
      </q-page>
    </q-page-container>

    <!-- Footer -->
    <FooterVue :user="user" />

    <q-dialog v-model="showShareDialog">
      <q-card class="share-card" style="min-width: 320px">
        <q-card-section>
          <div class="share-card__title">Share this move</div>
          <div class="share-card__hint">
            Send a link to helpers via text or email.
          </div>
        </q-card-section>
        <q-card-section class="q-gutter-md">
          <q-input v-model="inviteEmail" label="Email" type="email" />
          <q-input v-model="invitePhone" label="Phone" type="tel" />
          <q-input v-model="shareLink" label="Invite link" readonly dense />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            flat
            no-caps
            label="Cancel"
            color="primary"
            @click="showShareDialog = false"
          />
          <q-btn
            unelevated
            no-caps
            color="primary"
            label="Send invite"
            @click="sendInvite"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
    <q-dialog
      v-model="showScanDialog"
      persistent
      position="bottom"
      transition-show="slide-up"
      transition-hide="slide-down"
      class="scan-toast-dialog"
    >
      <div class="scan-toast">
        <div class="scan-toast__handle"></div>
        <div class="scan-toast__header">
          <div>
            <div class="scan-toast__eyebrow">Move day tools</div>
            <div class="scan-toast__title">Scan box / item</div>
            <div class="scan-toast__subtitle">
              Use your camera to capture the QR code and keep loading on track.
            </div>
          </div>
        </div>
        <q-btn
          flat
          round
          icon="close"
          class="scan-toast__close"
          aria-label="Close"
          @click="showScanDialog = false"
        />

        <div class="scan-preview-window">
          <div class="scan-video-wrapper">
            <video
              ref="qrVideoRef"
              class="scan-video"
              autoplay
              muted
              playsinline
            ></video>
            <div
              v-if="qrScanError"
              class="scan-preview-text text-negative"
            >
              {{ qrScanError }}
            </div>
            <div
              v-else
              class="scan-preview-text"
            >
              {{
                qrScannerActive
                  ? "Align a QR code within the frame"
                  : "Tap scan again if you need a new capture"
              }}
            </div>
          </div>
          <div class="scan-controls q-mt-sm">
            <q-btn
              flat
              no-caps
              class="sheet-link"
              icon="autorenew"
              label="Scan again"
              @click="restartQrScanner"
            />
          </div>
        </div>

        <div
          v-if="manifestOptions.length"
          class="scan-manifest-picker"
        >
          <q-btn
            flat
            no-caps
            icon="list_alt"
            class="manifest-toggle"
            :label="showManifestPicker ? 'Hide manifest' : 'Select box / item'"
            @click="showManifestPicker = !showManifestPicker"
          />
          <transition name="manifest-fade">
            <div v-show="showManifestPicker" class="manifest-select">
              <q-select
                dense
                filled
                v-model="manifestSelection"
                :options="manifestOptions"
                option-label="label"
                option-value="value"
                emit-value
                map-options
                label="Manifest items"
                popup-content-class="manifest-select-popup"
              >
                <template #option="{ opt, itemProps }">
                  <q-item v-bind="itemProps">
                    <q-item-section>
                      <q-item-label>{{ opt.label }}</q-item-label>
                      <q-item-label caption>
                        {{ opt.type === "container" ? "Box" : "Loose item" }}
                      </q-item-label>
                    </q-item-section>
                  </q-item>
                </template>
              </q-select>
            </div>
          </transition>
        </div>

        <div v-if="boxInput" class="scan-selection">
          <CircleCheck
            :size="22"
            class="scan-selection__check"
            aria-hidden="true"
          />
          <div class="scan-selection__body">
            <div class="selection-label">Selected</div>
            <div class="selection-value">{{ scanSelectionLabel }}</div>
            <div
              v-if="scanZoneLabel"
              class="selection-zone"
            >
              Assigned zone: <strong>{{ scanZoneLabel }}</strong>
            </div>
          </div>
        </div>

        <div class="scan-toast__actions">
          <q-btn
            class="scan-action scan-action--primary"
            unelevated
            no-caps
            label="Loaded"
            icon="inventory_2"
            :disable="!canSubmitScan"
            @click="handleScan('loaded')"
          />
          <q-btn
            class="scan-action scan-action--secondary"
            unelevated
            no-caps
            label="Report damage"
            icon="report"
            :disable="!canSubmitScan"
            @click="handleScan('unloaded')"
          />
        </div>

      </div>
    </q-dialog>
  </q-layout>
</template>

<style scoped>
/* Retokenized to the Nexus Moves design system — light theme
   (the web app is [data-theme="light"] app-wide, phase 1).
   Literals remain only for fixed layout dims, hairlines,
   micro-transforms, and the camera-viewport chrome (render
   parameters for the live scanner feed). */

.mobile-layout {
  padding-bottom: 56px; /* footer clearance (fixed layout dim) */
  background: var(--bg);
}

.move-page {
  min-height: 100vh;
}

.move-card {
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
}

.card-label {
  font-size: var(--fs-body);
  font-weight: var(--fw-bold);
  color: var(--text-primary);
}

/* ── Empty state ─────────────────────────────────────────── */
.empty-state__icon {
  color: var(--text-tertiary);
}

.empty-state__title {
  font-size: var(--fs-title-s);
  font-weight: var(--fw-bold);
  color: var(--text-primary);
}

.empty-state__hint {
  font-size: var(--fs-body);
  color: var(--text-secondary);
}

.block-btn {
  width: 100%;
  min-height: var(--tap-min);
  border-radius: var(--r-md);
  font-size: var(--fs-body-l);
  font-weight: var(--fw-bold);
}

/* ── Move header ─────────────────────────────────────────── */
.move-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--sp-4);
}

.move-name {
  font-size: var(--fs-title-s);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-title);
  color: var(--accent);
}

.move-route {
  font-size: var(--fs-body);
  color: var(--text-secondary);
  margin-top: var(--sp-1);
}

.icon-action {
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  color: var(--accent);
}

/* ── Session timeline ────────────────────────────────────── */
.session-timeline {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
  padding: var(--sp-4) var(--sp-3);
  border-radius: var(--r-lg);
  overflow: hidden;
  position: relative;
}

.timeline-node {
  appearance: none;
  font-family: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--dur-slow) var(--ease-standard);
  border-radius: var(--r-pill);
  cursor: pointer;
  position: relative;
  background: var(--accent-quiet);
  border: 1px solid transparent;
  width: 12px;
  height: 12px;
  padding: 0;
  margin: 0 4px;
}

/* Invisible hit-area expansion so every node meets --tap-min
   without changing the dot visuals. */
.timeline-node::after {
  content: "";
  position: absolute;
  inset: -16px;
  border-radius: inherit;
}

.timeline-node:active {
  transform: scale(0.97);
}

.timeline-node.complete {
  background: var(--success-quiet);
}

.timeline-node.adjacent {
  width: 32px;
  height: 32px;
  background: var(--surface-card);
  border-color: var(--accent-quiet-2);
  color: var(--text-primary);
}

.timeline-node.adjacent::after {
  inset: -6px;
}

.timeline-node.adjacent-secondary {
  width: 20px;
  height: 20px;
  background: var(--surface-card);
  border-color: var(--accent-quiet-2);
  color: var(--text-secondary);
}

.timeline-node.adjacent-secondary::after {
  inset: -12px;
}

.timeline-node.active {
  flex-grow: 1;
  min-width: 120px;
  height: 38px;
  padding: 0 var(--sp-5);
  background: var(--accent);
  color: var(--on-accent);
  border-color: transparent;
  box-shadow: var(--shadow-sm);
  margin: 0 6px;
}

.timeline-node.active::after {
  inset: -4px;
}

.timeline-node.distant {
  opacity: 0.65;
}

.node-content {
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  overflow: hidden;
}

.node-number {
  font-size: var(--fs-label);
  font-weight: var(--fw-bold);
}

.node-number--secondary {
  font-size: var(--fs-micro);
  opacity: 0.8;
}

.node-label {
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
  opacity: 0;
  animation: fadeIn 0.3s forwards 0.2s;
}

@keyframes fadeIn {
  to {
    opacity: 1;
  }
}

.timeline-expand-enter-active,
.timeline-expand-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard);
}

.timeline-expand-enter-from,
.timeline-expand-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}

/* ── Session status (StatusPill semantics) ───────────────── */
.status-pill {
  appearance: none;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: var(--tap-min);
  padding: 0 var(--sp-5);
  border-radius: var(--r-pill);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  font-weight: var(--fw-bold);
  transition: transform var(--dur-fast) var(--ease-standard);
}

.status-pill:active {
  transform: scale(0.97);
}

.status-pill--accent {
  background: var(--accent-quiet);
  color: var(--accent);
}

.status-pill--success {
  background: var(--success-quiet);
  color: var(--success);
}

.status-pill--neutral {
  background: var(--surface-hover);
  color: var(--text-secondary);
}

.status-pill--static {
  cursor: default;
}

.status-pill--static:active {
  transform: none;
}

/* ── Honest-nudge banner (Banner, warning tone) ──────────── */
.nudge-banner {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-4);
  background: var(--warning-surface);
  color: var(--warning-ink);
  border-radius: var(--r-lg);
  padding: var(--sp-4) var(--sp-5);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  font-weight: var(--fw-medium);
}

.nudge-banner__icon {
  color: var(--warning);
  flex: none;
  margin-top: 1px; /* optical alignment */
}

/* ── Scan CTA — the single shimmer hero on this screen ───── */
.scan-actions {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.fab-button {
  width: 100%;
  min-height: 52px; /* block CTA height (≥ --tap-min) */
  padding: var(--sp-4) var(--sp-7);
  font-size: var(--fs-body-l);
  font-weight: var(--fw-bold);
  border-radius: var(--r-pill);
  background: var(--shimmer);
  color: var(--on-accent);
  box-shadow: var(--glow-shimmer);
  display: flex;
  justify-content: center;
  align-items: center;
  text-transform: none;
  position: relative;
  overflow: hidden;
}

.fab-button :deep(.q-btn__content) {
  gap: var(--sp-3);
}

.fab-button :deep(.q-icon) {
  font-size: 24px;
}

/* Signature looping sweep (same recipe as the kit / NexusChat). */
.fab-button::before {
  content: "";
  position: absolute;
  inset: 0;
  width: 45%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.35),
    transparent
  );
  animation: nx-shimmer-sweep var(--shimmer-sweep) var(--ease-standard)
    infinite;
  pointer-events: none;
}

.fab-button.disabled::before {
  animation: none;
}

@media (prefers-reduced-motion: reduce) {
  .fab-button::before {
    animation: none;
  }
}

/* ── Scan sheet (Sheet contract: grabber + title, --r-2xl) ── */
.scan-toast-dialog :deep(.q-dialog__inner--bottom) {
  padding: 0;
  justify-content: flex-end;
}

.scan-toast-dialog :deep(.q-dialog__backdrop) {
  background: color-mix(in oklab, var(--navy-900) 55%, transparent);
}

.scan-toast {
  width: 100vw;
  max-width: 480px; /* fixed layout dim */
  min-height: 75vh;
  border-radius: var(--r-2xl) var(--r-2xl) 0 0;
  background: var(--surface);
  padding: var(--sp-7);
  box-shadow: var(--shadow-lg);
  position: relative;
  overflow: hidden;
  color: var(--text-primary);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}

.scan-toast__handle {
  width: 40px; /* grabber dims per Sheet contract */
  height: 5px;
  border-radius: var(--r-pill);
  background: var(--border);
  margin: 0 auto;
}

.scan-toast__header {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-5);
  position: relative;
  z-index: 1;
}

.scan-toast__close {
  position: absolute;
  top: var(--sp-4);
  right: var(--sp-4);
  z-index: 2;
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  color: var(--text-secondary);
}

.scan-toast__eyebrow {
  font-family: var(--font-mono);
  text-transform: uppercase;
  font-size: var(--fs-micro);
  letter-spacing: var(--ls-eyebrow);
  color: var(--text-tertiary);
  margin-bottom: var(--sp-2);
}

.scan-toast__title {
  font-family: var(--font-display);
  font-size: var(--fs-title-m);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-title);
  color: var(--text-primary);
}

.scan-toast__subtitle {
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--text-secondary);
  margin-top: var(--sp-2);
}

.scan-preview-window {
  border-radius: var(--r-xl);
  padding: 0;
  min-height: 240px; /* scanner viewport dim */
  position: relative;
  z-index: 1;
}

.scan-video-wrapper {
  /* Camera viewport chrome: deliberate literals — the live feed
     renders here and the alignment cues must read identically in
     any theme (scanner render parameters). */
  position: relative;
  width: 100%;
  min-height: 240px; /* scanner viewport dim */
  border-radius: var(--r-xl);
  overflow: hidden;
  background: rgba(7, 11, 30, 0.9);
  border: 2px dashed rgba(255, 255, 255, 0.4);
  box-shadow: inset 0 0 25px rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
}

.scan-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scan-preview-text {
  position: absolute;
  bottom: var(--sp-4);
  left: 50%;
  transform: translateX(-50%);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
  padding: var(--sp-3) var(--sp-5);
  border-radius: var(--r-pill);
  /* scrim over the live camera feed (render parameter) */
  background: rgba(7, 11, 30, 0.7);
  color: #fff;
  max-width: calc(100% - 24px);
  text-align: center;
}

.scan-preview-text.text-negative {
  color: var(--danger);
}

.scan-controls {
  display: flex;
  justify-content: flex-end;
}

.sheet-link {
  color: var(--accent);
  font-weight: var(--fw-bold);
  font-size: var(--fs-body);
  text-transform: none;
  min-height: var(--tap-min);
}

/* ── Captured selection (ItemCard visuals) ───────────────── */
.scan-selection {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-4);
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: var(--sp-4) var(--sp-5);
  box-shadow: var(--shadow-sm);
  z-index: 1;
}

.scan-selection__check {
  color: var(--success);
  flex: none;
  margin-top: 2px; /* optical alignment */
}

.scan-selection__body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}

.selection-label {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.selection-value {
  font-size: var(--fs-body-l);
  font-weight: var(--fw-bold);
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.selection-zone {
  font-size: var(--fs-body);
  color: var(--text-secondary);
}

.selection-zone strong {
  font-family: var(--font-mono);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}

/* ── Manifest picker ─────────────────────────────────────── */
.scan-manifest-picker {
  background: var(--surface-hover);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  z-index: 1;
}

.manifest-toggle {
  text-transform: none;
  font-weight: var(--fw-bold);
  font-size: var(--fs-body);
  color: var(--accent);
  align-self: flex-start;
  min-height: var(--tap-min);
}

.manifest-select {
  border-radius: var(--r-sm);
  overflow: hidden;
}

.manifest-fade-enter-active,
.manifest-fade-leave-active {
  transition: opacity var(--dur-base) var(--ease-standard);
}

.manifest-fade-enter-from,
.manifest-fade-leave-to {
  opacity: 0;
}

/* ── Sheet actions ───────────────────────────────────────── */
.scan-toast__actions {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  position: relative;
  z-index: 1;
}

.scan-action {
  width: 100%;
  min-height: 52px; /* block CTA height (≥ --tap-min) */
  font-size: var(--fs-body-l);
  font-weight: var(--fw-bold);
  border-radius: var(--r-md);
  text-transform: none;
}

.scan-action--primary {
  background: var(--accent);
  color: var(--on-accent);
}

.scan-action--secondary {
  background: var(--danger-quiet);
  color: var(--danger);
}

/* ── Share dialog ────────────────────────────────────────── */
.share-card {
  border-radius: var(--r-lg);
  background: var(--surface-card);
}

.share-card__title {
  font-size: var(--fs-title-s);
  font-weight: var(--fw-extrabold);
  color: var(--text-primary);
}

.share-card__hint {
  font-size: var(--fs-body);
  color: var(--text-secondary);
}
</style>
