<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import axios from "axios";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";

type PipelineStep = {
  id: string;
  label: string;
  provider: string;
  prompt: string;
};

type VisionPipeline = {
  id: string;
  name: string;
  description?: string;
  provider?: string;
  steps: PipelineStep[];
};

type DatasetEntry = {
  id: string;
  imageUrl?: string;
  imageBase64?: string;
  truth?: Record<string, unknown>;
  notes?: string;
};

type Dataset = {
  id: string;
  name: string;
  notes?: string;
  entries: DatasetEntry[];
};

const router = useRouter();
const $q = useQuasar();

const core_url =
  import.meta.env.MODE === "development"
    ? "http://localhost:3050"
    : "https://movetrack-api-7hwn7ggbiq-uc.a.run.app";

const pipelines = ref<VisionPipeline[]>([]);
const datasets = ref<Dataset[]>([]);
const selectedPipelineId = ref<string>("");
const selectedDatasetId = ref<string>("");
const pipelineDraft = ref<VisionPipeline | null>(null);
const datasetDraft = ref<Dataset | null>(null);
const isLoading = ref<boolean>(false);
const loadError = ref<string>("");
const savingPipeline = ref<boolean>(false);
const savingDataset = ref<boolean>(false);
const evaluationLoading = ref<boolean>(false);
const evaluationResult = ref<any>(null);
const evaluationError = ref<string>("");

const runConfig = ref({
  repetitions: 5,
  concurrency: 2,
});

const datasetOptions = computed(() =>
  datasets.value.map((dataset) => ({
    label: dataset.name,
    value: dataset.id,
  })),
);

const selectedPipeline = computed<VisionPipeline | null>(() => pipelineDraft.value);
const selectedDataset = computed<Dataset | null>(() => datasetDraft.value);

const datasetTableRows = computed(() =>
  (selectedDataset.value?.entries || []).map((entry) => ({
    id: entry.id,
    name: entry.truth?.name ?? "—",
    room: entry.truth?.room ?? entry.truth?.collection ?? "—",
    image: entry.imageUrl ?? "",
  })),
);

const evaluationSummary = computed(() => evaluationResult.value?.summary || null);
const fieldMetricRows = computed(() => {
  const summary = evaluationSummary.value;
  if (!summary?.fieldMetrics) return [];
  return Object.entries(summary.fieldMetrics).map(([field, value]) => ({
    field,
    score: typeof value === "number" ? Number(value * 100).toFixed(1) + "%" : "—",
  }));
});
const stepMetricRows = computed(() => evaluationSummary.value?.stepMetrics || []);
const sampleRows = computed(() => evaluationResult.value?.samples || []);

const buildHeaders = () => {
  const token = localStorage.getItem("session_token");
  if (!token) {
    throw new Error("Authorization required. Please log in again.");
  }
  return {
    Authorization: `Bearer ${token}`,
  };
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const syncPipelineDraft = () => {
  const match = pipelines.value.find((pipeline) => pipeline.id === selectedPipelineId.value);
  pipelineDraft.value = match ? clone(match) : null;
};

const syncDatasetDraft = () => {
  const match = datasets.value.find((dataset) => dataset.id === selectedDatasetId.value);
  datasetDraft.value = match ? clone(match) : null;
};

watch(selectedPipelineId, syncPipelineDraft, { immediate: true });
watch(selectedDatasetId, syncDatasetDraft, { immediate: true });

const fetchConfig = async () => {
  isLoading.value = true;
  loadError.value = "";
  try {
    const response = await axios.get(`${core_url}/admin/vision-lab`, {
      headers: buildHeaders(),
    });
    pipelines.value = response.data?.pipelines || [];
    datasets.value = response.data?.datasets || [];
    if (pipelines.value.length && !selectedPipelineId.value) {
      selectedPipelineId.value = pipelines.value[0].id;
    } else {
      syncPipelineDraft();
    }
    if (datasets.value.length && !selectedDatasetId.value) {
      selectedDatasetId.value = datasets.value[0].id;
    } else {
      syncDatasetDraft();
    }
  } catch (error: any) {
    console.error("[VisionLab] Failed to load config", error);
    loadError.value = error?.response?.data?.error || error?.message || "Failed to load configuration.";
  } finally {
    isLoading.value = false;
  }
};

const upsertPipeline = (pipeline: VisionPipeline) => {
  const idx = pipelines.value.findIndex((item) => item.id === pipeline.id);
  if (idx >= 0) {
    pipelines.value.splice(idx, 1, pipeline);
  } else {
    pipelines.value.push(pipeline);
  }
  pipelineDraft.value = clone(pipeline);
};

const upsertDataset = (dataset: Dataset) => {
  const idx = datasets.value.findIndex((item) => item.id === dataset.id);
  if (idx >= 0) {
    datasets.value.splice(idx, 1, dataset);
  } else {
    datasets.value.push(dataset);
  }
  datasetDraft.value = clone(dataset);
};

const savePipeline = async () => {
  if (!pipelineDraft.value) return;
  savingPipeline.value = true;
  try {
    const response = await axios.post(
      `${core_url}/admin/vision-lab/pipelines`,
      { pipeline: pipelineDraft.value },
      { headers: buildHeaders() },
    );
    if (response.data?.pipeline) {
      upsertPipeline(response.data.pipeline);
      $q.notify({ type: "positive", message: "Pipeline saved." });
    }
  } catch (error: any) {
    console.error("[VisionLab] Failed to save pipeline", error);
    $q.notify({
      type: "negative",
      message: error?.response?.data?.error || "Unable to save pipeline.",
    });
  } finally {
    savingPipeline.value = false;
  }
};

const saveDataset = async () => {
  if (!datasetDraft.value) return;
  savingDataset.value = true;
  try {
    const response = await axios.post(
      `${core_url}/admin/vision-lab/datasets`,
      { dataset: datasetDraft.value },
      { headers: buildHeaders() },
    );
    if (response.data?.dataset) {
      upsertDataset(response.data.dataset);
      $q.notify({ type: "positive", message: "Dataset saved." });
    }
  } catch (error: any) {
    console.error("[VisionLab] Failed to save dataset", error);
    $q.notify({
      type: "negative",
      message: error?.response?.data?.error || "Unable to save dataset.",
    });
  } finally {
    savingDataset.value = false;
  }
};

const createPipeline = () => {
  const timestamp = Date.now();
  const pipeline: VisionPipeline = {
    id: `pipeline-${timestamp}`,
    name: "Untitled pipeline",
    description: "",
    provider: "gemini",
    steps: [
      {
        id: `step-${timestamp}`,
        label: "Describe item",
        provider: "gemini",
        prompt: "$VISION_PROMPT",
      },
    ],
  };
  pipelines.value.unshift(pipeline);
  selectedPipelineId.value = pipeline.id;
  pipelineDraft.value = clone(pipeline);
};

const addStep = () => {
  if (!pipelineDraft.value) return;
  const nextStep: PipelineStep = {
    id: `step-${Date.now()}`,
    label: `Step ${pipelineDraft.value.steps.length + 1}`,
    provider: pipelineDraft.value.provider || "gemini",
    prompt: "",
  };
  pipelineDraft.value.steps.push(nextStep);
};

const removeStep = (index: number) => {
  if (!pipelineDraft.value) return;
  if (pipelineDraft.value.steps.length <= 1) {
    $q.notify({ type: "warning", message: "Pipelines must have at least one step." });
    return;
  }
  pipelineDraft.value.steps.splice(index, 1);
};

const startTestRun = async () => {
  if (!selectedPipelineId.value || !selectedDatasetId.value) {
    $q.notify({ type: "warning", message: "Select a pipeline and dataset first." });
    return;
  }
  evaluationLoading.value = true;
  evaluationError.value = "";
  evaluationResult.value = null;
  try {
    const response = await axios.post(
      `${core_url}/admin/vision-lab/run`,
      {
        pipelineId: selectedPipelineId.value,
        datasetId: selectedDatasetId.value,
        repetitions: runConfig.value.repetitions,
      },
      { headers: buildHeaders() },
    );
    evaluationResult.value = response.data;
    $q.notify({ type: "positive", message: "Evaluation complete." });
  } catch (error: any) {
    console.error("[VisionLab] Evaluation failed", error);
    evaluationError.value = error?.response?.data?.error || error?.message || "Evaluation failed.";
    $q.notify({ type: "negative", message: evaluationError.value });
  } finally {
    evaluationLoading.value = false;
  }
};

onMounted(() => {
  fetchConfig();
});
</script>

<template>
  <q-layout view="lHh Lpr lFf">
    <q-page-container>
      <q-page class="vision-lab-page q-pa-md">
        <div class="vision-lab-header">
          <div>
            <div class="eyebrow">Vision Lab</div>
            <h2>Test & iterate computer vision prompts</h2>
            <p class="lede">
              Design pipelines, manage datasets, and run repeated evaluations to dial in pass rates before promoting to
              production.
            </p>
          </div>
          <q-btn color="primary" icon="north_east" label="Back to inventory" flat @click="router.push({ name: 'items' })" />
        </div>

        <q-banner v-if="loadError" inline-actions class="bg-red-1 text-negative q-pa-sm">
          {{ loadError }}
          <template #action>
            <q-btn flat dense label="Retry" @click="fetchConfig" />
          </template>
        </q-banner>

        <div v-if="isLoading" class="flex flex-center q-py-xl">
          <q-spinner color="primary" size="48px" />
        </div>

        <div v-else class="vision-grid">
          <q-card class="lab-card pipeline-card">
            <q-card-section>
              <div class="card-title row items-center justify-between">
                <span>Pipelines</span>
                <q-btn dense outline icon="add" label="New pipeline" @click="createPipeline" />
              </div>
            </q-card-section>
            <q-separator />
            <q-list separator v-if="pipelines.length">
              <q-item
                v-for="pipeline in pipelines"
                :key="pipeline.id"
                clickable
                :active="selectedPipelineId === pipeline.id"
                @click="selectedPipelineId = pipeline.id"
              >
                <q-item-section>
                  <q-item-label class="text-weight-medium">{{ pipeline.name }}</q-item-label>
                  <q-item-label caption>{{ pipeline.steps.length }} steps</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
            <div v-else class="text-caption text-grey-6 q-pa-md">
              No pipelines yet. Create one to get started.
            </div>
          </q-card>

          <q-card class="lab-card editor-card">
            <q-card-section>
              <div class="card-title">Step configuration</div>
              <div v-if="selectedPipeline">
                <div class="row q-col-gutter-md q-mt-sm q-mb-md">
                  <div class="col-6">
                    <q-input filled v-model="selectedPipeline.name" label="Pipeline name" />
                  </div>
                  <div class="col-6">
                    <q-input filled v-model="selectedPipeline.description" label="Description" />
                  </div>
                </div>
                <div
                  v-for="(step, index) in selectedPipeline.steps"
                  :key="step.id"
                  class="step-editor q-mb-md"
                >
                  <div class="row items-center justify-between">
                    <div class="text-weight-medium">
                      {{ index + 1 }}. <q-input
                        dense
                        borderless
                        v-model="step.label"
                        placeholder="Step label"
                        class="step-label-input"
                      />
                    </div>
                    <div class="row items-center q-gutter-sm">
                      <q-select
                        dense
                        filled
                        v-model="step.provider"
                        :options="['together', 'gpt4o', 'gemini']"
                        label="Provider"
                        style="width: 150px"
                      />
                      <q-btn
                        v-if="selectedPipeline.steps.length > 1"
                        dense
                        round
                        flat
                        color="negative"
                        icon="delete"
                        @click="removeStep(index)"
                      />
                    </div>
                  </div>
                  <q-input
                    type="textarea"
                    autogrow
                    filled
                    v-model="step.prompt"
                    label="Prompt"
                    class="q-mt-sm"
                  />
                </div>
                <div class="row items-center justify-between">
                  <q-btn flat color="primary" icon="add" label="Add step" @click="addStep" />
                  <q-btn
                    color="primary"
                    icon="save"
                    label="Save pipeline"
                    :loading="savingPipeline"
                    @click="savePipeline"
                  />
                </div>
              </div>
              <div v-else class="text-grey-6">Select a pipeline to edit steps.</div>
            </q-card-section>
          </q-card>

          <q-card class="lab-card dataset-card">
            <q-card-section>
              <div class="card-title">Ground truth dataset</div>
              <div class="row q-col-gutter-md q-mt-sm">
                <div class="col-6">
                  <q-select
                    filled
                    v-model="selectedDatasetId"
                    :options="datasetOptions"
                    label="Dataset"
                    emit-value
                    map-options
                  />
                </div>
                <div class="col-6">
                  <q-input
                    v-if="selectedDataset"
                    filled
                    v-model="selectedDataset.notes"
                    label="Notes"
                  />
                  <q-input v-else filled disable label="Notes" />
                </div>
              </div>
              <div v-if="selectedDataset" class="row q-col-gutter-md q-mt-sm">
                <div class="col-6">
                  <q-input filled v-model="selectedDataset.name" label="Dataset name" />
                </div>
                <div class="col-6">
                  <q-input filled v-model="selectedDataset.id" label="Identifier" disable />
                </div>
              </div>
              <q-separator class="q-my-md" />
              <div v-if="selectedDataset">
                <div class="text-caption text-grey-6 q-mb-sm">
                  Entries ({{ selectedDataset.entries?.length || 0 }})
                </div>
                <q-table
                  :rows="datasetTableRows"
                  :columns="[
                    { name: 'id', label: 'ID', field: 'id' },
                    { name: 'name', label: 'Name', field: 'name' },
                    { name: 'room', label: 'Room / Collection', field: 'room' },
                  ]"
                  dense
                  flat
                  bordered
                  row-key="id"
                  hide-bottom
                >
                  <template #body-cell-name="props">
                    <q-td :props="props">
                      <div class="text-weight-medium">{{ props.row.name }}</div>
                      <div class="text-caption text-grey-6 ellipsis">{{ props.row.image }}</div>
                    </q-td>
                  </template>
                </q-table>
                <div class="row justify-end q-mt-sm">
                  <q-btn
                    color="primary"
                    outline
                    icon="save"
                    label="Save dataset"
                    :loading="savingDataset"
                    @click="saveDataset"
                  />
                </div>
              </div>
              <div v-else class="text-grey-6 q-mt-md">No dataset selected.</div>
            </q-card-section>
          </q-card>

          <q-card class="lab-card test-run-card">
            <q-card-section>
              <div class="card-title">Test runner</div>
              <div class="row q-col-gutter-md q-mt-sm">
                <div class="col-4">
                  <q-input
                    type="number"
                    filled
                    min="1"
                    max="50"
                    v-model.number="runConfig.repetitions"
                    label="Repetitions"
                  />
                </div>
                <div class="col-4">
                  <q-input
                    type="number"
                    filled
                    min="1"
                    max="10"
                    v-model.number="runConfig.concurrency"
                    label="Concurrency"
                  />
                </div>
                <div class="col-4" v-if="datasetOptions.length">
                  <q-select
                    filled
                    v-model="selectedDatasetId"
                    :options="datasetOptions"
                    label="Dataset"
                    emit-value
                    map-options
                  />
                </div>
              </div>
              <q-btn
                color="primary"
                icon="science"
                :label="evaluationLoading ? 'Running...' : 'Run evaluation'"
                class="q-mt-md"
                :loading="evaluationLoading"
                :disable="!selectedPipelineId || !selectedDatasetId"
                @click="startTestRun"
              />
              <q-banner
                v-if="evaluationError"
                dense
                class="q-mt-md bg-red-1 text-negative"
              >
                {{ evaluationError }}
              </q-banner>
              <div v-if="evaluationSummary" class="q-mt-lg">
                <div class="metrics-grid">
                  <div class="metric-tile">
                    <div class="label">Total samples</div>
                    <div class="value">{{ evaluationSummary.totalSamples }}</div>
                  </div>
                  <div class="metric-tile">
                    <div class="label">Failures</div>
                    <div class="value">{{ evaluationSummary.failures }}</div>
                  </div>
                  <div class="metric-tile">
                    <div class="label">Overall accuracy</div>
                    <div class="value">
                      {{ (evaluationSummary.overallAccuracy * 100).toFixed(1) }}%
                    </div>
                  </div>
                  <div class="metric-tile">
                    <div class="label">Avg run time</div>
                    <div class="value">{{ evaluationSummary.avgRunDurationMs }}ms</div>
                  </div>
                </div>
                <div class="row q-col-gutter-md q-mt-md">
                  <div class="col-12 col-md-6">
                    <q-card flat bordered>
                      <q-card-section class="text-weight-medium">Field accuracy</q-card-section>
                      <q-separator />
                      <q-table
                        :rows="fieldMetricRows"
                        :columns="[
                          { name: 'field', label: 'Field', field: 'field' },
                          { name: 'score', label: 'Accuracy', field: 'score' },
                        ]"
                        dense
                        flat
                        hide-bottom
                        row-key="field"
                      />
                    </q-card>
                  </div>
                  <div class="col-12 col-md-6">
                    <q-card flat bordered>
                      <q-card-section class="text-weight-medium">Step performance</q-card-section>
                      <q-separator />
                      <q-table
                        :rows="stepMetricRows"
                        :columns="[
                          { name: 'label', label: 'Step', field: 'label' },
                          { name: 'avgDurationMs', label: 'Avg ms', field: 'avgDurationMs' },
                          { name: 'successRate', label: 'Pass rate', field: 'successRate' },
                        ]"
                        dense
                        flat
                        hide-bottom
                        row-key="id"
                      >
                        <template #body-cell-successRate="props">
                          <q-td :props="props">
                            {{ (props.row.successRate * 100).toFixed(1) }}%
                          </q-td>
                        </template>
                      </q-table>
                    </q-card>
                  </div>
                </div>
                <div v-if="sampleRows.length" class="q-mt-md">
                  <q-expansion-item label="Sample outputs" dense expand-icon="chevron_right">
                    <q-list bordered separator>
                      <q-item v-for="sample in sampleRows" :key="sample.entryId">
                        <q-item-section>
                          <q-item-label class="text-weight-medium">{{ sample.entryId }}</q-item-label>
                          <q-item-label caption>
                            {{ sample.success ? 'Success' : `Failed: ${sample.error || 'Unknown error'}` }}
                          </q-item-label>
                        </q-item-section>
                        <q-item-section side>
                          <q-badge
                            :label="sample.success ? 'pass' : 'fail'"
                            :color="sample.success ? 'green' : 'red'"
                            align="center"
                          />
                        </q-item-section>
                      </q-item>
                    </q-list>
                  </q-expansion-item>
                </div>
              </div>
            </q-card-section>
          </q-card>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.vision-lab-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.vision-lab-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.3em;
  font-size: 0.7rem;
  color: #94a3b8;
}

.lede {
  margin-top: 8px;
  color: #475569;
}

.vision-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}

.lab-card {
  border-radius: 18px;
  box-shadow: 0 12px 35px rgba(15, 23, 42, 0.08);
}

.pipeline-card {
  grid-row: span 2;
}

.editor-card {
  grid-column: span 2;
}

.card-title {
  font-weight: 600;
  font-size: 1rem;
}

.step-label-input :deep(.q-field__control) {
  padding-left: 0;
  padding-right: 0;
}

.step-editor {
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  padding: 12px;
}

.dataset-card {
  grid-column: span 2;
}

.test-run-card {
  grid-column: span 2;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.metric-tile {
  background: #f1f5f9;
  border-radius: 12px;
  padding: 12px;
}

.metric-tile .label {
  font-size: 0.75rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.metric-tile .value {
  font-size: 1.25rem;
  font-weight: 600;
  margin-top: 4px;
}

@media (max-width: 1024px) {
  .editor-card,
  .dataset-card,
  .test-run-card {
    grid-column: span 1;
  }
}
</style>
