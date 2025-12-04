const fetch = require('node-fetch');

const togetherApiKey = process.env.TOGETHER_API_KEY;
const togetherTextModel =
  process.env.TOGETHER_TEXT_MODEL ||
  'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo';
const apiBaseUrl =
  process.env.TOGETHER_API_BASE_URL || 'https://api.together.xyz/v1';

const confidenceRange = { min: 0, max: 1 };

const pickNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/[^0-9.+-]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object') {
    if ('value' in value) {
      return pickNumber(value.value);
    }
  }
  return null;
};

const clampConfidence = (value) => {
  const num = pickNumber(value);
  if (num === null) return null;
  if (num < confidenceRange.min) return confidenceRange.min;
  if (num > confidenceRange.max) return confidenceRange.max;
  return Number(num.toFixed(4));
};

const formatList = (items, fallback = 'n/a') => {
  if (!items) return fallback;
  if (Array.isArray(items)) {
    if (items.length === 0) return fallback;
    return items.join(', ');
  }
  if (typeof items === 'string') return items;
  return fallback;
};

const buildContextSummary = (context = {}) => {
  const pieces = [];
  if (context.name) pieces.push(`Name: ${context.name}`);
  if (context.description) pieces.push(`Description: ${context.description}`);
  if (context.quantity) pieces.push(`Quantity: ${context.quantity}`);
  if (context.collection_name)
    pieces.push(`Collection: ${context.collection_name}`);
  if (context.container_name)
    pieces.push(`Container: ${context.container_name}`);
  if (context.location_name)
    pieces.push(`Location: ${context.location_name}`);
  if (context.material) pieces.push(`Material: ${context.material}`);
  if (context.primary_color)
    pieces.push(`Primary color: ${context.primary_color}`);
  if (context.tags && context.tags.length > 0) {
    pieces.push(`Tags: ${context.tags.join(', ')}`);
  }
  if (context.notes) pieces.push(`Notes: ${context.notes}`);
  if (context.weight_lbs)
    pieces.push(`Existing weight: ${context.weight_lbs} lbs`);
  if (
    context.length_in &&
    context.width_in &&
    context.height_in &&
    Number(context.length_in) > 0
  ) {
    pieces.push(
      `Existing dimensions: ${context.length_in} × ${context.width_in} × ${context.height_in} in`
    );
  }
  return pieces.join('\n');
};

const buildPrompt = (context = {}) => {
  const lines = [];
  lines.push(
    `You are a relocation logistics estimator. Estimate realistic shipping weight and bounding box dimensions for the described household item. ` +
      `Favor practical measurements movers would record before loading. Respond with JSON only (no markdown).`
  );
  lines.push('');
  lines.push('Return JSON with this exact structure:');
  lines.push(`{
  "weight_lbs": { "value": 0, "confidence": 0.0 },
  "dimensions": {
    "length_in": { "value": 0, "confidence": 0.0 },
    "width_in": { "value": 0, "confidence": 0.0 },
    "height_in": { "value": 0, "confidence": 0.0 }
  },
  "volume_cuft": 0,
  "notes": "brief reasoning"
}`);
  lines.push('');
  lines.push(
    'Guidelines: Use inches for dimensions and pounds for weight. Put the longest dimension under "length". If existing measurements are provided, keep them and set confidence ≥ 0.95. ' +
      'If missing, estimate based on similar household items and mention your reasoning. Compute volume_cuft = length*width*height/1728 and round to 2 decimals.'
  );
  lines.push('');
  lines.push('Item metadata:');
  lines.push(buildContextSummary(context) || 'No additional metadata provided.');
  return lines.join('\n');
};

const stripCodeFences = (text) => {
  if (!text) return '';
  return text.replace(/```json|```/gi, '').trim();
};

const parseModelJson = (text) => {
  const cleaned = stripCodeFences(text);
  if (!cleaned) {
    throw new Error('LLM returned empty response');
  }
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`Unable to parse LLM JSON response: ${error.message}`);
  }
};

const extractMessageText = (payload) => {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('\n')
      .trim();
  }
  if (typeof content === 'string') {
    return content.trim();
  }
  if (content?.text) {
    return String(content.text).trim();
  }
  return '';
};

const normalizeEstimate = (parsed = {}) => {
  const weightValue =
    pickNumber(parsed.weight_lbs?.value) ??
    pickNumber(parsed.weight_lbs) ??
    pickNumber(parsed.estimated_weight) ??
    pickNumber(parsed.weight);

  const dimensionSource =
    parsed.dimensions ||
    parsed.estimatedDimensions ||
    parsed.size ||
    parsed.measurements ||
    {};

  const lengthValue =
    pickNumber(dimensionSource.length_in?.value) ??
    pickNumber(dimensionSource.length_in) ??
    pickNumber(dimensionSource.length) ??
    pickNumber(dimensionSource.long) ??
    pickNumber(parsed.length_in);
  const widthValue =
    pickNumber(dimensionSource.width_in?.value) ??
    pickNumber(dimensionSource.width_in) ??
    pickNumber(dimensionSource.width) ??
    pickNumber(dimensionSource.short) ??
    pickNumber(parsed.width_in);
  const heightValue =
    pickNumber(dimensionSource.height_in?.value) ??
    pickNumber(dimensionSource.height_in) ??
    pickNumber(dimensionSource.height) ??
    pickNumber(dimensionSource.depth) ??
    pickNumber(parsed.height_in);

  const notes =
    parsed.notes ||
    parsed.reasoning ||
    parsed.justification ||
    parsed.explanation ||
    null;

  const weightConfidence =
    clampConfidence(parsed.weight_lbs?.confidence) ??
    clampConfidence(parsed.weight_confidence) ??
    clampConfidence(parsed.confidence);
  const dimensionConfidence =
    clampConfidence(dimensionSource.confidence) ??
    clampConfidence(parsed.dimensions_confidence);

  let volumeCuFt =
    pickNumber(parsed.volume_cuft) ??
    pickNumber(parsed.volumeCuFt) ??
    pickNumber(parsed.cubic_feet) ??
    null;
  if (!volumeCuFt && lengthValue && widthValue && heightValue) {
    volumeCuFt = Number(
      ((lengthValue * widthValue * heightValue) / 1728).toFixed(2)
    );
  }

  const availableConfidences = [
    weightConfidence,
    dimensionConfidence
  ].filter((value) => typeof value === 'number');
  const compositeConfidence =
    availableConfidences.length > 0
      ? Number(
          (
            availableConfidences.reduce((sum, value) => sum + value, 0) /
            availableConfidences.length
          ).toFixed(4)
        )
      : null;

  return {
    weight_lbs: weightValue !== null ? { value: weightValue, confidence: weightConfidence } : null,
    dimensions: {
      length_in:
        lengthValue !== null
          ? { value: lengthValue, confidence: dimensionConfidence }
          : null,
      width_in:
        widthValue !== null
          ? { value: widthValue, confidence: dimensionConfidence }
          : null,
      height_in:
        heightValue !== null
          ? { value: heightValue, confidence: dimensionConfidence }
          : null
    },
    volume_cuft: volumeCuFt,
    notes,
    confidence: compositeConfidence
  };
};

async function generateItemEstimate(context = {}, options = {}) {
  if (!togetherApiKey) {
    throw new Error('Together.ai API key not configured');
  }

  const model = options.model || togetherTextModel;
  const prompt = buildPrompt(context);

  const response = await fetch(`${apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${togetherApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 512,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert household goods estimator helping movers record approximate weights and dimensions.'
        },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Together.ai request failed (${response.status}): ${errorText}`
    );
  }

  const payload = await response.json();
  const messageText = extractMessageText(payload);
  const parsed = parseModelJson(messageText);
  const normalized = normalizeEstimate(parsed);

  return {
    provider: 'together',
    model,
    prompt,
    requestContextSummary: buildContextSummary(context),
    rawText: messageText,
    rawResponse: payload,
    parsed,
    usage: payload?.usage || null,
    estimate: normalized
  };
}

module.exports = {
  generateItemEstimate
};
