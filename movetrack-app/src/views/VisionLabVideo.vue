<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import axios from 'axios';

type BoundingBox = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type DetectionItemSummary = {
  name: string;
  reasoning?: string;
  confidence?: number;
  boundingBox?: BoundingBox | null;
  samScore?: number;
  refined?: boolean;
};

type ScannedFrame = {
  id: string;
  name: string;
  timestamp: number;
  blurScore: number;
  entropy: number;
  textureScore: number;
  previewUrl: string;
  file: File;
};

type RejectedFrame = {
  id: string;
  timestamp: number;
  blurScore: number;
  entropy: number;
  textureScore: number;
  reason: string;
  previewUrl: string;
};

type FrameAnalysis = {
  id: string;
  frameId: string;
  name: string;
  previewUrl: string;
  items: DetectionItemSummary[];
  reasoning?: string;
  error?: string | null;
  raw?: any;
};

type DedupedItem = {
  id: string;
  name: string;
  occurrences: number;
  confidence: number;
  reasoning: string[];
  frames: string[];
  boundingBoxes: BoundingBox[];
};

type AttributedItem = DedupedItem & {
  category: string;
  fragile: boolean;
  weightLbs: number;
  dimensions: { length: number; width: number; height: number };
  volumeCuft: number;
};

type RunLogEntry = {
  id: string;
  prompt: string;
  startedAt: string;
  totalFrames: number;
  errorFrames: number;
  items: string[];
};

type SamplingBucket = {
  start: number;
  end: number;
  frames: ScannedFrame[];
  selected?: ScannedFrame | null;
};

type StepId = 'sampling' | 'detection' | 'refinement' | 'dedupe' | 'attributes' | 'saving';
type StepState = 'idle' | 'in_progress' | 'completed' | 'error';

const $q = useQuasar();

const core_url =
  import.meta.env.MODE === 'development'
    ? 'http://localhost:3050'
    : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

const sessionId = ref<string | null>(null);
const promptInput = ref('');
const promptLoading = ref(false);

const scannedFrames = ref<ScannedFrame[]>([]);
const frameAnalyses = ref<FrameAnalysis[]>([]);
const samAnalyses = ref<FrameAnalysis[]>([]);
const dedupedItems = ref<DedupedItem[]>([]);
const attributedItems = ref<AttributedItem[]>([]);
const runLogs = ref<RunLogEntry[]>([]);
const saveResult = ref<string | null>(null);
const selectedRejectedId = ref<string | null>(null);
const samplingBuckets = ref<SamplingBucket[]>([]);

const stepStatus = reactive<Record<StepId, { state: StepState; info: string }>>({
  sampling: { state: 'idle', info: 'Awaiting video upload.' },
  detection: { state: 'idle', info: 'Waiting for sampled frames.' },
  refinement: { state: 'idle', info: 'Refine bounding boxes with SAM.' },
  dedupe: { state: 'idle', info: 'Run detection first.' },
  attributes: { state: 'idle', info: 'Generate deduped items first.' },
  saving: { state: 'idle', info: 'Assign attributes before saving.' }
});

const canStartDetection = computed(
  () => sessionId.value && sampledFrames.value.length > 0 && stepStatus.sampling.state === 'completed'
);
const hasDetections = computed(() =>
  frameAnalyses.value.some((analysis) => analysis.items.length)
);
const hasRefinements = computed(() =>
  samAnalyses.value.some((analysis) => analysis.items.length)
);
const canStartDedup = computed(
  () =>
    stepStatus.detection.state === 'completed' &&
    (hasRefinements.value || hasDetections.value)
);
const canStartAttributes = computed(
  () => dedupedItems.value.length > 0 && stepStatus.dedupe.state === 'completed'
);
const canSaveItems = computed(
  () => attributedItems.value.length > 0 && stepStatus.attributes.state === 'completed'
);

const DEFAULT_SAMPLE_INTERVAL_SEC = 1.5;
const MIN_SAMPLE_INTERVAL_SEC = 0.3;
const MAX_SAMPLE_INTERVAL_SEC = 4;
const DEFAULT_SCAN_GRANULARITY_SEC = 0.4;
const MIN_SCAN_GRANULARITY_SEC = 0;
const MAX_SCAN_GRANULARITY_SEC = 2;
const DEFAULT_BLUR_THRESHOLD = 65;

const sampleIntervalSec = ref(DEFAULT_SAMPLE_INTERVAL_SEC);
const blurThreshold = ref(DEFAULT_BLUR_THRESHOLD);
const scanGranularitySec = ref(DEFAULT_SCAN_GRANULARITY_SEC);
const blurMode = ref<'absolute' | 'relative'>('absolute');
const blurPercentile = ref(70);
const nativeFrameDuration = ref(1 / 60);
const videoInputRef = ref<HTMLInputElement | null>(null);
const frameOverlayVisibility = reactive<Record<string, boolean>>({});
const highlightedDetectionId = ref<string | null>(null);
const detectionColors = ['#0ea5e9', '#10b981', '#f97316', '#a855f7', '#ec4899'];

const effectiveSampleInterval = computed(() => {
  const numeric = Number(sampleIntervalSec.value);
  if (!Number.isFinite(numeric)) return DEFAULT_SAMPLE_INTERVAL_SEC;
  return Math.min(MAX_SAMPLE_INTERVAL_SEC, Math.max(MIN_SAMPLE_INTERVAL_SEC, numeric));
});

const effectiveScanGranularity = computed(() => {
  const numeric = Number(scanGranularitySec.value);
  if (!Number.isFinite(numeric)) return DEFAULT_SCAN_GRANULARITY_SEC;
  return Math.min(MAX_SCAN_GRANULARITY_SEC, Math.max(MIN_SCAN_GRANULARITY_SEC, numeric));
});

const displayScanGranularity = computed(() => {
  const value = effectiveScanGranularity.value;
  if (value <= 0) {
    return `Native (~${nativeFrameDuration.value.toFixed(3)}s)`;
  }
  return `${value.toFixed(2)}s`;
});

const textureCutoff = computed(() => {
  if (!scannedFrames.value.length) return blurThreshold.value;
  if (blurMode.value === 'absolute') {
    return blurThreshold.value;
  }
  const sorted = [...scannedFrames.value].sort((a, b) => a.textureScore - b.textureScore);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((blurPercentile.value / 100) * (sorted.length - 1)))
  );
  return sorted[rank]?.textureScore ?? blurThreshold.value;
});

const filteredFrames = computed(() =>
  scannedFrames.value.filter((frame) => frame.textureScore >= textureCutoff.value)
);

const samplingResult = computed(() => {
  const interval = effectiveSampleInterval.value;
  const selected: ScannedFrame[] = [];
  const skippedReasons: Record<string, string> = {};
  const filteredIds = new Set(filteredFrames.value.map((frame) => frame.id));
  const bucketsMap = new Map<number, SamplingBucket>();

  scannedFrames.value.forEach((frame) => {
    const bucketIndex = Math.floor(frame.timestamp / interval);
    if (!bucketsMap.has(bucketIndex)) {
      const start = bucketIndex * interval;
      bucketsMap.set(bucketIndex, { start, end: start + interval, frames: [], selected: null });
    }
    bucketsMap.get(bucketIndex)?.frames.push(frame);
  });

  const bucketEntries: SamplingBucket[] = [];
  const sortedBuckets = Array.from(bucketsMap.keys()).sort((a, b) => a - b);
  sortedBuckets.forEach((bucketIndex) => {
    const bucket = bucketsMap.get(bucketIndex);
    if (!bucket) return;
    const candidates = bucket.frames.filter((frame) => filteredIds.has(frame.id));
    if (!candidates.length) {
      bucket.selected = null;
      bucketEntries.push(bucket);
      return;
    }
    const best = candidates.reduce((current, contender) =>
      contender.textureScore > current.textureScore ? contender : current
    );
    bucket.selected = best;
    selected.push(best);
    candidates.forEach((candidate) => {
      if (candidate.id !== best.id) {
        skippedReasons[candidate.id] = 'Lower texture score within interval';
      }
    });
    bucketEntries.push(bucket);
  });

  selected.sort((a, b) => a.timestamp - b.timestamp);
  samplingBuckets.value = bucketEntries;
  return { selected, skippedReasons };
});

const sampledFrames = computed(() => samplingResult.value.selected);

const rejectedFrames = computed<RejectedFrame[]>(() => {
  const selectedIds = new Set(sampledFrames.value.map((frame) => frame.id));
  return scannedFrames.value
    .filter((frame) => !selectedIds.has(frame.id))
    .map((frame) => ({
      id: frame.id,
      timestamp: frame.timestamp,
      blurScore: frame.blurScore,
      entropy: frame.entropy,
      textureScore: frame.textureScore,
      previewUrl: frame.previewUrl,
      reason:
        frame.textureScore < textureCutoff.value
          ? 'Below texture threshold'
          : samplingResult.value.skippedReasons[frame.id] || 'Not selected'
    }));
});

const rejectedFrameOptions = computed(() =>
  rejectedFrames.value.map((frame) => ({
    label: `t=${frame.timestamp.toFixed(2)}s · blur ${frame.blurScore.toFixed(1)} · ${frame.reason}`,
    value: frame.id
  }))
);

const selectedRejectedFrame = computed(() =>
  rejectedFrames.value.find((frame) => frame.id === selectedRejectedId.value) || null
);

let frameSequence = 0;
let runSequence = 0;

onMounted(loadDefaultPrompt);

const buildHeaders = () => {
  const token = localStorage.getItem('session_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const setStepState = (step: StepId, state: StepState, info?: string) => {
  stepStatus[step].state = state;
  if (info !== undefined) {
    stepStatus[step].info = info;
  }
};

const resetDownstream = (from: StepId) => {
  const order: StepId[] = ['sampling', 'detection', 'refinement', 'dedupe', 'attributes', 'saving'];
  const index = order.indexOf(from);
  order.slice(index).forEach((step) => {
    stepStatus[step].state = 'idle';
  });
  if (from === 'sampling') {
    frameAnalyses.value = [];
    samAnalyses.value = [];
    dedupedItems.value = [];
    attributedItems.value = [];
    saveResult.value = null;
  } else if (from === 'detection') {
    samAnalyses.value = [];
    dedupedItems.value = [];
    attributedItems.value = [];
    saveResult.value = null;
  } else if (from === 'dedupe') {
    attributedItems.value = [];
    saveResult.value = null;
  } else if (from === 'attributes') {
    saveResult.value = null;
  }
};

const resetSampling = () => {
  scannedFrames.value = [];
  selectedRejectedId.value = null;
  samplingBuckets.value = [];
  resetDownstream('sampling');
  if (videoInputRef.value) {
    videoInputRef.value.value = '';
  }
};

async function loadDefaultPrompt() {
  try {
    promptLoading.value = true;
    const response = await axios.get(`${core_url}/vision-lab-video/prompt`, {
      headers: buildHeaders()
    });
    const prompt = response.data?.prompt;
    if (typeof prompt === 'string') {
      promptInput.value = prompt;
    }
  } catch (error) {
    console.error('[VisionLabVideo] Failed to load default prompt', error);
  } finally {
    promptLoading.value = false;
  }
}

const ensurePromptValue = (): string | null => {
  const trimmed = promptInput.value.trim();
  if (!trimmed) {
    $q.notify({ type: 'warning', message: 'Prompt cannot be empty.' });
    return null;
  }
  return trimmed;
};

const startSession = async () => {
  const prompt = ensurePromptValue();
  if (!prompt) return;
  try {
    const response = await axios.post(
      `${core_url}/vision-lab-video/sessions`,
      { prompt },
      { headers: buildHeaders() }
    );
    sessionId.value = response.data?.session_id || null;
    scannedFrames.value = [];
    selectedRejectedId.value = null;
    frameAnalyses.value = [];
    dedupedItems.value = [];
    attributedItems.value = [];
    runLogs.value = [];
    saveResult.value = null;
    if (videoInputRef.value) {
      videoInputRef.value.value = '';
    }
    resetDownstream('sampling');
    if (sessionId.value) {
      stepStatus.sampling.info = 'Upload a video to begin sampling.';
      $q.notify({ type: 'positive', message: 'Session started' });
    }
  } catch (error: any) {
    console.error('[VisionLabVideo] Failed to start session', error);
    $q.notify({
      type: 'negative',
      message: error?.response?.data?.error || 'Unable to start session'
    });
  }
};

const endSession = async () => {
  if (!sessionId.value) return;
  try {
    await axios.post(
      `${core_url}/vision-lab-video/sessions/${sessionId.value}/end`,
      {},
      { headers: buildHeaders() }
    );
    $q.notify({ type: 'info', message: 'Session ended' });
  } catch (error: any) {
    console.error('[VisionLabVideo] Failed to end session', error);
    $q.notify({
      type: 'negative',
      message: error?.response?.data?.error || 'Unable to end session'
    });
  }
};

const handleVideoSelection = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files || !input.files.length) return;
  if (!sessionId.value) {
    $q.notify({ type: 'warning', message: 'Start a session before sampling.' });
    input.value = '';
    return;
  }
  if (scannedFrames.value.length) {
    $q.notify({ type: 'warning', message: 'Reset the session to upload a new video.' });
    input.value = '';
    return;
  }
  const videoFile = Array.from(input.files).find((file) => file.type.startsWith('video/'));
  if (!videoFile) {
    $q.notify({ type: 'warning', message: 'Please select a video file.' });
    input.value = '';
    return;
  }
  await sampleVideoFile(videoFile);
  input.value = '';
};

const triggerVideoUpload = () => {
  if (!sessionId.value || stepStatus.sampling.state === 'in_progress' || scannedFrames.value.length) return;
  videoInputRef.value?.click();
};

const sampleVideoFile = async (file: File) => {
  setStepState('sampling', 'in_progress', 'Scanning video frames for blur...');
  resetDownstream('sampling');
  scannedFrames.value = [];
  selectedRejectedId.value = null;
  try {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = objectUrl;
    video.muted = true;
    video.playsInline = true;

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve(null);
      video.onerror = () => reject(new Error('Failed to load video'));
    });

    const duration = video.duration || 0;
    const granularity = effectiveScanGranularity.value;
    const nativeStep = estimateNativeFrameDuration(video);
    nativeFrameDuration.value = nativeStep;
    const step = granularity > 0 ? granularity : nativeStep;
    const totalSamples = Math.max(1, Math.ceil(duration / step));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');

    for (let i = 0; i < totalSamples; i++) {
      const targetTime = Math.min(duration, i * step);
      await seekVideo(video, targetTime);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blurScore = calculateBlurScore(ctx, canvas.width, canvas.height);
      const entropy = calculateEntropy(ctx, canvas.width, canvas.height);
      const textureScore = blurScore * entropy;
      const previewDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.85)
      );
      if (!blob) continue;
      const frameFile = new File(
        [blob],
        `${file.name.replace(/\.[^/.]+$/, '')}-frame-${String(i).padStart(2, '0')}.jpg`,
        { type: 'image/jpeg' }
      );
      scannedFrames.value.push({
        id: `${Date.now()}-${frameSequence++}`,
        name: frameFile.name,
        timestamp: targetTime,
        blurScore,
        entropy,
        textureScore,
        previewUrl: previewDataUrl,
        file: frameFile
      });
    }
    URL.revokeObjectURL(objectUrl);
    if (!scannedFrames.value.length) {
      setStepState('sampling', 'error', 'Unable to sample frames from video.');
      return;
    }
    const selectedCount = sampledFrames.value.length;
    if (!selectedCount) {
      setStepState(
        'sampling',
        'error',
        'No frames meet the current texture threshold. Lower the threshold and try again.'
      );
      return;
    }
    setStepState(
      'sampling',
      'completed',
      `Selected ${selectedCount} frame(s) out of ${scannedFrames.value.length} scanned (~every ${effectiveSampleInterval.value.toFixed(
        2
      )}s, texture score ≥ ${textureCutoff.value.toFixed(1)}, scan granularity ${
        effectiveScanGranularity.value > 0
          ? `${effectiveScanGranularity.value.toFixed(2)}s`
          : `native ~${nativeFrameDuration.value.toFixed(3)}s`
      }).`
    );
  } catch (error: any) {
    console.error('[VisionLabVideo] Sampling failed', error);
    setStepState('sampling', 'error', error?.message || 'Sampling failed.');
    $q.notify({ type: 'negative', message: 'Failed to sample frames.' });
  }
};

const seekVideo = (video: HTMLVideoElement, time: number) => {
  return new Promise<void>((resolve) => {
    const handler = () => {
      video.removeEventListener('seeked', handler);
      resolve();
    };
    video.addEventListener('seeked', handler, { once: true });
    try {
      video.currentTime = time;
    } catch {
      resolve();
    }
  });
};

const calculateBlurScore = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    gray[i] = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
  }
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const laplacian =
        -4 * gray[idx] +
        gray[idx - 1] +
        gray[idx + 1] +
        gray[idx - width] +
        gray[idx + width];
      sum += laplacian;
      sumSq += laplacian * laplacian;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
};

const calculateEntropy = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const { data } = ctx.getImageData(0, 0, width, height);
  const bins = new Array(32).fill(0);
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    const value = Math.round(
      0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]
    );
    const bin = Math.min(31, Math.floor((value / 256) * 32));
    bins[bin] += 1;
  }
  const total = width * height;
  let entropy = 0;
  bins.forEach((count) => {
    if (count === 0) return;
    const p = count / total;
    entropy -= p * Math.log(p);
  });
  const maxEntropy = Math.log(32);
  return maxEntropy ? entropy / maxEntropy : 0;
};

const estimateNativeFrameDuration = (video: HTMLVideoElement) => {
  if (typeof (video as any).frameRate === 'number' && (video as any).frameRate > 0) {
    return 1 / (video as any).frameRate;
  }
  const quality = video.getVideoPlaybackQuality?.();
  if (quality && quality.totalVideoFrames > 0 && video.duration > 0) {
    return video.duration / quality.totalVideoFrames;
  }
  return 1 / 60;
};

const startFrameAnalysis = async () => {
  if (!canStartDetection.value || !sessionId.value) return;
  const prompt = ensurePromptValue();
  if (!prompt) return;
  setStepState('detection', 'in_progress', 'Analyzing sampled frames...');
  resetDownstream('detection');
  frameAnalyses.value = [];
  samAnalyses.value = [];
  saveResult.value = null;
  try {
    await axios.patch(
      `${core_url}/vision-lab-video/sessions/${sessionId.value}/prompt`,
      { prompt },
      { headers: buildHeaders() }
    );
  } catch (error) {
    console.warn('[VisionLabVideo] Failed to sync prompt before detection', error);
  }
  const runId = beginNewRun(prompt);
  let errorCount = 0;
  for (const frame of sampledFrames.value) {
    const analysis = await analyzeFrame(frame);
    frameAnalyses.value.push(analysis);
    if (frameOverlayVisibility[analysis.id] === undefined) {
      frameOverlayVisibility[analysis.id] = true;
    }
    updateRunWithFrame(runId, analysis);
    if (analysis.error) {
      errorCount++;
    }
  }
  if (frameAnalyses.value.some((analysis) => analysis.items.length)) {
    setStepState(
      'detection',
      'completed',
      `Analyzed ${frameAnalyses.value.length} frame(s). Errors: ${errorCount}.`
    );
  } else {
    setStepState('detection', 'error', 'No items detected in sampled frames.');
  }
};

const analyzeFrame = async (frame: ScannedFrame): Promise<FrameAnalysis> => {
  const formData = new FormData();
  formData.append('frame', frame.file, frame.name);
  formData.append('timestamp_ms', frame.timestamp.toString());
  try {
    const response = await axios.post(
      `${core_url}/vision-lab-video/sessions/${sessionId.value}/frame`,
      formData,
      {
        headers: {
          ...buildHeaders(),
          'Content-Type': 'multipart/form-data'
        }
      }
    );
    const detectionInfo = unwrapDetectionResponse(response.data);
    const parsed = parseDetectionPayload(response.data, detectionInfo);
    return {
      id: `${frame.id}-analysis`,
      frameId: frame.id,
      name: frame.name,
      previewUrl: frame.previewUrl,
      items: parsed.items,
      reasoning: parsed.reasoning,
      error: parsed.error,
      raw: parsed.raw
    };
  } catch (error: any) {
    return {
      id: `${frame.id}-analysis`,
      frameId: frame.id,
      name: frame.name,
      previewUrl: frame.previewUrl,
      items: [],
      error: error?.response?.data?.error || error?.message || 'Detector error'
    };
  }
};

const runSamRefinement = async () => {
  if (!frameAnalyses.value.length || !sessionId.value) {
    $q.notify({ type: 'warning', message: 'Run detection before SAM refinement.' });
    return;
  }
  setStepState('refinement', 'in_progress', 'Refining bounding boxes...');
  samAnalyses.value = [];
  try {
    for (const analysis of frameAnalyses.value) {
      const payload = {
        frameId: analysis.id,
        image: analysis.previewUrl,
        detections: analysis.items.map((item, idx) => ({
          index: idx,
          name: item.name,
          boundingBox: item.boundingBox
        }))
      };
      const response = await axios.post(
        `${core_url}/vision-lab-video/sessions/${sessionId.value}/sam-refine`,
        payload,
        { headers: buildHeaders() }
      );
      const refinedDetections = response.data?.detections || [];
      const refinedItems = analysis.items.map((item, idx) => {
        const refined = refinedDetections[idx];
        if (refined?.boundingBox) {
          return {
            ...item,
            boundingBox: refined.boundingBox,
            samScore: refined.samScore
          };
        }
        return item;
      });
      const refinedAnalysis: FrameAnalysis = {
        ...analysis,
        id: `${analysis.id}-sam`,
        items: refinedItems
      };
      samAnalyses.value.push(refinedAnalysis);
      if (frameOverlayVisibility[refinedAnalysis.id] === undefined) {
        frameOverlayVisibility[refinedAnalysis.id] = true;
      }
    }
    setStepState(
      'refinement',
      'completed',
      `Refined ${samAnalyses.value.length} frame(s) with SAM.`
    );
    $q.notify({ type: 'positive', message: 'SAM refinement complete.' });
  } catch (error: any) {
    console.error('[VisionLabVideo] SAM refinement failed', error);
    setStepState('refinement', 'error', 'SAM refinement failed');
    $q.notify({
      type: 'negative',
      message: error?.response?.data?.error || 'Unable to refine detections.'
    });
  }
};

const startDeduplication = () => {
  if (!canStartDedup.value) return;
  setStepState('dedupe', 'in_progress', 'Evaluating duplicate detections...');
  const sourceAnalyses = samAnalyses.value.length ? samAnalyses.value : frameAnalyses.value;
  const deduped = dedupeDetections(sourceAnalyses);
  dedupedItems.value = deduped;
  if (deduped.length) {
    setStepState('dedupe', 'completed', `Consolidated ${deduped.length} unique item(s).`);
  } else {
    setStepState('dedupe', 'error', 'No items available for deduplication.');
  }
};

const dedupeDetections = (analyses: FrameAnalysis[]): DedupedItem[] => {
  const results: DedupedItem[] = [];
  const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  analyses.forEach((analysis) => {
    if (!analysis.items || analysis.items.length === 0 || analysis.error) return;
    analysis.items.forEach((item) => {
      const key = nameKey(item.name || 'Item');
      const bbox = item.boundingBox || null;
      const match = results.find((candidate) => {
        if (nameKey(candidate.name) !== key) return false;
        if (!bbox || !candidate.boundingBoxes.length) return true;
        return candidate.boundingBoxes.some((existing) => computeIoU(existing, bbox) > 0.5);
      });
      if (match) {
        match.occurrences += 1;
        match.confidence += item.confidence || 0;
        match.frames.push(analysis.name);
        if (bbox) {
          match.boundingBoxes.push(bbox);
        }
        if (item.reasoning) {
          match.reasoning.push(item.reasoning);
        }
      } else {
        results.push({
          id: `dedupe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: item.name || 'Item',
          occurrences: 1,
          confidence: item.confidence || 0,
          reasoning: item.reasoning ? [item.reasoning] : [],
          frames: [analysis.name],
          boundingBoxes: bbox ? [bbox] : []
        });
      }
    });
  });

  return results.map((entry) => ({
    ...entry,
    confidence: entry.confidence / entry.occurrences
  }));
};

const startAttributeAssignment = () => {
  if (!canStartAttributes.value) return;
  setStepState('attributes', 'in_progress', 'Assigning weight and dimensions...');
  attributedItems.value = dedupedItems.value.map((item) => {
    const attributes = inferAttributes(item.name);
    const dimensions = attributes.dimensions;
    const volumeCuft = (dimensions.length * dimensions.width * dimensions.height) / 1728;
    return {
      ...item,
      category: attributes.category,
      fragile: attributes.fragile,
      weightLbs: attributes.weight,
      dimensions,
      volumeCuft: Number(volumeCuft.toFixed(2))
    };
  });
  if (attributedItems.value.length) {
    setStepState('attributes', 'completed', 'Attributes assigned.');
  } else {
    setStepState('attributes', 'error', 'No items available to annotate.');
  }
};

const inferAttributes = (name: string) => {
  const normalized = name.toLowerCase();
  if (/sofa|couch|sectional/.test(normalized)) {
    return { category: 'Furniture', fragile: false, weight: 150, dimensions: { length: 84, width: 34, height: 32 } };
  }
  if (/chair|stool/.test(normalized)) {
    return { category: 'Furniture', fragile: false, weight: 40, dimensions: { length: 28, width: 28, height: 38 } };
  }
  if (/table|desk/.test(normalized)) {
    return { category: 'Furniture', fragile: false, weight: 90, dimensions: { length: 60, width: 30, height: 30 } };
  }
  if (/box|container/.test(normalized)) {
    return { category: 'Container', fragile: false, weight: 10, dimensions: { length: 24, width: 18, height: 18 } };
  }
  if (/vase|glass|ceramic|dish|plate|cup/.test(normalized)) {
    return { category: 'Decor', fragile: true, weight: 5, dimensions: { length: 12, width: 12, height: 18 } };
  }
  if (/tv|monitor|screen|laptop/.test(normalized)) {
    return { category: 'Electronics', fragile: true, weight: 25, dimensions: { length: 40, width: 6, height: 26 } };
  }
  return { category: 'Miscellaneous', fragile: false, weight: 20, dimensions: { length: 24, width: 20, height: 16 } };
};

const saveItemsToInventory = async () => {
  if (!canSaveItems.value || !sessionId.value) return;
  setStepState('saving', 'in_progress', 'Saving items...');
  try {
    const response = await axios.post(
      `${core_url}/vision-lab-video/sessions/${sessionId.value}/save-items`,
      {
        prompt: promptInput.value,
        items: attributedItems.value
      },
      { headers: buildHeaders() }
    );
    const message =
      response.data?.message ||
      response.data?.status ||
      `Saved ${attributedItems.value.length} item(s) to sandbox.`;
    setStepState('saving', 'completed', message);
    saveResult.value = message;
    $q.notify({ type: 'positive', message: 'Items saved (sandbox).' });
  } catch (error: any) {
    console.error('[VisionLabVideo] Failed to save items', error);
    setStepState('saving', 'error', error?.response?.data?.error || 'Save failed');
    $q.notify({
      type: 'negative',
      message: error?.response?.data?.error || 'Unable to save items'
    });
  }
};

const beginNewRun = (prompt: string) => {
  const entry: RunLogEntry = {
    id: `run-${Date.now()}-${runSequence++}`,
    prompt,
    startedAt: new Date().toISOString(),
    totalFrames: 0,
    errorFrames: 0,
    items: []
  };
  runLogs.value = [entry, ...runLogs.value];
  return entry.id;
};

const updateRunWithFrame = (runId: string, analysis: FrameAnalysis) => {
  const entry = runLogs.value.find((run) => run.id === runId);
  if (!entry) return;
  entry.totalFrames += 1;
  if (analysis.error) {
    entry.errorFrames += 1;
  } else if (Array.isArray(analysis.items)) {
    entry.items.push(...analysis.items.map((item) => item.name || 'Item'));
  }
  runLogs.value = [...runLogs.value];
};

const computeIoU = (a?: BoundingBox | null, b?: BoundingBox | null) => {
  if (!a || !b) return 0;
  const ax1 = a.x ?? 0;
  const ay1 = a.y ?? 0;
  const ax2 = ax1 + (a.width ?? 0);
  const ay2 = ay1 + (a.height ?? 0);
  const bx1 = b.x ?? 0;
  const by1 = b.y ?? 0;
  const bx2 = bx1 + (b.width ?? 0);
  const by2 = by1 + (b.height ?? 0);
  const interWidth = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const interHeight = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const intersection = interWidth * interHeight;
  const union = (a.width ?? 0) * (a.height ?? 0) + (b.width ?? 0) * (b.height ?? 0) - intersection;
  if (union <= 0) return 0;
  return intersection / union;
};

const unwrapDetectionResponse = (payload: any) => {
  if (!payload || typeof payload !== 'object') {
    return {
      detectionRoot: null,
      itemsPayload: null,
      reasoning: '',
      error: 'Empty response'
    };
  }
  const detectionRoot = payload.detection || null;
  const itemsPayload =
    extractDetectionPayload(payload) ||
    (detectionRoot && extractDetectionPayload(detectionRoot)) ||
    null;
  const topLevelError =
    (payload.success === false && resolveErrorValue(payload.error)) ||
    extractDetectionError(payload);
  const detectionError =
    (detectionRoot &&
      ((detectionRoot.success === false && resolveErrorValue(detectionRoot.error)) ||
        extractDetectionError(detectionRoot))) ||
    null;
  return {
    detectionRoot,
    itemsPayload,
    reasoning:
      (itemsPayload && (itemsPayload.reasoning as string)) ||
      detectionRoot?.reasoning ||
      payload.reasoning ||
      '',
    error: detectionError || topLevelError || null
  };
};

const parseDetectionPayload = (payload: any, info: ReturnType<typeof unwrapDetectionResponse>) => {
  const meta = { items: [] as DetectionItemSummary[], raw: payload, error: info.error, reasoning: info.reasoning };
  if (info.error) {
    return meta;
  }
  if (!info.itemsPayload || !Array.isArray(info.itemsPayload.items)) {
    meta.error = 'No detector payload';
    return meta;
  }
  meta.items = info.itemsPayload.items
    .filter((item: any) => item && typeof item === 'object')
    .map((item: any, index: number) => ({
      name: item.name || item.label || `Item ${index + 1}`,
      reasoning: item.reasoning || info.reasoning || '',
      confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
      boundingBox: normalizeBoundingBox(item.boundingBox || item.bbox || null)
    }));
  meta.raw = meta.items;
  return meta;
};

const extractDetectionPayload = (apiResponse: any): DetectionItemSummary[] | null => {
  if (!apiResponse) return null;
  const detection = apiResponse.detection;
  if (hasItemsArray(detection)) return detection;
  if (detection?.data && hasItemsArray(detection.data)) return detection.data;
  if (apiResponse.data && hasItemsArray(apiResponse.data)) return apiResponse.data;
  if (hasItemsArray(apiResponse)) return apiResponse;
  const nested = findItemsContainer(apiResponse);
  if (nested) return nested;
  const parsed = tryParseRawResponse(apiResponse.rawResponse);
  if (parsed) {
    if (hasItemsArray(parsed)) return parsed;
    const parsedNested = findItemsContainer(parsed);
    if (parsedNested) return parsedNested;
  }
  return null;
};

const extractDetectionError = (
  node: unknown,
  visited: WeakSet<object> = new WeakSet()
): string | null => {
  if (!node || typeof node !== 'object') return null;
  if (visited.has(node as object)) return null;
  visited.add(node as object);
  const record = node as Record<string, any>;
  const hasSuccess = Object.prototype.hasOwnProperty.call(record, 'success');
  if (hasSuccess && record.success === false && record.error !== undefined) {
    return resolveErrorValue(record.error);
  }
  if (!hasSuccess && record.error !== undefined) {
    return resolveErrorValue(record.error);
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      const found = extractDetectionError(value, visited);
      if (found) return found;
    }
  }
  return null;
};

const resolveErrorValue = (value: unknown) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const hasItemsArray = (value: any): value is { items: any[] } => {
  return Boolean(value && typeof value === 'object' && Array.isArray(value.items));
};

const findItemsContainer = (
  node: unknown,
  visited: WeakSet<object> = new WeakSet()
): any => {
  if (!node || typeof node !== 'object') return null;
  if (visited.has(node as object)) return null;
  visited.add(node as object);
  if (!Array.isArray(node) && hasItemsArray(node)) {
    return node;
  }
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findItemsContainer(entry, visited);
      if (found) return found;
    }
    return null;
  }
  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const child = record[key];
    if (child && typeof child === 'object') {
      const found = findItemsContainer(child, visited);
      if (found) return found;
    }
  }
  return null;
};

const tryParseRawResponse = (raw?: string | null) => {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw.replace(/```json/gi, '```').replace(/```/g, '').trim());
  } catch {
    return null;
  }
};

const normalizeBoundingBox = (input: any): BoundingBox | null => {
  if (!input || typeof input !== 'object') return null;
  const bbox: BoundingBox = {};
  (['x', 'y', 'width', 'height'] as Array<keyof BoundingBox>).forEach((key) => {
    const value = Number(input[key]);
    if (!Number.isNaN(value)) bbox[key] = value;
  });
  return Object.keys(bbox).length ? bbox : null;
};

const clamp01 = (value: number | undefined) => {
  if (typeof value !== 'number') return 0;
  return Math.min(1, Math.max(0, value));
};

const getFrameBoxStyle = (bbox?: BoundingBox | null) => {
  if (!bbox) return {};
  return {
    left: `${clamp01(bbox.x) * 100}%`,
    top: `${clamp01(bbox.y) * 100}%`,
    width: `${clamp01(bbox.width) * 100}%`,
    height: `${clamp01(bbox.height) * 100}%`
  };
};

const formatConfidence = (value?: number) =>
  typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';

const detectionKey = (frameId: string, index: number) => `${frameId}-${index}`;
const getDetectionColor = (index: number) => detectionColors[index % detectionColors.length];
const isOverlayVisible = (frameId: string) =>
  frameOverlayVisibility[frameId] !== undefined ? frameOverlayVisibility[frameId] : true;
const toggleOverlayVisibility = (frameId: string) => {
  frameOverlayVisibility[frameId] = !isOverlayVisible(frameId);
};
</script>

<template>
  <div class="vision-lab-video">
    <q-banner dense rounded class="bg-warning text-white q-mb-md">
      <template #avatar>
        <q-icon name="flask" />
      </template>
      Vision Lab Video is a development-only sandbox for experimenting with multi-step vision
      processing. Nothing here is persisted to production systems.
    </q-banner>

    <div class="controls q-gutter-sm q-mb-md">
      <q-btn color="primary" label="Start Session" :disable="!!sessionId" @click="startSession" />
      <q-btn color="negative" label="End Session" :disable="!sessionId" @click="endSession" />
      <div class="status-chip">
        <span class="text-caption text-grey-7">Session:</span>
        <span class="text-weight-medium">
          {{ sessionId ? 'Active' : 'Not started' }}
        </span>
        <span v-if="sessionId" class="session-id">({{ sessionId }})</span>
      </div>
    </div>

    <div class="prompt-panel q-mb-lg">
      <div class="text-subtitle1 q-mb-xs">Detector Prompt</div>
      <q-input
        type="textarea"
        v-model="promptInput"
        :loading="promptLoading"
        outlined
        autogrow
        dense
        placeholder="Enter prompt provided to the detector..."
      />
    </div>

    <div class="steps-grid">
      <q-card class="step-card" flat bordered>
        <div class="step-header">
          <div>
            <div class="text-overline text-grey-7">Step 1</div>
            <div class="text-h6">Sample Frames from Video</div>
          </div>
          <q-chip :color="stepStatus.sampling.state === 'completed' ? 'positive' : 'grey-5'" text-color="white" dense>
            {{ stepStatus.sampling.state }}
          </q-chip>
        </div>
        <div class="step-body">
          <div class="upload-row q-mb-sm">
            <input
              ref="videoInputRef"
              type="file"
              accept="video/*"
              class="hidden-file-input"
              :disabled="!sessionId || stepStatus.sampling.state === 'in_progress' || scannedFrames.length > 0"
              @change="handleVideoSelection"
            />
            <button
              type="button"
              class="file-upload"
              :class="{ disabled: !sessionId || stepStatus.sampling.state === 'in_progress' || scannedFrames.length > 0 }"
              :disabled="!sessionId || stepStatus.sampling.state === 'in_progress' || scannedFrames.length > 0"
              @click="triggerVideoUpload"
            >
              Select Video
            </button>
            <q-btn
              flat
              round
              icon="restart_alt"
              :disable="!scannedFrames.length"
              @click="resetSampling"
            />
          </div>
          <q-slider
            v-model.number="scanGranularitySec"
            :min="MIN_SCAN_GRANULARITY_SEC"
            :max="MAX_SCAN_GRANULARITY_SEC"
            :step="0.05"
            color="secondary"
            class="q-mt-md"
            label
            label-always
            :disable="stepStatus.sampling.state === 'in_progress' || scannedFrames.length > 0"
          />
          <div class="text-caption text-grey-7 q-mt-xs">
            Scan granularity:
            {{
              effectiveScanGranularity > 0
                ? `${effectiveScanGranularity.toFixed(2)} seconds`
                : `Native (~${nativeFrameDuration.toFixed(3)}s)`
            }}
            (controls how often we capture frames before blur filtering).
          </div>
          <q-slider
            v-model.number="sampleIntervalSec"
            :min="MIN_SAMPLE_INTERVAL_SEC"
            :max="MAX_SAMPLE_INTERVAL_SEC"
            :step="0.1"
            color="primary"
            class="q-mt-md"
            label
            label-always
            :disable="stepStatus.sampling.state === 'in_progress'"
          />
          <div class="text-caption text-grey-7 q-mt-xs">
            Sampling interval: {{ effectiveSampleInterval.toFixed(2) }}s (controls frames sent to detection).
          </div>
          <div class="q-mt-md">
            <div v-if="blurMode === 'absolute'" class="q-mt-sm">
              <q-slider
                v-model="blurThreshold"
                :min="0"
                :max="150"
                :step="1"
                color="primary"
                label
                label-always
                :disable="!scannedFrames.length"
              />
              <div class="text-caption text-grey-7 q-mt-xs">
                Texture cutoff: {{ blurThreshold }} (higher = stricter).
                (filters frames before interval selection)
              </div>
            </div>
            <div v-else class="q-mt-sm">
              <q-slider
                v-model="blurPercentile"
                :min="0"
                :max="100"
                :step="1"
                color="primary"
                label
                label-always
                :disable="!scannedFrames.length"
              />
              <div class="text-caption text-grey-7 q-mt-xs">
                Select frames in the top {{ 100 - blurPercentile }}% of texture scores.
                Actual cutoff: {{ textureCutoff.toFixed(1) }} (auto-adjusts per video).
              </div>
            </div>
            <div class="toggle-row q-mt-sm">
              <q-toggle
                class="toggle-control"
                color="primary"
                checked-icon="percent"
                unchecked-icon="straighten"
                keep-color
                :model-value="blurMode === 'relative'"
                @update:model-value="blurMode = $event ? 'relative' : 'absolute'"
              />
              <span class="text-caption text-grey-7">
                {{ blurMode === 'relative' ? 'Relative (percentile)' : 'Absolute threshold' }}
              </span>
            </div>
          </div>
          <div class="text-caption text-grey-7 q-mt-sm">
            <code>Scanned: {{ scannedFrames.length }} · Selected: {{ sampledFrames.length }} · Rejected:
            {{ rejectedFrames.length }}
            </code>
          </div>
          <div v-if="samplingBuckets.length" class="timeline q-mt-md">
            <div
              class="timeline-segment"
              v-for="bucket in samplingBuckets"
              :key="bucket.start"
              :class="{ 'timeline-empty': !bucket.selected }"
              :title="`t=${bucket.start.toFixed(1)}–${bucket.end.toFixed(1)}s`"
            >
              <div class="timeline-label">
                {{ bucket.start.toFixed(1) }}s
                <span v-if="bucket.selected"
                  >· {{ bucket.selected.textureScore.toFixed(1) }}</span
                >
                <span v-else>· none</span>
              </div>
            </div>
          </div>
          <q-select
            v-if="rejectedFrameOptions.length"
            v-model="selectedRejectedId"
            :options="rejectedFrameOptions"
            label="Review rejected frames"
            outlined
            dense
            emit-value
            map-options
            class="q-mt-sm"
          />
          <div v-if="selectedRejectedFrame" class="text-caption text-grey-6 q-mt-xs">
            Rejected at t={{ selectedRejectedFrame.timestamp.toFixed(2) }}s with blur
            {{ selectedRejectedFrame.blurScore.toFixed(1) }} ({{ selectedRejectedFrame.reason }}).
          </div>
          <div v-if="selectedRejectedFrame" class="rejected-preview q-mt-sm">
            <img :src="selectedRejectedFrame.previewUrl" alt="Rejected frame preview" />
          </div>
          <div v-if="sampledFrames.length" class="sampled-grid q-mt-md">
            <div v-for="frame in sampledFrames" :key="frame.id" class="sampled-frame">
              <img :src="frame.previewUrl" :alt="frame.name" />
              <div class="text-caption text-grey-6 q-mt-xs">
                t={{ frame.timestamp.toFixed(1) }}s — Blur: {{ frame.blurScore.toFixed(1) }}
              </div>
            </div>
          </div>
        </div>
      </q-card>

      <q-card class="step-card" flat bordered>
        <div class="step-header">
          <div>
            <div class="text-overline text-grey-7">Step 2</div>
            <div class="text-h6">Analyze Frames</div>
          </div>
          <q-chip :color="stepStatus.detection.state === 'completed' ? 'positive' : 'grey-5'" text-color="white" dense>
            {{ stepStatus.detection.state }}
          </q-chip>
        </div>
        <div class="step-body">
          <q-btn
            color="primary"
            label="Start Frame Analysis"
            :disable="!canStartDetection || stepStatus.detection.state === 'in_progress'"
            @click="startFrameAnalysis"
          />
          <div class="text-caption text-grey-7 q-mt-sm">
            {{ stepStatus.detection.info }}
          </div>
          <div v-if="frameAnalyses.length" class="frames-grid q-mt-md">
            <div class="frame-card" v-for="analysis in frameAnalyses" :key="analysis.id">
              <div class="frame-toolbar">
                <q-chip dense size="sm" color="grey-2" text-color="grey-8">
                  {{ analysis.items.length }} detections
                </q-chip>
                <q-btn
                  flat
                  dense
                  round
                  :icon="isOverlayVisible(analysis.id) ? 'visibility' : 'visibility_off'"
                  @click="toggleOverlayVisibility(analysis.id)"
                />
              </div>
              <div class="frame-image-wrapper">
                <img :src="analysis.previewUrl" class="frame-image" />
                <template v-for="(item, idx) in analysis.items" :key="analysis.id + '-' + idx">
                  <div
                    v-if="isOverlayVisible(analysis.id) && item.boundingBox"
                    class="bbox-overlay"
                    :class="{ highlighted: highlightedDetectionId === detectionKey(analysis.id, idx) }"
                    :style="[
                      getFrameBoxStyle(item.boundingBox),
                      { borderColor: getDetectionColor(idx) }
                    ]"
                    :title="item.reasoning"
                  >
                    <div class="bbox-label" :style="{ background: getDetectionColor(idx) }">
                      {{ item.name }} • {{ formatConfidence(item.confidence) }}
                    </div>
                  </div>
                </template>
              </div>
              <div class="text-caption text-grey-6 q-mt-xs">
                {{ analysis.name }}
              </div>
              <div v-if="analysis.error" class="text-negative text-caption q-mt-xs">
                {{ analysis.error }}
              </div>
              <div class="detection-chips q-mt-sm">
                <q-chip
                  v-for="(item, idx) in analysis.items"
                  :key="`chip-${analysis.id}-${idx}`"
                  clickable
                  size="sm"
                  text-color="white"
                  :style="{ background: getDetectionColor(idx) }"
                  @mouseenter="highlightedDetectionId = detectionKey(analysis.id, idx)"
                  @mouseleave="highlightedDetectionId = null"
                >
                  {{ item.name }} ({{ formatConfidence(item.confidence) }})
                </q-chip>
              </div>
            </div>
          </div>
        </div>
      </q-card>

      <q-card class="step-card" flat bordered>
        <div class="step-header">
          <div>
            <div class="text-overline text-grey-7">Step 2a</div>
            <div class="text-h6">Refine Bounding Boxes (SAM)</div>
          </div>
          <q-chip :color="stepStatus.refinement.state === 'completed' ? 'positive' : 'grey-5'" text-color="white" dense>
            {{ stepStatus.refinement.state }}
          </q-chip>
        </div>
        <div class="step-body">
          <q-btn
            color="primary"
            label="Run SAM Refinement"
            :disable="!hasDetections || stepStatus.refinement.state === 'in_progress'"
            @click="runSamRefinement"
          />
          <div class="text-caption text-grey-7 q-mt-sm">
            {{ stepStatus.refinement.info }}
          </div>
          <div v-if="samAnalyses.length" class="frames-grid q-mt-md">
            <div class="frame-card" v-for="analysis in samAnalyses" :key="analysis.id">
              <div class="frame-toolbar">
                <q-chip dense size="sm" color="grey-2" text-color="grey-8">
                  {{ analysis.items.length }} refined detections
                </q-chip>
                <q-btn
                  flat
                  dense
                  round
                  :icon="isOverlayVisible(analysis.id) ? 'visibility' : 'visibility_off'"
                  @click="toggleOverlayVisibility(analysis.id)"
                />
              </div>
              <div class="frame-image-wrapper">
                <img :src="analysis.previewUrl" class="frame-image" />
                <template v-for="(item, idx) in analysis.items" :key="analysis.id + '-' + idx">
                  <div
                    v-if="isOverlayVisible(analysis.id) && item.boundingBox"
                    class="bbox-overlay"
                    :class="{ highlighted: highlightedDetectionId === detectionKey(analysis.id, idx) }"
                    :style="[
                      getFrameBoxStyle(item.boundingBox),
                      { borderColor: getDetectionColor(idx) }
                    ]"
                    :title="item.reasoning"
                  >
                    <div class="bbox-label" :style="{ background: getDetectionColor(idx) }">
                      {{ item.name }} • {{ formatConfidence(item.confidence) }}
                    </div>
                  </div>
                </template>
              </div>
              <div class="text-caption text-grey-6 q-mt-xs">
                {{ analysis.name }}
              </div>
              <div class="detection-chips q-mt-sm">
                <q-chip
                  v-for="(item, idx) in analysis.items"
                  :key="`sam-chip-${analysis.id}-${idx}`"
                  clickable
                  size="sm"
                  text-color="white"
                  :style="{ background: getDetectionColor(idx) }"
                  @mouseenter="highlightedDetectionId = detectionKey(analysis.id, idx)"
                  @mouseleave="highlightedDetectionId = null"
                >
                  {{ item.name }} ({{ formatConfidence(item.confidence) }})
                </q-chip>
              </div>
            </div>
          </div>
          <div v-else class="text-caption text-grey-6 q-mt-sm">
            Run detection first, then apply SAM to tighten boxes.
          </div>
        </div>
      </q-card>

      <q-card class="step-card" flat bordered>
        <div class="step-header">
          <div>
            <div class="text-overline text-grey-7">Step 3</div>
            <div class="text-h6">Deduplicate Items</div>
          </div>
          <q-chip :color="stepStatus.dedupe.state === 'completed' ? 'positive' : 'grey-5'" text-color="white" dense>
            {{ stepStatus.dedupe.state }}
          </q-chip>
        </div>
        <div class="step-body">
          <q-btn
            color="primary"
            label="Run Deduplication"
            :disable="!canStartDedup || stepStatus.dedupe.state === 'in_progress'"
            @click="startDeduplication"
          />
          <div class="text-caption text-grey-7 q-mt-sm">
            {{ stepStatus.dedupe.info }}
          </div>
          <q-markup-table v-if="dedupedItems.length" flat bordered dense class="q-mt-md">
            <thead>
              <tr>
                <th>Name</th>
                <th>Occurrences</th>
                <th>Frames</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in dedupedItems" :key="item.id">
                <td>{{ item.name }}</td>
                <td>{{ item.occurrences }}</td>
                <td>{{ item.frames.join(', ') }}</td>
              </tr>
            </tbody>
          </q-markup-table>
        </div>
      </q-card>

      <q-card class="step-card" flat bordered>
        <div class="step-header">
          <div>
            <div class="text-overline text-grey-7">Step 4</div>
            <div class="text-h6">Assign Attributes</div>
          </div>
          <q-chip :color="stepStatus.attributes.state === 'completed' ? 'positive' : 'grey-5'" text-color="white" dense>
            {{ stepStatus.attributes.state }}
          </q-chip>
        </div>
        <div class="step-body">
          <q-btn
            color="primary"
            label="Generate Attributes"
            :disable="!canStartAttributes || stepStatus.attributes.state === 'in_progress'"
            @click="startAttributeAssignment"
          />
          <div class="text-caption text-grey-7 q-mt-sm">
            {{ stepStatus.attributes.info }}
          </div>
          <q-markup-table v-if="attributedItems.length" flat bordered dense class="q-mt-md">
            <thead>
              <tr>
                <th>Name</th>
                <th>Weight (lbs)</th>
                <th>Dimensions (in)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in attributedItems" :key="item.id">
                <td>{{ item.name }}</td>
                <td>{{ item.weightLbs }}</td>
                <td>
                  {{ item.dimensions.length }}×{{ item.dimensions.width }}×{{ item.dimensions.height }}
                </td>
              </tr>
            </tbody>
          </q-markup-table>
        </div>
      </q-card>

      <q-card class="step-card" flat bordered>
        <div class="step-header">
          <div>
            <div class="text-overline text-grey-7">Step 5</div>
            <div class="text-h6">Save Items to Inventory</div>
          </div>
          <q-chip :color="stepStatus.saving.state === 'completed' ? 'positive' : 'grey-5'" text-color="white" dense>
            {{ stepStatus.saving.state }}
          </q-chip>
        </div>
        <div class="step-body">
          <q-btn
            color="primary"
            label="Save Items"
            :disable="!canSaveItems || stepStatus.saving.state === 'in_progress'"
            @click="saveItemsToInventory"
          />
          <div class="text-caption text-grey-7 q-mt-sm">
            {{ stepStatus.saving.info }}
          </div>
          <div v-if="saveResult" class="text-positive q-mt-sm">
            {{ saveResult }}
          </div>
        </div>
      </q-card>
    </div>

    <div class="run-log q-mt-xl" v-if="runLogs.length">
      <div class="text-subtitle1 q-mb-sm">Detection Runs</div>
      <q-markup-table flat bordered dense>
        <thead>
          <tr>
            <th>Prompt</th>
            <th>Started</th>
            <th>Frames</th>
            <th>Errors</th>
            <th>Items</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in runLogs" :key="run.id">
            <td class="run-prompt">{{ run.prompt }}</td>
            <td>{{ new Date(run.startedAt).toLocaleTimeString() }}</td>
            <td>{{ run.totalFrames }}</td>
            <td>{{ run.errorFrames }}</td>
            <td class="run-items">
              <div v-if="run.items.length">
                {{ run.items.join(', ') }}
              </div>
              <div v-else class="text-grey-6">No items</div>
            </td>
          </tr>
        </tbody>
      </q-markup-table>
    </div>
  </div>
</template>

<style scoped>
.vision-lab-video {
  max-width: 1200px;
  margin: 0 auto;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: #f1f5f9;
}
.status-chip .session-id {
  font-size: 12px;
  color: #64748b;
}
.prompt-panel {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  background: #f8fafc;
}
.steps-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.step-card {
  border-radius: 16px;
  padding: 16px;
  width: 100%;
}
.step-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.step-body input[type='file'] {
  width: 100%;
}
.sampled-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}
.sampled-frame img {
  width: 100%;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}
.rejected-preview img {
  width: 100%;
  max-width: 260px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}
.frames-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
.upload-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.hidden-file-input {
  display: none;
}
.file-upload {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 6px 18px;
  border-radius: 6px;
  border: 1px solid #2563eb;
  color: #1e3a8a;
  font-weight: 600;
  cursor: pointer;
  background: rgba(37, 99, 235, 0.08);
  transition: background 0.2s ease;
}
.file-upload.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.frames-grid .frame-card {
  position: relative;
}
.frame-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.detection-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bbox-overlay {
  border-width: 2px;
}
.bbox-overlay.highlighted {
  box-shadow: 0 0 10px rgba(14, 165, 233, 0.8);
  z-index: 2;
}
.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toggle-control {
  order: 0;
}
.timeline {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
}
.timeline-segment {
  flex: 1 1 0;
  min-width: 0;
  padding: 6px;
  border-radius: 6px;
  background: #e0f2fe;
  border: 1px solid #bae6fd;
  text-align: center;
  font-size: 12px;
  white-space: normal;
}
.timeline-segment.timeline-empty {
  background: #fee2e2;
  border-color: #fecaca;
}
.timeline-label {
  font-weight: 600;
  color: #0f172a;
  white-space: normal;
  word-break: break-word;
}
.frame-card {
  padding: 8px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #fff;
}
.frame-image-wrapper {
  position: relative;
}
.frame-image {
  width: 100%;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
}
.bbox-overlay {
  position: absolute;
  border: 2px solid #f97316;
  border-radius: 4px;
  pointer-events: none;
}
.bbox-label {
  background: rgba(14, 165, 233, 0.9);
  color: #fff;
  font-size: 11px;
  padding: 2px 6px;
  border-bottom-right-radius: 6px;
}
.run-log .run-prompt {
  white-space: pre-wrap;
  max-width: 280px;
}
.run-log .run-items {
  max-width: 360px;
  white-space: normal;
}
</style>
