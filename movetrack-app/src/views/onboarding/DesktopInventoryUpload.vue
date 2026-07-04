<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { API_BASE_URL } from "../../config/api";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { inventoryStore } from "../../stores/InventoryStore";
import { onboardingStore } from "../../stores/OnboardingStore";

type ImportFieldKey =
  | "name"
  | "quantity"
  | "room"
  | "container"
  | "description"
  | "notes"
  | "material"
  | "primary_color"
  | "weight"
  | "length"
  | "width"
  | "height"
  | "ignore";

interface ParsedRecord {
  rowNumber: number;
  name?: string;
  quantity?: string;
  room?: string;
  container?: string;
  description?: string;
  notes?: string;
  material?: string;
  primary_color?: string;
  weight?: string;
  length?: string;
  width?: string;
  height?: string;
}

const emit = defineEmits<{ "app:loading": (value: boolean) => void }>();
emit("app:loading", false);

const router = useRouter();
const $q = useQuasar();
const store = inventoryStore();
const onboarding = onboardingStore();
const isMobile = $q.platform.is.mobile === true;

const core_url = API_BASE_URL;

const step = ref(1);
const dropActive = ref(false);
const isParsing = ref(false);
const fileError = ref("");
const fileMeta = ref<{ name: string; size: number; rows: number } | null>(null);
const headers = ref<string[]>([]);
const rows = ref<string[][]>([]);
const columnMappings = ref<Record<string, ImportFieldKey | null>>({});
const roomAssignments = ref<Record<string, string>>({});
const selectedLocationId = ref<string | null>(onboarding.locationId || null);
const isImporting = ref(false);

const fileInput = ref<HTMLInputElement | null>(null);
const userId = ref<string | null>(null);

const FIELD_DEFS: Array<{
  key: Exclude<ImportFieldKey, "ignore">;
  label: string;
  required?: boolean;
  examples: string[];
}> = [
  {
    key: "name",
    label: "Item name",
    required: true,
    examples: ["name", "item", "item name", "title"],
  },
  { key: "quantity", label: "Quantity", examples: ["qty", "quantity", "count"] },
  {
    key: "room",
    label: "Room / collection",
    required: true,
    examples: ["room", "collection", "space", "location"],
  },
  { key: "container", label: "Container / box", examples: ["box", "container"] },
  { key: "description", label: "Description", examples: ["description", "details"] },
  { key: "notes", label: "Notes", examples: ["notes", "comments", "remarks"] },
  { key: "material", label: "Material", examples: ["material"] },
  { key: "primary_color", label: "Primary color", examples: ["color", "colour"] },
  { key: "weight", label: "Weight (lbs)", examples: ["weight", "lbs", "pounds"] },
  { key: "length", label: "Length (in)", examples: ["length"] },
  { key: "width", label: "Width (in)", examples: ["width"] },
  { key: "height", label: "Height (in)", examples: ["height"] },
];

const fieldOptions = computed(() =>
  FIELD_DEFS.map((f) => ({ label: f.label, value: f.key })).concat({
    label: "Ignore column",
    value: "ignore",
  }),
);

const collectionsForLocation = computed(() => {
  const map = new Map<string, { label: string; value: string }>();
  (onboarding.selectedRooms || []).forEach((room) => {
    const label = room?.trim();
    if (!label) return;
    const key = label.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { label, value: label });
    }
  });
  if (selectedLocationId.value) {
    store.collections
      .filter((col) => col.location === selectedLocationId.value)
      .forEach((col) => {
        if (!col?.label) return;
        const key = col.label.trim().toLowerCase();
        if (!map.has(key)) {
          map.set(key, { label: col.label, value: col.label });
        }
      });
  }
  return Array.from(map.values());
});

const formatLocationSubtitle = () => {
  const parts = [onboarding.locationAddress, onboarding.locationCity, onboarding.locationState, onboarding.locationZip]
    .map((value) => value?.trim())
    .filter(Boolean);
  return parts.join(", ");
};

const locationOptions = computed(() => {
  const options = store.locations.map((loc) => ({
    label: loc.label,
    value: loc.value,
    subtitle: loc.address || "",
  }));
  const storedId = onboarding.locationId;
  if (storedId) {
    const exists = options.some((opt) => String(opt.value) === String(storedId));
    if (!exists) {
      options.unshift({
        label: onboarding.locationName || "Primary location",
        value: storedId,
        subtitle: formatLocationSubtitle(),
      });
    }
  } else if (!options.length && onboarding.locationName) {
    options.push({
      label: onboarding.locationName,
      value: "draft-location",
      subtitle: formatLocationSubtitle(),
    });
  }
  return options;
});

const selectedLocation = computed(() => {
  return locationOptions.value.find((loc) => loc.value === selectedLocationId.value) || null;
});

const mappedRoomValues = computed(() => {
  const output = new Set<string>();
  Object.values(roomAssignments.value).forEach((value) => {
    if (value) {
      output.add(value.trim());
    }
  });
  return output;
});

const columnPreviews = computed(() => {
  const previews: Record<string, string> = {};
  headers.value.forEach((header, index) => {
    const values = rows.value
      .map((row) => row[index] || "")
      .filter((text) => text && text.trim().length)
      .slice(0, 3)
      .map((text) => text.trim());
    previews[header] = values.join(", ");
  });
  return previews;
});

const requiredFieldsComplete = computed(() => {
  const assigned = Object.values(columnMappings.value);
  return (
    assigned.includes("name") &&
    assigned.includes("room")
  );
});

const roomColumnIndex = computed(() => {
  const header = headers.value.find((h) => columnMappings.value[h] === "room");
  if (!header) return -1;
  return headers.value.indexOf(header);
});

const uniqueRooms = computed(() => {
  const index = roomColumnIndex.value;
  if (index === -1) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  rows.value.forEach((row) => {
    const raw = (row[index] || "").trim();
    if (raw && !seen.has(raw)) {
      seen.add(raw);
      values.push(raw);
    }
  });
  return values;
});

const preparedItems = computed(() => buildImportRecords());

const importSummary = computed(() => {
  const total = preparedItems.value.length;
  const rooms = mappedRoomValues.value.size;
  return { total, rooms };
});

watch(uniqueRooms, (list) => {
  const map: Record<string, string> = { ...roomAssignments.value };
  list.forEach((room) => {
    if (!map[room]) {
      const match = bestCollectionMatch(room);
      map[room] = match || (shouldAutoAddRoom(room) ? room : "");
    }
  });
  Object.keys(map).forEach((key) => {
    if (!list.includes(key)) {
      delete map[key];
    }
  });
  roomAssignments.value = map;
});

watch(locationOptions, (options) => {
  if (selectedLocationId.value || !options.length) return;
  selectedLocationId.value = options[0].value;
}, { immediate: true });

watch(
  () => onboarding.locationId,
  (value) => {
    if (value) {
      selectedLocationId.value = value;
    }
  },
);

const normalizeText = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const levenshtein = (a: string, b: string) => {
  if (a === b) return 0;
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
};

const similarityScore = (a: string, b: string) => {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (!normA || !normB) return 0;
  const distance = levenshtein(normA, normB);
  return 1 - distance / Math.max(normA.length, normB.length);
};

const bestCollectionMatch = (roomLabel: string) => {
  const candidates = collectionsForLocation.value.map((col) => col.label);
  let best: { label: string; score: number } | null = null;
  candidates.forEach((label) => {
    const score = similarityScore(roomLabel, label);
    if (!best || score > best.score) {
      best = { label, score };
    }
  });
  if (best && best.score >= 0.45) {
    return best.label;
  }
  return null;
};

const addRoomLabel = (room: string) => {
  const locationName = selectedLocation.value?.label || "this location";
  return `Add "${room}" to ${locationName}`;
};

const shouldAutoAddRoom = (roomLabel: string) => {
  const normalizedRoom = roomLabel.trim().toLowerCase();
  const matchedCollection = collectionsForLocation.value.find(
    (collection) => collection.label.trim().toLowerCase() === normalizedRoom,
  );
  return !matchedCollection;
};

const autoAssignField = (header: string): ImportFieldKey => {
  const candidates = FIELD_DEFS.map((field) => {
    const comparisons = [field.label, ...field.examples];
    const score = Math.max(
      ...comparisons.map((text) => similarityScore(header, text)),
    );
    return {
      key: field.key,
      score,
    };
  });
  const best = candidates.reduce(
    (prev, current) => (current.score > prev.score ? current : prev),
    { key: "ignore" as ImportFieldKey, score: 0 },
  );
  return best.score >= 0.55 ? best.key : "ignore";
};

const resetWizard = () => {
  step.value = 1;
  fileMeta.value = null;
  headers.value = [];
  rows.value = [];
  columnMappings.value = {};
  roomAssignments.value = {};
};

const parseCsvLine = (line: string) => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((cell) => cell.replace(/\r/g, ""));
};

const parseCsvText = (text: string) => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length);
  if (!lines.length) {
    return { headers: [], rows: [] };
  }
  const parsedHeaders = parseCsvLine(lines[0]).map((h) => h.trim());
  const parsedRows = lines
    .slice(1)
    .map((line) => parseCsvLine(line))
    .filter((row) => row.some((cell) => cell.trim().length));
  return { headers: parsedHeaders, rows: parsedRows };
};

const handleFiles = async (files: FileList | null) => {
  if (!files || !files.length) return;
  const file = files[0];
  fileError.value = "";
  if (!file.name.toLowerCase().endsWith(".csv")) {
    fileError.value = "Please upload a CSV file.";
    return;
  }

  isParsing.value = true;
  try {
    const text = await file.text();
    const parsed = parseCsvText(text);
    if (!parsed.headers.length) {
      fileError.value = "No headers detected. Check your CSV.";
      return;
    }
    headers.value = parsed.headers;
    rows.value = parsed.rows;
    columnMappings.value = parsed.headers.reduce((acc, header) => {
      acc[header] = autoAssignField(header);
      return acc;
    }, {} as Record<string, ImportFieldKey | null>);
    fileMeta.value = {
      name: file.name,
      size: file.size,
      rows: parsed.rows.length,
    };
    step.value = 2;
  } catch (error) {
    console.error("Failed to parse CSV", error);
    fileError.value = "Unable to read that file. Please try again.";
  } finally {
    isParsing.value = false;
  }
};

const handleDrop = (event: DragEvent) => {
  event.preventDefault();
  dropActive.value = false;
  if (event.dataTransfer) {
    handleFiles(event.dataTransfer.files);
  }
};

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement | null;
  handleFiles(target?.files ?? null);
};

const goToMapping = () => {
  if (requiredFieldsComplete.value) {
    step.value = 3;
  }
};

const goToReview = () => {
  const hasUnassigned = uniqueRooms.value.some(
    (room) => room && !roomAssignments.value[room]?.trim(),
  );
  if (hasUnassigned) {
    $q.notify({
      type: "warning",
      message: "Assign every CSV room to a collection before reviewing.",
    });
    return;
  }
  if (preparedItems.value.length && selectedLocationId.value) {
    step.value = 4;
  }
};

const numericValue = (text?: string | null) => {
  if (!text) return null;
  const normalized = text.replace(/[^0-9.\-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildImportRecords = (): ParsedRecord[] => {
  if (!headers.value.length) return [];
  const mapping = columnMappings.value;
  const mapped: ParsedRecord[] = [];

  rows.value.forEach((row, rowIndex) => {
    const record: ParsedRecord = { rowNumber: rowIndex + 2 };
    headers.value.forEach((header, columnIndex) => {
      const field = mapping[header];
      if (!field || field === "ignore") {
        return;
      }
      const value = row[columnIndex]?.trim() ?? "";
      if (!value) return;
      switch (field) {
        case "name":
          record.name = value;
          break;
        case "quantity":
          record.quantity = value;
          break;
        case "room":
          record.room = roomAssignments.value[value] || value;
          break;
        case "container":
          record.container = value;
          break;
        case "description":
          record.description = value;
          break;
        case "notes":
          record.notes = value;
          break;
        case "material":
          record.material = value;
          break;
        case "primary_color":
          record.primary_color = value;
          break;
        case "weight":
          record.weight = value;
          break;
        case "length":
          record.length = value;
          break;
        case "width":
          record.width = value;
          break;
        case "height":
          record.height = value;
          break;
        default:
          break;
      }
    });

    if (record.name && record.room) {
      mapped.push(record);
    }
  });

  return mapped;
};

const startImport = async () => {
  if (!preparedItems.value.length) {
    return;
  }

  isImporting.value = true;
  try {
    const itemsPayload = preparedItems.value.map((item) => {
      const qty = item.quantity ? Number(item.quantity) : null;
      return {
        rowNumber: item.rowNumber,
        name: item.name,
        quantity: Number.isFinite(qty) && qty && qty > 0 ? qty : 1,
        room: item.room,
        container: item.container,
        description: item.description,
        notes: item.notes,
        material: item.material,
        primary_color: item.primary_color,
        weight_lbs: numericValue(item.weight),
        length_in: numericValue(item.length),
        width_in: numericValue(item.width),
        height_in: numericValue(item.height),
      };
    });

    onboarding.setImportDraft({
      items: itemsPayload,
      rooms: Array.from(mappedRoomValues.value),
      source: "csv",
      created_at: new Date().toISOString(),
    });

    const summary = {
      summary: {
        created_items: itemsPayload.length,
        created_collections: mappedRoomValues.value.size,
        created_containers: 0,
      },
    };

    if (typeof window !== "undefined") {
      sessionStorage.setItem("onboarding_import_summary", JSON.stringify(summary));
    }

    $q.notify({
      type: "positive",
      message: "Import queued. Finish onboarding to create these items.",
    });

    router.push({ name: "onboarding-next" });
  } catch (error) {
    console.error("Queue import failed", error);
    $q.notify({
      type: "negative",
      message: "Unable to queue import. Please try again.",
    });
  } finally {
    isImporting.value = false;
  }
};

const downloadTemplate = () => {
  const sample = [
    "Item Name,Quantity,Room,Container,Description,Notes",
    "Decorative lamp,1,Living Room,Box A,Bronze lamp with shade,Fragile",
    "Barstool,2,Kitchen,,Wood & metal stools,",
  ].join("\n");
  const blob = new Blob([sample], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "reloprep_template.csv";
  link.click();
  URL.revokeObjectURL(link.href);
};

onMounted(async () => {
  if (typeof window !== "undefined") {
    try {
      const stored = JSON.parse(localStorage.getItem("user_data") || "{}");
      userId.value = stored?.user_id || stored?.userId || null;
      const preferredLocation =
        localStorage.getItem("desktop_onboarding_location_id");
      if (preferredLocation) {
        selectedLocationId.value = preferredLocation;
      }
    } catch (error) {
      console.warn("Unable to parse user_data", error);
    }
  }

  if (userId.value) {
    await store.loadInventory(userId.value);
  }

  // Ensure selectedLocationId is set if not already set
  if (!selectedLocationId.value && locationOptions.value.length > 0) {
    selectedLocationId.value = locationOptions.value[0].value;
  }
});
</script>

<template>
  <q-layout view="lHh Lpr lFf">
    <q-page-container>
      <q-page :class="['onboarding-page', { 'onboarding-page--mobile': isMobile }]">
        <div :class="['onboarding-card', { 'onboarding-card--mobile': isMobile }]">
          <div class="eyebrow">Step 3 of 4</div>
          <h2>Upload your inventory file</h2>
          <p class="lede">
            Drop in a CSV, let us auto-map the columns, and choose which rooms to create.
          </p>

          <div class="step-indicator">
            <div :class="['step-dot', { active: step === 1 || step > 1 }]">
              1<span>Upload</span>
            </div>
            <div class="step-connector" />
            <div :class="['step-dot', { active: step === 2 || step > 2 }]">
              2<span>Map columns</span>
            </div>
            <div class="step-connector" />
            <div :class="['step-dot', { active: step === 3 || step > 3 }]">
              3<span>Collections / rooms</span>
            </div>
            <div class="step-connector" />
            <div :class="['step-dot', { active: step === 4 }]">
              4<span>Review &amp; import</span>
            </div>
          </div>

          <div v-if="step === 1" class="panel">
            <div class="panel-header">
              <div class="panel-title">Upload CSV</div>
              <q-btn flat label="Download template" dense icon="file_download" @click="downloadTemplate" />
            </div>
            <div
              class="drop-card"
              :class="{ 'drop-card--active': dropActive }"
              @dragover.prevent="dropActive = true"
              @dragleave.prevent="dropActive = false"
              @drop="handleDrop"
            >
              <q-icon name="cloud_upload" size="56px" color="primary" />
              <div class="drop-text">Drop CSV here or browse</div>
              <div class="drop-sub">Only .csv files are supported</div>
              <q-btn
                class="q-mt-md"
                color="primary"
                outline
                label="Choose file"
                @click="fileInput?.click()"
              />
              <input
                ref="fileInput"
                type="file"
                accept=".csv,text/csv"
                class="hidden-input"
                @change="handleFileChange"
              />
            </div>
            <div v-if="fileError" class="error-text">{{ fileError }}</div>
          </div>

          <div v-else-if="step === 2" class="panel">
            <div class="panel-header">
              <div class="panel-title">Column mapping</div>
              <div class="panel-subtitle">
                Confirm each CSV column. We already guessed the likely matches.
              </div>
            </div>
            <div class="mapping-grid">
              <div
                v-for="header in headers"
                :key="header"
                class="mapping-row"
              >
                <div class="mapping-col">
                  <div class="mapping-header">{{ header }}</div>
                  <div class="mapping-preview">
                    {{ columnPreviews[header] || "No sample" }}
                  </div>
                </div>
                <q-select
                  outlined
                  dense
                  :model-value="columnMappings[header]"
                  :options="fieldOptions"
                  emit-value
                  map-options
                  @update:model-value="columnMappings[header] = $event as ImportFieldKey"
                />
              </div>
            </div>
            <div
              v-if="!requiredFieldsComplete"
              class="warning"
            >
              Assign both “Item name” and “Room / collection” before continuing.
            </div>
            <div class="actions">
              <q-btn flat label="Back" color="grey-7" @click="resetWizard" />
              <q-btn
                class="fab-button fab-pill"
                label="Next"
                icon="arrow_forward"
                :disable="!requiredFieldsComplete"
                @click="goToMapping"
              />
            </div>
          </div>

          <div v-else-if="step === 3" class="panel">
            <div class="panel-header">
              <div class="panel-title">Collections &amp; rooms</div>
              <div class="panel-subtitle">
                We’ll add or match rooms/collections under your primary location. Map each CSV value below.
              </div>
            </div>

            <div class="location-chip">
              <div class="chip-label">Importing to</div>
              <div class="chip-value">
                {{ selectedLocation?.label || "Primary location" }}
              </div>
              <div class="chip-sub" v-if="selectedLocation?.subtitle">
                {{ selectedLocation.subtitle }}
              </div>
            </div>

            <div v-if="!uniqueRooms.length" class="warning q-mt-lg">
              Assign a “Room / collection” column to continue.
            </div>

            <div v-else class="room-mapping">
            <div
              v-for="room in uniqueRooms"
              :key="room"
              class="room-row"
            >
      <div class="room-label">
        <div class="room-original">{{ room }}</div>
        <div class="room-sub">CSV value</div>
      </div>
      <div>
                <q-select
                  dense
                  outlined
                  :model-value="roomAssignments[room]"
                  :options="[
            ...collectionsForLocation,
            { label: addRoomLabel(room), value: room }
          ]"
                  emit-value
                  map-options
                  placeholder="Select collection"
                  @update:model-value="roomAssignments[room] = $event as string"
        />
        <div
          v-if="!roomAssignments[room]"
          class="warning inline-warning"
        >
          Required
        </div>
      </div>
    </div>
            </div>

            <div class="actions">
              <q-btn flat label="Back" color="grey-7" @click="step = 2" />
              <q-btn
                class="fab-button fab-pill"
                label="Review import"
                icon="arrow_forward"
                :disable="!selectedLocationId || !uniqueRooms.length"
                @click="goToReview"
              />
            </div>
          </div>

          <div v-else-if="step === 4" class="panel">
            <div class="panel-header">
              <div class="panel-title">Review &amp; import</div>
              <div class="panel-subtitle">
                {{ importSummary.total }} items across {{ importSummary.rooms }} rooms will be added to this location.
              </div>
            </div>

            <div class="summary-card">
              <div><strong>File:</strong> {{ fileMeta?.name }}</div>
              <div><strong>Rows detected:</strong> {{ fileMeta?.rows }}</div>
              <div><strong>Ready to import:</strong> {{ importSummary.total }}</div>
              <div>
                <strong>Collections created in:</strong>
                {{ selectedLocation?.label || "Primary location" }}
              </div>
            </div>

            <q-btn
              class="fab-button fab-pill q-mt-md"
              label="Import items"
              icon="cloud_upload"
              :loading="isImporting"
              :disable="!preparedItems.length || !selectedLocationId"
              @click="startImport"
            />
          </div>

          <div v-else class="panel">
            <div class="panel-title">Loading...</div>
          </div>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.onboarding-page {
  min-height: calc(100vh - 56px);
  padding: 32px 16px;
  background: #f1f5f9;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.onboarding-page--mobile {
  padding: 16px;
}

.onboarding-card {
  width: min(60vw, 900px);
  max-width: 900px;
  background: white;
  border-radius: 24px;
  padding: 28px 32px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  margin: 24px auto;
}

.onboarding-card--mobile {
  width: 100%;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  padding: 16px;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.3em;
  font-size: 0.7rem;
  color: #94a3b8;
}

.lede {
  margin: 8px 0 24px;
  color: #475569;
}

.step-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
}

.step-dot {
  width: 120px;
  height: 100px;
  border-radius: 16px;
  border: 1px dashed #cbd5f5;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  font-weight: 700;
  color: #94a3b8;
  font-size: 1.3rem;
  text-align: center;
  padding: 8px;
}

.step-dot span {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-top: 6px;
  line-height: 1.2;
}

.step-dot.active {
  border-color: rgba(59, 83, 255, 0.4);
  color: #274690;
  background: rgba(59, 83, 255, 0.08);
}

.step-connector {
  flex: 1;
  height: 1px;
  background: rgba(59, 83, 255, 0.2);
}

.panel {
  flex: 1;
  margin-top: 12px;
  display: flex;
  flex-direction: column;
}

.panel-header {
  margin-bottom: 16px;
}

.panel-title {
  font-weight: 600;
  font-size: 1.1rem;
}

.panel-subtitle {
  color: #64748b;
  font-size: 0.95rem;
}

.drop-card {
  border: 2px dashed rgba(59, 83, 255, 0.25);
  border-radius: 16px;
  padding: 32px;
  text-align: center;
  background: rgba(59, 83, 255, 0.04);
  transition: border-color 0.2s ease, background 0.2s ease;
}

.drop-card--active {
  border-color: #274690;
  background: rgba(39, 70, 144, 0.08);
}

.drop-text {
  font-weight: 600;
  margin-top: 16px;
}

.drop-sub {
  color: #64748b;
  margin-top: 4px;
}

.hidden-input {
  display: none;
}

.mapping-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.mapping-row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
  padding: 12px 16px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 12px;
}

.mapping-col {
  display: flex;
  flex-direction: column;
}

.mapping-header {
  font-weight: 600;
}

.mapping-preview {
  font-size: 0.85rem;
  color: #475569;
  margin-top: 4px;
}

.warning {
  margin-top: 12px;
  color: #c2410c;
  background: rgba(251, 146, 60, 0.1);
  border-radius: 10px;
  padding: 12px;
}

.room-mapping {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.room-row {
  display: grid;
  grid-template-columns: 2fr 2fr;
  gap: 16px;
  align-items: center;
}

.room-label {
  display: flex;
  flex-direction: column;
}

.room-original {
  font-weight: 600;
}

.room-sub {
  font-size: 0.8rem;
  color: #94a3b8;
}

.inline-add {
  margin-top: 6px;
  font-size: 0.85rem;
  color: #475569;
}

.inline-warning {
  margin-top: 4px;
}

.location-chip {
  margin-top: 8px;
  border: 1px dashed rgba(59, 83, 255, 0.4);
  border-radius: 14px;
  padding: 12px 16px;
  background: rgba(59, 83, 255, 0.05);
}

.chip-label {
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.15em;
  color: #64748b;
}

.chip-value {
  font-weight: 600;
  font-size: 1rem;
  color: #1e1b4b;
}

.chip-sub {
  color: #475569;
  font-size: 0.85rem;
}

.summary-card {
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 12px;
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
  background: rgba(241, 245, 249, 0.6);
}

.success-card {
  margin-top: 24px;
  border-radius: 16px;
  background: rgba(59, 225, 138, 0.12);
  padding: 16px;
}

.success-title {
  font-weight: 600;
  margin-bottom: 12px;
}

.success-grid {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}

.metric {
  font-size: 1.8rem;
  font-weight: 700;
  color: #047857;
}

.metric-label {
  color: #047857;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
}

.success-actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
}

.actions {
  margin-top: auto;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.fab-button {
  box-shadow: 0 8px 20px rgba(39, 70, 144, 0.2);
  background: linear-gradient(135deg, #274690, #1ca1c1, #7dd3fc);
  color: white;
}

.fab-pill {
  border-radius: 999px;
  padding: 12px 26px;
  font-weight: 600;
}

.error-text {
  color: #dc2626;
  margin-top: 10px;
}

@media (max-width: 900px) {
  .mapping-row,
  .room-row {
    grid-template-columns: 1fr;
  }

  .summary-card {
    grid-template-columns: 1fr;
  }

  .success-grid {
    flex-direction: column;
  }
}
</style>
