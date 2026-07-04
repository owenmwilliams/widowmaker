<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuasar } from "quasar";
import QRCode from "qrcode";
import { QrCode as QrCodeIcon } from "lucide-vue-next";

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    qrUrl?: string | null;
    generating?: boolean;
    actionLabel?: string;
  }>(),
  {
    title: "QR code",
    description: "",
    qrUrl: null,
    generating: false,
    actionLabel: "Generate QR code",
  },
);

const emit = defineEmits<{
  (e: "generate"): void;
  (e: "assign", payload: string): void;
}>();

const $q = useQuasar();
const qrPreview = ref<string | null>(null);
const qrError = ref<string | null>(null);
const showLinkDialog = ref(false);
const manualValue = ref("");
const scannerVideo = ref<HTMLVideoElement | null>(null);
const scannerReader = ref<any>(null);
const scannerControls = ref<any>(null);
const scannerActive = ref(false);
const scannerError = ref<string | null>(null);
const lastScannerValue = ref<string | null>(null);

const buttonLabel = computed(() =>
  props.qrUrl ? "Regenerate QR" : props.actionLabel,
);

watch(
  () => props.qrUrl,
  async (url) => {
    if (!url) {
      qrPreview.value = null;
      qrError.value = null;
      return;
    }
    try {
      qrPreview.value = await QRCode.toDataURL(url, {
        width: 256,
        margin: 1,
        color: { dark: "#111827", light: "#FFFFFF" },
      });
      qrError.value = null;
    } catch (error) {
      console.error("Error generating QR preview", error);
      qrPreview.value = null;
      qrError.value = "Unable to render QR preview";
    }
  },
  { immediate: true },
);

const handleCopy = async () => {
  if (!props.qrUrl) {
    return;
  }
  try {
    await navigator.clipboard.writeText(props.qrUrl);
    $q.notify({
      type: "positive",
      message: "QR link copied to clipboard",
      position: "top",
    });
  } catch (error) {
    console.error("Failed to copy QR url", error);
    $q.notify({
      type: "negative",
      message: "Unable to copy QR link",
      position: "top",
    });
  }
};

const stopScanner = () => {
  if (scannerReader.value && typeof scannerReader.value.reset === "function") {
    try {
      scannerReader.value.reset();
    } catch (error) {
      console.warn("Scanner reset failed", error);
    }
  }
  if (scannerControls.value?.stop) {
    try {
      scannerControls.value.stop();
    } catch (error) {
      console.warn("Scanner controls stop failed", error);
    }
  }
  scannerControls.value = null;
  scannerReader.value = null;
  scannerActive.value = false;
  lastScannerValue.value = null;
};

const startScanner = async () => {
  if (scannerActive.value) {
    return;
  }
  if (!scannerVideo.value) {
    return;
  }
  try {
    scannerError.value = null;
    const { BrowserMultiFormatReader } = await import(
      "@zxing/browser"
    );
    scannerReader.value = new BrowserMultiFormatReader();
    scannerActive.value = true;
    console.log("[QrCodeCard] Starting scanner");
    scannerControls.value = await scannerReader.value.decodeFromVideoDevice(
      undefined,
      scannerVideo.value,
      (result, err) => {
        if (result?.getText()) {
          const text = result.getText().trim();
          console.log("[QrCodeCard] Scanner result:", text);
          if (text && text !== lastScannerValue.value) {
            lastScannerValue.value = text;
            console.log("[QrCodeCard] Emitting assign with value:", text);
            emit("assign", text);
            stopScanner();
            $q.notify({
              type: "positive",
              message: "QR captured",
              position: "top",
            });
          }
        } else if (
          err &&
          err.name !== "NotFoundException" &&
          err.name !== "ChecksumException" &&
          err.name !== "FormatException"
        ) {
          scannerError.value = "Unable to read QR code.";
        }
      },
    );
  } catch (error: any) {
    scannerActive.value = false;
    scannerReader.value = null;
    scannerControls.value = null;
    if (error?.name === "NotAllowedError") {
      scannerError.value = "Camera access denied.";
    } else if (error?.name === "NotFoundException") {
      scannerError.value = "No camera detected.";
    } else {
      scannerError.value = "Unable to read a QR code.";
    }
  }
};

watch(showLinkDialog, (open) => {
  if (open) {
    manualValue.value = "";
    lastScannerValue.value = null;
    const tryStart = () => {
      if (!scannerVideo.value) {
        requestAnimationFrame(tryStart);
        return;
      }
      startScanner();
    };
    requestAnimationFrame(tryStart);
  } else {
    scannerError.value = null;
  }
});

const handleAssignManual = () => {
  if (!manualValue.value.trim()) {
    $q.notify({
      type: "warning",
      message: "Paste or scan a QR code first",
      position: "top",
    });
    return;
  }
  const manual = manualValue.value.trim();
  console.log("[QrCodeCard] Manual QR entry:", manual);
  if (manual.length === 0) {
    return;
  }
  lastScannerValue.value = manual;
  console.log("[QrCodeCard] Emitting assign with value:", manual);
  emit("assign", manual);
  stopScanner();
};
</script>

<template>
  <q-card flat bordered class="qr-card">
    <q-card-section class="row items-center justify-between q-col-gutter-sm">
      <div>
        <div class="qr-card__eyebrow">Share via QR</div>
        <div class="text-subtitle1">{{ title }}</div>
        <div v-if="description" class="text-caption text-muted">
          {{ description }}
        </div>
      </div>
      <q-btn
        color="primary"
        flat
        dense
        label="Link existing QR"
        icon="link"
        @click="showLinkDialog = true"
      />
    </q-card-section>
    <q-card-section>
      <div v-if="qrUrl && qrPreview" class="qr-card__content">
        <img :src="qrPreview" alt="QR code preview" class="qr-card__image" />
        <q-input
          dense
          readonly
          borderless
          class="qr-card__link"
          :model-value="qrUrl"
        >
          <template #append>
            <q-btn
              flat
              dense
              round
              icon="content_copy"
              color="primary"
              @click="handleCopy"
            />
          </template>
        </q-input>
        <div class="text-caption text-muted text-center q-mt-sm">
          Print or place this QR on the box/item. Scanning routes directly to
          the inventory.
        </div>
      </div>
      <div v-else class="qr-card__empty">
        <QrCodeIcon :size="48" class="qr-card__empty-icon" />
        <div v-if="qrError" class="text-negative text-caption q-mt-sm">
          {{ qrError }}
        </div>
        <div v-else class="text-caption text-faint q-mt-sm">
          Assign a QR code to quickly check this record in the field.
        </div>
      </div>
    </q-card-section>
  </q-card>

  <q-dialog v-model="showLinkDialog" persistent>
    <q-card style="min-width: 340px; max-width: 420px">
      <q-card-section>
        <div class="text-subtitle1">Link existing QR</div>
        <div class="text-caption text-muted">
          Scan a sticker or paste the URL from a pre-printed QR code.
        </div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <div class="scanner-window">
          <video ref="scannerVideo" autoplay playsinline muted></video>
          <div class="scanner-overlay">
            <span v-if="scannerError" class="text-negative text-caption">
              {{ scannerError }}
            </span>
            <span v-else class="text-caption">
              {{
                scannerActive
                  ? "Align the QR inside the frame"
                  : "Tap restart if you need to rescan"
              }}
            </span>
          </div>
        </div>
        <div class="row items-center justify-between q-mt-sm">
          <q-btn
            flat
            color="primary"
            dense
            icon="autorenew"
            label="Restart scanner"
            @click="startScanner"
          />
          <q-btn flat class="btn-muted" dense label="Stop" @click="stopScanner" />
        </div>
        <q-input
          v-model="manualValue"
          label="Or paste QR link / token"
          dense
          class="q-mt-md"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" class="btn-muted" @click="showLinkDialog = false" />
        <q-btn color="primary" label="Link QR" @click="handleAssignManual" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.qr-card {
  border-radius: var(--r-lg);
  background: var(--surface-card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
}

.qr-card__eyebrow {
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: var(--ls-eyebrow);
  font-size: var(--fs-micro);
  color: var(--accent);
  margin-bottom: var(--sp-2);
}

.text-muted {
  color: var(--text-secondary);
}

.text-faint {
  color: var(--text-tertiary);
}

.btn-muted {
  color: var(--text-secondary);
}

.qr-card__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
}

.qr-card__image {
  width: 180px;
  height: 180px;
  object-fit: contain;
  padding: var(--sp-4);
  border-radius: var(--r-md);
  background: var(--surface-card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
}

.qr-card__link {
  width: 100%;
  background: var(--surface-hover);
  border-radius: var(--r-pill);
  padding-left: var(--sp-5);
  font-family: var(--font-mono);
  font-size: var(--fs-label);
}

.qr-card__empty {
  min-height: 160px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--surface-sunk);
  border-radius: var(--r-md);
}

.qr-card__empty-icon {
  color: var(--text-tertiary);
}

.scanner-window {
  position: relative;
  width: 100%;
  height: 220px;
  border-radius: var(--r-lg);
  overflow: hidden;
  background: var(--surface-hover);
}

.scanner-window video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scanner-overlay {
  position: absolute;
  bottom: var(--sp-3);
  left: 50%;
  transform: translateX(-50%);
  background: color-mix(in oklab, var(--navy-900) 45%, transparent);
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--r-pill);
  color: var(--on-accent);
}
</style>
