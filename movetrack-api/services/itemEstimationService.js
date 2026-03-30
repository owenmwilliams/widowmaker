const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

let geminiClient = null;
if (process.env.GOOGLE_AI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
}

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

const buildContextSummary = (context = {}) => {
  const pieces = [];
  if (context.name) pieces.push(`Name: ${context.name}`);
  if (context.description) pieces.push(`Description: ${context.description}`);
  // Note: quantity is intentionally excluded from the context sent to the AI.
  // Weight and dimensions must always be per-unit estimates; downstream code
  // multiplies by quantity to compute totals.
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
    `Estimate realistic shipping weight and bounding box dimensions for ONE SINGLE UNIT of the described household item. ` +
      `Even if the description implies multiple units, estimate for exactly one individual item. ` +
      `Favor practical measurements movers would record before loading. Respond with JSON only (no markdown fences).`
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
    'Guidelines: Use inches for dimensions and pounds for weight. All values must be for ONE SINGLE UNIT — never multiply by quantity. ' +
      'Put the longest dimension under "length". If existing measurements are provided, keep them and set confidence ≥ 0.95. ' +
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

const extractFirstJsonObject = (text) => {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
};

const repairJsonText = (text) => {
  if (!text) return text;
  const noSmartQuotes = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  return noSmartQuotes.replace(/,\s*([}\]])/g, '$1');
};

const parseModelJson = (text) => {
  const cleaned = stripCodeFences(text);
  if (!cleaned) {
    const error = new Error('LLM returned empty response');
    error.stage = 'empty_response';
    error.rawText = text;
    throw error;
  }

  const attemptParse = (payload) => JSON.parse(payload);

  try {
    return attemptParse(cleaned);
  } catch (_) {
    const extracted = extractFirstJsonObject(cleaned);
    if (extracted) {
      try {
        return attemptParse(extracted);
      } catch (_) {
        // continue to repair step
      }
    }
    const repaired = repairJsonText(extracted || cleaned);
    try {
      return attemptParse(repaired);
    } catch (error) {
      const parseError = new Error(
        `Unable to parse LLM JSON response: ${error.message}`
      );
      parseError.stage = 'parse';
      parseError.rawText = text;
      parseError.cleanedText = cleaned;
      parseError.extractedText = extracted;
      parseError.repairedText = repaired;
      throw parseError;
    }
  }
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

const ESTIMATE_RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    weight_lbs: {
      type: SchemaType.OBJECT,
      properties: {
        value: { type: SchemaType.NUMBER },
        confidence: { type: SchemaType.NUMBER },
      },
      required: ['value', 'confidence'],
    },
    dimensions: {
      type: SchemaType.OBJECT,
      properties: {
        length_in: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.NUMBER },
            confidence: { type: SchemaType.NUMBER },
          },
          required: ['value', 'confidence'],
        },
        width_in: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.NUMBER },
            confidence: { type: SchemaType.NUMBER },
          },
          required: ['value', 'confidence'],
        },
        height_in: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.NUMBER },
            confidence: { type: SchemaType.NUMBER },
          },
          required: ['value', 'confidence'],
        },
      },
      required: ['length_in', 'width_in', 'height_in'],
    },
    volume_cuft: { type: SchemaType.NUMBER },
    notes: { type: SchemaType.STRING },
  },
  required: ['weight_lbs', 'dimensions', 'volume_cuft', 'notes'],
};

async function generateItemEstimate(context = {}, options = {}) {
  if (!geminiClient) {
    throw new Error('GOOGLE_AI_API_KEY not configured');
  }

  const prompt = buildPrompt(context);
  const modelName = options.model || 'gemini-2.5-flash';
  const systemInstruction =
    'You are an expert household goods estimator helping movers record approximate weights and dimensions. Respond with JSON only.';
  const baseGenerationConfig = {
    temperature: 0.2,
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
    responseSchema: ESTIMATE_RESPONSE_SCHEMA,
  };

  const runAttempt = async (extraInstruction, maxOutputTokens) => {
    const generationConfig = maxOutputTokens
      ? { ...baseGenerationConfig, maxOutputTokens }
      : baseGenerationConfig;
    const model = geminiClient.getGenerativeModel({
      model: modelName,
      systemInstruction,
      generationConfig,
    });
    const attemptPrompt = extraInstruction
      ? `${prompt}\n\n${extraInstruction}`
      : prompt;
    const result = await model.generateContent(attemptPrompt);
    const messageText = result.response.text();
    let parsed = null;
    try {
      parsed = parseModelJson(messageText);
    } catch (error) {
      error.prompt = attemptPrompt;
      error.rawText = error.rawText || messageText;
      throw error;
    }
    const normalized = normalizeEstimate(parsed);
    return {
      prompt: attemptPrompt,
      rawText: messageText,
      parsed,
      estimate: normalized,
      usage: null,
    };
  };

  let attemptError = null;
  try {
    const attempt = await runAttempt();
    return {
      provider: 'gemini',
      model: modelName,
      prompt: attempt.prompt,
      requestContextSummary: buildContextSummary(context),
      rawText: attempt.rawText,
      parsed: attempt.parsed,
      usage: attempt.usage,
      estimate: attempt.estimate,
    };
  } catch (error) {
    attemptError = error;
  }

  try {
    const retryInstruction =
      'Your previous response was invalid JSON. Return only a single JSON object that matches the required schema. Do not include any extra text.';
    const attempt = await runAttempt(retryInstruction, 2048);
    return {
      provider: 'gemini',
      model: modelName,
      prompt: attempt.prompt,
      requestContextSummary: buildContextSummary(context),
      rawText: attempt.rawText,
      parsed: attempt.parsed,
      usage: attempt.usage,
      estimate: attempt.estimate,
    };
  } catch (error) {
    const finalError = error;
    finalError.stage = finalError.stage
      ? `retry_${finalError.stage}`
      : 'retry_failed';
    finalError.provider = 'gemini';
    finalError.model = modelName;
    finalError.prompt = finalError.prompt || prompt;
    finalError.rawText = finalError.rawText || attemptError?.rawText || null;
    finalError.previousErrorMessage = attemptError?.message || null;
    throw finalError;
  }
}

module.exports = {
  generateItemEstimate
};
