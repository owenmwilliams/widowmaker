<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuasar } from "quasar";
import QRCode from "qrcode";

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    qrUrl?: string | null;
    generating?: boolean;
    actionLabel?: string;
  }>(),
  {
    title: "QR Code",
    description: "",
    qrUrl: null,
    generating: false,
    actionLabel: "Generate QR Code",
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
        <div v-if="description" class="text-caption text-grey-7">
          {{ description }}
        </div>
      </div>
      <q-btn
        color="primary"
        outline
        :label="buttonLabel"
        :loading="generating"
        @click="emit('generate')"
      />
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
        <div class="text-caption text-grey-7 text-center q-mt-sm">
          Print or place this QR on the box/item. Scanning routes directly to
          the inventory.
        </div>
      </div>
      <div v-else class="qr-card__empty">
        <q-icon name="qr_code_2" size="48px" color="grey-5" />
        <div v-if="qrError" class="text-negative text-caption q-mt-sm">
          {{ qrError }}
        </div>
        <div v-else class="text-caption text-grey-6 q-mt-sm">
          Assign a QR code to quickly check this record in the field.
        </div>
      </div>
    </q-card-section>
  </q-card>

  <q-dialog v-model="showLinkDialog" persistent>
    <q-card style="min-width: 340px; max-width: 420px">
      <q-card-section>
        <div class="text-subtitle1">Link Existing QR</div>
        <div class="text-caption text-grey-7">
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
          <q-btn flat color="grey-7" dense label="Stop" @click="stopScanner" />
        </div>
        <q-input
          v-model="manualValue"
          label="Or paste QR link / token"
          dense
          class="q-mt-md"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" color="grey-7" @click="showLinkDialog = false" />
        <q-btn color="primary" label="Link QR" @click="handleAssignManual" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.qr-card {
  border-radius: 16px;
  background: linear-gradient(180deg, #f9fbff 0%, #ffffff 80%);
}

.qr-card__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.2em;
  font-size: 0.65rem;
  color: #3b5ccc;
  margin-bottom: 4px;
}

.qr-card__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.qr-card__image {
  width: 180px;
  height: 180px;
  object-fit: contain;
  padding: 12px;
  border-radius: 12px;
  background: white;
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08);
}

.qr-card__link {
  width: 100%;
  background: rgba(15, 23, 42, 0.05);
  border-radius: 999px;
  padding-left: 16px;
}

.qr-card__empty {
  min-height: 160px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.03);
  border-radius: 12px;
}

.scanner-window {
  position: relative;
  width: 100%;
  height: 220px;
  border-radius: 16px;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.1);
}

.scanner-window video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scanner-overlay {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.4);
  padding: 4px 12px;
  border-radius: 999px;
  color: #fff;
}
</style>
