const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs/promises');
const fetch = require('node-fetch');
const visionService = require('../bin/visionService');

const CONFIG_PATH = path.join(__dirname, '../data/visionLab.json');

async function loadConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

async function saveConfig(data) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function ensureAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Admins only' });
  }
  next();
}

router.use(ensureAdmin);

router.get('/', async (req, res) => {
  try {
    const config = await loadConfig();
    res.json(config);
  } catch (error) {
    console.error('[VisionLab] Failed to load config', error);
    res.status(500).json({ success: false, error: 'Failed to load configuration' });
  }
});

router.post('/pipelines', async (req, res) => {
  try {
    const { pipeline } = req.body || {};
    if (!pipeline || !pipeline.id) {
      return res.status(400).json({ success: false, error: 'pipeline payload required' });
    }
    const config = await loadConfig();
    const idx = config.pipelines.findIndex((p) => p.id === pipeline.id);
    if (idx >= 0) {
      config.pipelines[idx] = pipeline;
    } else {
      config.pipelines.push(pipeline);
    }
    await saveConfig(config);
    res.json({ success: true, pipeline });
  } catch (error) {
    console.error('[VisionLab] Failed to save pipeline', error);
    res.status(500).json({ success: false, error: 'Failed to save pipeline' });
  }
});

router.post('/datasets', async (req, res) => {
  try {
    const { dataset } = req.body || {};
    if (!dataset || !dataset.id) {
      return res.status(400).json({ success: false, error: 'dataset payload required' });
    }
    const config = await loadConfig();
    const idx = config.datasets.findIndex((d) => d.id === dataset.id);
    if (idx >= 0) {
      config.datasets[idx] = dataset;
    } else {
      config.datasets.push(dataset);
    }
    await saveConfig(config);
    res.json({ success: true, dataset });
  } catch (error) {
    console.error('[VisionLab] Failed to save dataset', error);
    res.status(500).json({ success: false, error: 'Failed to save dataset' });
  }
});

router.post('/run', async (req, res) => {
  try {
    const { pipelineId, datasetId, repetitions = 1 } = req.body || {};
    if (!pipelineId || !datasetId) {
      return res.status(400).json({ success: false, error: 'pipelineId and datasetId are required' });
    }
    if (repetitions < 1 || repetitions > 50) {
      return res.status(400).json({ success: false, error: 'repetitions must be between 1 and 50' });
    }

    const config = await loadConfig();
    const pipeline = config.pipelines.find((p) => p.id === pipelineId);
    if (!pipeline) {
      return res.status(404).json({ success: false, error: 'Pipeline not found' });
    }
    const dataset = config.datasets.find((d) => d.id === datasetId);
    if (!dataset || !Array.isArray(dataset.entries) || dataset.entries.length === 0) {
      return res.status(404).json({ success: false, error: 'Dataset not found or empty' });
    }

    const summary = await runEvaluation(pipeline, dataset, repetitions);
    res.json(summary);
  } catch (error) {
    console.error('[VisionLab] Failed to run evaluation', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to run evaluation' });
  }
});

async function runEvaluation(pipeline, dataset, repetitions) {
  const aggregate = {
    totalRuns: 0,
    failures: 0,
    fieldTotals: {},
    fieldCounts: {},
    totalDurationMs: 0,
    stepTotals: {},
  };
  const samples = [];

  for (let rep = 0; rep < repetitions; rep++) {
    for (const entry of dataset.entries) {
      const runResult = await executePipeline(pipeline, entry);
      if (!runResult.success) {
        aggregate.failures += 1;
        samples.push({
          entryId: entry.id,
          success: false,
          error: runResult.error,
          stepTrace: runResult.steps,
        });
        continue;
      }

      aggregate.totalRuns += 1;
      aggregate.totalDurationMs += runResult.durationMs;

      Object.entries(runResult.scores).forEach(([field, value]) => {
        if (value === null || value === undefined) return;
        aggregate.fieldTotals[field] = (aggregate.fieldTotals[field] || 0) + value;
        aggregate.fieldCounts[field] = (aggregate.fieldCounts[field] || 0) + 1;
      });

      runResult.steps.forEach((stepLog) => {
        const key = stepLog.id;
        if (!aggregate.stepTotals[key]) {
          aggregate.stepTotals[key] = { durationMs: 0, count: 0, successCount: 0, label: stepLog.label || stepLog.id };
        }
        aggregate.stepTotals[key].durationMs += stepLog.durationMs;
        aggregate.stepTotals[key].count += 1;
        if (stepLog.success) {
          aggregate.stepTotals[key].successCount += 1;
        }
      });

      samples.push({
        entryId: entry.id,
        success: true,
        scores: runResult.scores,
        durationMs: runResult.durationMs,
      });
    }
  }

  const fieldMetrics = {};
  Object.entries(aggregate.fieldTotals).forEach(([field, total]) => {
    const count = aggregate.fieldCounts[field] || 1;
    fieldMetrics[field] = Number((total / count).toFixed(3));
  });

  const overallAccuracy =
    Object.keys(fieldMetrics).length > 0
      ? Object.values(fieldMetrics).reduce((sum, val) => sum + val, 0) / Object.keys(fieldMetrics).length
      : 0;

  const stepMetrics = Object.entries(aggregate.stepTotals).map(([id, stats]) => ({
    id,
    label: stats.label,
    avgDurationMs: Number((stats.durationMs / (stats.count || 1)).toFixed(1)),
    successRate: Number((stats.successCount / (stats.count || 1)).toFixed(3)),
  }));

  return {
    success: true,
    summary: {
      pipelineId: pipeline.id,
      datasetId: dataset.id,
      totalSamples: aggregate.totalRuns,
      failures: aggregate.failures,
      overallAccuracy: Number(overallAccuracy.toFixed(3)),
      fieldMetrics,
      avgRunDurationMs: aggregate.totalRuns
        ? Number((aggregate.totalDurationMs / aggregate.totalRuns).toFixed(1))
        : 0,
      stepMetrics,
    },
    samples: samples.slice(0, 50),
  };
}

async function executePipeline(pipeline, entry) {
  try {
    const { base64, mimeType } = await loadImage(entry);
    const context = {
      image: { id: entry.id, url: entry.imageUrl || null },
      truth: entry.truth || {},
      lastOutput: null,
    };

    const steps = pipeline.steps && pipeline.steps.length ? pipeline.steps : [];
    if (!steps.length) {
      return { success: false, error: 'Pipeline has no steps', steps: [] };
    }

    const stepLogs = [];
    let lastOutput = null;

    for (const step of steps) {
      const provider = step.provider || pipeline.provider || visionService.getCurrentProvider();
      const prompt = resolvePrompt(step.prompt, context);
      const start = Date.now();
      const result = await visionService.analyzeItemPhoto(base64, mimeType, provider, prompt);
      const durationMs = Date.now() - start;
      const log = {
        id: step.id,
        label: step.label || step.id,
        provider,
        durationMs,
        success: !!result?.success,
      };
      if (!result?.success) {
        log.error = result?.error || 'Unknown error';
        stepLogs.push(log);
        return { success: false, error: log.error, steps: stepLogs };
      }

      stepLogs.push(log);
      lastOutput = result.data;
      context[step.id] = result.data;
      context.lastOutput = result.data;
    }

    const truth = entry.truth || {};
    const scores = evaluatePrediction(truth, lastOutput || {});

    return {
      success: true,
      steps: stepLogs,
      durationMs: stepLogs.reduce((sum, step) => sum + step.durationMs, 0),
      prediction: lastOutput,
      truth,
      scores,
    };
  } catch (error) {
    return { success: false, error: error.message || 'Pipeline execution failed', steps: [] };
  }
}

async function loadImage(entry) {
  if (entry.imageBase64) {
    return { base64: entry.imageBase64, mimeType: entry.mimeType || 'image/jpeg' };
  }
  if (!entry.imageUrl) {
    throw new Error(`Dataset entry ${entry.id} is missing imageUrl`);
  }
  const response = await fetch(entry.imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image for ${entry.id} (${response.status})`);
  }
  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = await response.arrayBuffer();
  return { base64: Buffer.from(buffer).toString('base64'), mimeType };
}

function resolvePrompt(template, context) {
  if (!template || template === '$VISION_PROMPT') {
    return visionService.VISION_PROMPT;
  }
  return template.replace(/{{\s*([^}]+)\s*}}/g, (_, expression) => {
    const value = expression.trim().split('.').reduce((acc, key) => {
      if (acc && Object.prototype.hasOwnProperty.call(acc, key)) {
        return acc[key];
      }
      return undefined;
    }, context);

    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

function evaluatePrediction(truth, prediction) {
  const scores = {};

  if (truth.name) {
    scores.name =
      normalizeString(truth.name) && normalizeString(prediction?.name)
        ? normalizeString(truth.name) === normalizeString(prediction.name)
          ? 1
          : 0
        : 0;
  }

  if (truth.material) {
    scores.material =
      normalizeString(truth.material) && normalizeString(prediction?.material)
        ? normalizeString(truth.material) === normalizeString(prediction.material)
          ? 1
          : 0
        : 0;
  }

  if (truth.room) {
    scores.room =
      normalizeString(truth.room) && normalizeString(prediction?.room)
        ? normalizeString(truth.room) === normalizeString(prediction.room || prediction.location)
          ? 1
          : 0
        : 0;
  }

  if (truth.color) {
    scores.color =
      normalizeString(truth.color) && normalizeString(prediction?.color)
        ? normalizeString(truth.color) === normalizeString(prediction.color)
          ? 1
          : 0
        : 0;
  }

  if (truth.tags && Array.isArray(truth.tags) && truth.tags.length) {
    const truthTags = truth.tags.map((t) => normalizeString(t)).filter(Boolean);
    const predictedTags = Array.isArray(prediction?.tags)
      ? prediction.tags.map((t) => normalizeString(t)).filter(Boolean)
      : [];
    const overlap = truthTags.filter((tag) => predictedTags.includes(tag));
    const union = new Set([...truthTags, ...predictedTags]);
    scores.tags = union.size ? overlap.length / union.size : 0;
  }

  if (truth.dimensions) {
    scores.dimensions = compareDimensions(prediction?.estimatedDimensions, truth.dimensions);
  }

  if (truth.weightLbs) {
    scores.weight = compareNumeric(prediction?.estimatedWeight, truth.weightLbs, truth.weightLbs * 0.2 + 2);
  }

  return scores;
}

function compareDimensions(predicted = {}, truth = {}) {
  const keys = ['length', 'width', 'height'];
  let matches = 0;
  let total = 0;
  keys.forEach((key) => {
    if (truth[key]) {
      total += 1;
      const predictedValue = Number(predicted?.[key]);
      if (!Number.isFinite(predictedValue)) {
        return;
      }
      const tolerance = Math.max(2, truth[key] * 0.15);
      if (Math.abs(predictedValue - truth[key]) <= tolerance) {
        matches += 1;
      }
    }
  });
  if (!total) return null;
  return matches / total;
}

function compareNumeric(predictedValue, truthValue, tolerance) {
  if (!Number.isFinite(truthValue) || !Number.isFinite(predictedValue)) {
    return null;
  }
  return Math.abs(predictedValue - truthValue) <= tolerance ? 1 : 0;
}

function normalizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

module.exports = router;
