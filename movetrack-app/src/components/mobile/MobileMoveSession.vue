<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useQuasar } from "quasar";
import { useRoute, useRouter } from "vue-router";
import axios from "axios";
import FooterVue from "../Footer.vue";
import ReloPrepLogo from "../ReloPrepLogo.vue";
import MobileNavDrawer from "./MobileNavDrawer.vue";
import { inventoryStore } from "../../stores/InventoryStore";
import { BrowserMultiFormatReader } from "@zxing/browser";

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

const boxInput = ref("");
const scanDisplayLabel = ref("");
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
  if (target) {
    selectMove(target, false);
  }
};

const sendInvite = () => {
  showShareDialog.value = false;
  inviteEmail.value = "";
  invitePhone.value = "";
  $q.notify({ type: "positive", message: "Invite ready to share" });
};

// Computed
const sessionStatusColor = computed(() => {
  if (!selectedSession.value) return "grey";
  switch (selectedSession.value.status) {
    case "in_progress":
      return "blue";
    case "complete":
      return "green";
    case "not_started":
      return "grey";
    default:
      return "grey";
  }
});

const sessionStatusLabel = computed(() => {
  if (!selectedSession.value) return "No Session";
  switch (selectedSession.value.status) {
    case "in_progress":
      return "In Progress";
    case "complete":
      return "Complete";
    case "not_started":
      return "Not Started";
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

const canScan = computed(() => {
  return selectedSession.value && boxInput.value.trim().length > 0;
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

const scanSelectionLabel = computed(() => scanDisplayLabel.value);

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
    scanDisplayLabel.value = explicitLabel;
    return;
  }
  if (!raw) {
    scanDisplayLabel.value = "";
    return;
  }
  const trimmed = raw.trim();
  const token = extractTokenFromValue(trimmed);

  const containerMatch = store.containers.find(
    (c) =>
      String(c.value) === trimmed ||
      c.qr_code === trimmed ||
      (token && c.qr_code === token),
  );
  if (containerMatch) {
    scanDisplayLabel.value =
      containerMatch.label ||
      (containerMatch.box_number
        ? `Box ${containerMatch.box_number}`
        : `Container ${containerMatch.value}`);
    return;
  }

  const itemMatch = store.items.find(
    (i) =>
      String(i.value) === trimmed ||
      i.qr_code === trimmed ||
      (token && i.qr_code === token),
  );
  if (itemMatch) {
    scanDisplayLabel.value = itemMatch.label || `Item ${itemMatch.value}`;
    return;
  }

  const manifestMatch = manifestOptions.value.find((option) => {
    const scanValue = option.scanValue != null ? String(option.scanValue) : null;
    return (
      option.value === trimmed ||
      (scanValue && scanValue === trimmed) ||
      (token && scanValue === token)
    );
  });
  if (manifestMatch) {
    scanDisplayLabel.value = manifestMatch.label;
    return;
  }

  scanDisplayLabel.value = trimmed;
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
    // Filter sessions by selected move
    const list = response.data.filter((s: any) => s.saved_move_id === moveId);
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
    } else {
      selectedSession.value = null;
    }
  } catch (error) {
    console.error("Error fetching sessions:", error);
    $q.notify({
      type: "negative",
      message: "Failed to load sessions",
      position: "top",
    });
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

const onSessionChange = (sessionId: number) => {
  selectedSession.value = sessions.value.find((s) => s.id === sessionId);
};

const changeStatus = () => {
  if (!selectedSession.value) return;

  const statuses = [
    { label: "Not Started", value: "not_started" },
    { label: "In Progress", value: "in_progress" },
    { label: "Complete", value: "complete" },
  ];

  $q.dialog({
    title: "Change Status",
    message: "Select new status:",
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
  if (!canScan.value) return;

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

    await axios.post(
      `${API_BASE}/api/move-day/scans`,
      {
        move_session_id: selectedSession.value.id,
        scan_type: scanType,
        scanned_by: props.user,
        ...(payload.qr_token
          ? { qr_token: payload.qr_token }
          : { container_id: payload.container_id }),
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const selectionLabel = payload.qr_token
      ? "QR code"
      : payload.container_id;

    $q.notify({
      type: "positive",
      message: `${selectionLabel} ${scanType === "loaded" ? "LOADED" : "UNLOADED"}`,
      position: "top",
      icon: "check_circle",
    });

    boxInput.value = "";
    setScanDisplayLabel(null);
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
  if (qrReader.value && typeof qrReader.value.reset === "function") {
    try {
      qrReader.value.reset();
    } catch (e) {
      console.warn("QR scanner reset failed", e);
    }
  }
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
  setScanDisplayLabel(normalized);
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
    qrReader.value?.reset();
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
  setScanDisplayLabel(String(match.scanValue ?? ""), match.label);
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
          Move Sessions
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
            <q-icon
              name="folder_open"
              size="48px"
              color="grey-5"
              class="q-mb-md"
            />
            <div class="text-h6 text-grey-7">No Move Selected</div>
            <div class="text-caption text-grey-6 q-mb-md">
              Use the menu to select a move
            </div>
            <q-btn
              color="primary"
              outline
              label="Open Menu"
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
                  <div class="text-subtitle1 text-weight-bold text-primary">
                    {{ selectedMove.name }}
                  </div>
                  <div class="text-caption text-grey-7">
                    {{ selectedMove.origin_address }} →
                    {{ selectedMove.destination_address }}
                  </div>
                </div>
                <q-btn
                  v-if="isMoveOwner"
                  flat
                  round
                  dense
                  icon="ios_share"
                  @click="showShareDialog = true"
                >
                  <q-tooltip>Share Move</q-tooltip>
                </q-btn>
              </div>
              <div v-if="sessionTimeline.length" class="session-timeline">
                <div
                  v-for="node in sessionTimeline"
                  :key="node.id"
                  class="timeline-node"
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
                  <div class="node-content">
                    <template v-if="selectedSession?.id === node.id">
                      <span class="node-label">{{ node.label }}</span>
                      <q-icon
                        v-if="node.status === 'complete'"
                        name="check_circle"
                        size="16px"
                        class="q-ml-sm"
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
                  </div>
                </div>
              </div>
            </q-card-section>
          </q-card>

          <!-- Session Selector -->
          <q-card v-if="selectedSession" class="move-card q-mb-md">
            <q-card-section>
              <div class="text-subtitle2 q-mb-sm">Session Status</div>
              <q-chip
                :color="sessionStatusColor"
                text-color="white"
                clickable
                @click="changeStatus"
              >
                {{ sessionStatusLabel }}
                <q-tooltip>Tap to change status</q-tooltip>
              </q-chip>
            </q-card-section>
          </q-card>

          <q-page-sticky
            v-if="selectedSession"
            position="bottom"
            :offset="[16, 16]"
          >
            <div class="scan-actions">
              <q-btn
                class="fab-button fab-pill"
                unelevated
                icon="qr_code_scanner"
                label="Scan box / item"
                @click="openQRScanner"
              />
            </div>
          </q-page-sticky>
        </template>
      </q-page>
    </q-page-container>

    <!-- Footer -->
    <FooterVue :user="user" />

    <q-dialog v-model="showShareDialog">
      <q-card style="min-width: 320px">
        <q-card-section>
          <div class="text-h6">Share this Move</div>
          <div class="text-caption text-grey-7">
            Send a link to helpers via text or email.
          </div>
        </q-card-section>
        <q-card-section class="q-gutter-md">
          <q-input v-model="inviteEmail" label="Email" type="email" />
          <q-input v-model="invitePhone" label="Phone" type="tel" />
          <q-input v-model="shareLink" label="Invite Link" readonly dense />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            flat
            label="Cancel"
            color="primary"
            @click="showShareDialog = false"
          />
          <q-btn
            unelevated
            color="primary"
            label="Send Invite"
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
        <div class="scan-toast__glow"></div>
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
          dense
          icon="close"
          color="white"
          class="scan-toast__close"
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
              dense
              color="white"
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
            dense
            flat
            color="white"
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
          <div class="selection-label">Selected</div>
          <div class="selection-value">{{ scanSelectionLabel }}</div>
        </div>

        <div class="scan-toast__actions">
          <q-btn
            class="scan-action scan-action--primary"
            label="Loaded"
            icon="inventory_2"
            :disable="!boxInput"
          />
          <q-btn
            class="scan-action scan-action--secondary"
            label="Report Damage"
            icon="report"
            :disable="!boxInput"
          />
        </div>

      </div>
    </q-dialog>
  </q-layout>
</template>

<style scoped>
.mobile-layout {
  padding-bottom: 56px;
  background:
    radial-gradient(
      circle at 20% 20%,
      rgba(39, 70, 144, 0.08),
      transparent 35%
    ),
    radial-gradient(
      circle at 80% 10%,
      rgba(28, 161, 193, 0.07),
      transparent 30%
    ),
    #f7f8fa;
}

.move-page {
  min-height: 100vh;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.92),
    rgba(237, 242, 255, 0.65)
  );
}

.move-card {
  border-radius: 18px;
  border: none;
  background: rgba(255, 255, 255, 0.95);
  box-shadow:
    0 15px 45px rgba(15, 23, 42, 0.08),
    0 3px 12px rgba(15, 23, 42, 0.05);
}

.move-card .text-h6 {
  font-weight: 600;
  color: #1f2a44;
}

.move-card .text-caption {
  color: #64748b;
}

.move-card .q-field__control {
  border-radius: 12px;
  min-height: 52px;
}

.move-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.session-timeline {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
  padding: 12px 8px;
  border-radius: 16px;
  overflow: hidden;
  position: relative;
}

.timeline-node {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1);
  border-radius: 999px;
  cursor: pointer;
  position: relative;
  background: rgba(42, 68, 156, 0.1);
  border: 1px solid transparent;
  width: 12px;
  height: 12px;
  padding: 0;
  margin: 0 4px;
}

.timeline-node.complete {
  background: rgba(33, 186, 69, 0.2);
}

.timeline-node.adjacent {
  width: 32px;
  height: 32px;
  background: #fff;
  border-color: rgba(42, 68, 156, 0.2);
  color: #1b2a5b;
}

.timeline-node.adjacent-secondary {
  width: 20px;
  height: 20px;
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(42, 68, 156, 0.2);
  color: #1b2a5b;
}

.timeline-node.active {
  flex-grow: 1;
  min-width: 120px;
  height: 38px;
  padding: 0 16px;
  background: #2a449c;
  color: #fff;
  border-color: transparent;
  box-shadow: 0 4px 12px rgba(42, 68, 156, 0.25);
  margin: 0 6px;
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
  font-size: 0.85rem;
  font-weight: 700;
}

.node-number--secondary {
  font-size: 0.7rem;
  opacity: 0.8;
}

.node-label {
  font-size: 0.95rem;
  font-weight: 600;
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
    opacity 0.2s ease,
    transform 0.2s ease;
}

.timeline-expand-enter-from,
.timeline-expand-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}

.manual-action {
  font-size: 0.8rem;
}

.scan-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fab-button {
  width: 100%;
  padding: 16px 24px;
  font-size: 1rem;
  font-weight: 700;
  border-radius: 999px;
  background: linear-gradient(135deg, #4cc5ff, #1bb1f7);
  color: #fff;
  box-shadow: 0 12px 30px rgba(27, 177, 247, 0.35);
  display: flex;
  justify-content: center;
  align-items: center;
  text-transform: none;
  position: relative;
  overflow: hidden;
}

.fab-button :deep(.q-btn__content) {
  gap: 8px;
}

.fab-button :deep(.q-icon) {
  font-size: 24px;
}

.fab-button::after {
  content: "";
  position: absolute;
  inset: -40%;
  background:
    radial-gradient(
      circle at 15% 20%,
      rgba(255, 255, 255, 0.45),
      transparent 60%
    ),
    radial-gradient(
      circle at 50% 0%,
      rgba(255, 255, 255, 0.35),
      transparent 65%
    ),
    radial-gradient(
      circle at 65% 75%,
      rgba(255, 255, 255, 0.3),
      transparent 70%
    ),
    radial-gradient(
      circle at 85% 35%,
      rgba(255, 255, 255, 0.2),
      transparent 70%
    );
  animation: sparkleDrift 6s linear infinite;
  pointer-events: none;
}

.fab-button:hover {
  box-shadow: 0 18px 40px rgba(27, 177, 247, 0.45);
}

@keyframes sparkleDrift {
  0% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
  100% {
    transform: translateY(0);
  }
}

.scan-toast-dialog :deep(.q-dialog__inner--bottom) {
  padding: 0;
  justify-content: flex-end;
}

.scan-toast-dialog :deep(.q-dialog__backdrop) {
  background: rgba(9, 11, 25, 0.65);
}

.scan-toast {
  width: 100vw;
  max-width: 480px;
  min-height: 75vh;
  border-radius: 28px 28px 0 0;
  background: linear-gradient(165deg, #5374f0 0%, #a3c8ff 55%, #f9fbff 105%);
  padding: 24px;
  box-shadow:
    0 -18px 40px rgba(17, 24, 39, 0.25),
    0 -6px 18px rgba(17, 24, 39, 0.25);
  position: relative;
  overflow: hidden;
  color: #fff;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.scan-toast__glow {
  position: absolute;
  inset: -35%;
  background:
    radial-gradient(
      18px 18px at 25% 25%,
      rgba(255, 255, 255, 0.65),
      transparent 70%
    ),
    radial-gradient(
      24px 24px at 70% 20%,
      rgba(255, 255, 255, 0.45),
      transparent 75%
    ),
    radial-gradient(
      14px 14px at 55% 85%,
      rgba(255, 255, 255, 0.35),
      transparent 70%
    );
  opacity: 0.8;
  animation: sparkleDrift 8s linear infinite;
  pointer-events: none;
  mix-blend-mode: screen;
}

.scan-toast__handle {
  width: 56px;
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.5);
  margin: 0 auto;
}

.scan-toast__header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  position: relative;
  z-index: 1;
}

.scan-toast__close {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 2;
}

.scan-toast__eyebrow {
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.2em;
  opacity: 0.75;
  margin-bottom: 4px;
}

.scan-toast__title {
  font-size: 1.5rem;
  font-weight: 700;
}

.scan-toast__subtitle {
  font-size: 0.95rem;
  opacity: 0.8;
  margin-top: 4px;
}

.scan-preview-window {
  border-radius: 24px;
  padding: 0;
  min-height: 240px;
  position: relative;
  z-index: 1;
}

.scan-video-wrapper {
  position: relative;
  width: 100%;
  min-height: 240px;
  border-radius: 24px;
  overflow: hidden;
  background: rgba(7, 11, 30, 0.35);
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
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  font-weight: 600;
  letter-spacing: 0.04em;
  opacity: 0.9;
  padding: 6px 18px;
  border-radius: 999px;
  background: rgba(7, 11, 30, 0.7);
}

.scan-controls {
  display: flex;
  justify-content: flex-end;
}

.scan-selection {
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.18);
  border-radius: 16px;
  padding: 12px 16px;
  color: #0d1f4a;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 1;
}

.selection-label {
  font-size: 0.75rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  opacity: 0.7;
}

.selection-value {
  font-size: 1.1rem;
  font-weight: 600;
}

.scan-manifest-picker {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 1;
}

.manifest-toggle {
  text-transform: none;
  font-weight: 600;
  align-self: flex-start;
}

.manifest-select {
  border-radius: 12px;
  overflow: hidden;
}

.manifest-fade-enter-active,
.manifest-fade-leave-active {
  transition: opacity 0.2s ease;
}

.manifest-fade-enter-from,
.manifest-fade-leave-to {
  opacity: 0;
}

.scan-toast__actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
  z-index: 1;
}

.scan-action {
  width: 100%;
  font-weight: 600;
  border-radius: 16px;
  padding: 14px 18px;
  text-transform: none;
}

.scan-action--primary {
  background: #101c3d;
  color: #fff;
  box-shadow: 0 14px 25px rgba(16, 28, 61, 0.35);
}

.scan-action--secondary {
  background: rgba(255, 255, 255, 0.9);
  color: #14224b;
  border: 1px solid rgba(255, 255, 255, 0.65);
}

.scan-action--secondary:disabled {
  opacity: 0.6;
}

</style>
