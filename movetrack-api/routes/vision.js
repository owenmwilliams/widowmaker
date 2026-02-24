const express = require('express');
const path = require('path');
const fs = require('fs');
const vision = require('@google-cloud/vision');
const visionService = require('../bin/visionService');
const { authenticate, resolveEffectivePlan } = require('../bin/authService');
const { verifyToken } = require('../bin/jwtMiddleware');
var router = express.Router();
const multer = require('multer');
const knex = require('knex')({
  client: 'pg',
  connection: {
    host: process.env.MT_DATALAYER_HOSTNAME,
    port: process.env.MT_DATALAYER_PORT,
    user: process.env.MT_DATALAYER_USERNAME,
    password: process.env.MT_DATALAYER_PASSWORD,
    database: process.env.MT_DATALAYER_DATABASE
  }
});
const isLocalEnvironment = process.env.NODE_ENV !== 'production'; // Detect local development environment
const BASIC_MULTI_LIMIT = parseInt(process.env.BASIC_MULTI_SCANS_PER_WEEK || '3', 10);
const usageTableReady = ensureUsageTable();



// const storageOptions = {
//   projectId: 'take-stock-364901',
// };

// if (isLocalEnvironment) {
//   storageOptions.keyFilename = path.join(__dirname, '../devkeys/service-account.json');
// }

// Create a Vision API client using the default service account identity

// Load the service account key JSON if in local/demo environment
let visionClient;
if (process.env.NODE_ENV !== 'production' || process.env.NODE_ENV === 'demo') {
  const localKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.join(__dirname, '../devkeys/service-account.json');
  if (localKeyPath && fs.existsSync(localKeyPath)) {
    const serviceAccountKey = require(localKeyPath);
    visionClient = new vision.ImageAnnotatorClient({ credentials: serviceAccountKey });
  } else {
    visionClient = new vision.ImageAnnotatorClient();
  }
} else {
  // Initialize the Google Cloud Vision API client without credentials (for production)
  visionClient = new vision.ImageAnnotatorClient();
}


// const visionClient = new vision.ImageAnnotatorClient();

// app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 5MB limit
  },
});

router.use(authenticate);

function getWeekStartDate() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day + 6) % 7;
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
  weekStart.setUTCHours(0, 0, 0, 0);
  return weekStart.toISOString().slice(0, 10);
}

async function ensureUsageTable() {
  try {
    const exists = await knex.schema.hasTable('plan_usage');
    if (!exists) {
      await knex.schema.createTable('plan_usage', (table) => {
        table.increments('id').primary();
        table.uuid('user_id').notNullable();
        table.date('week_start').notNullable();
        table.integer('multi_scans').defaultTo(0);
        table.unique(['user_id', 'week_start']);
      });
    }
  } catch (err) {
    console.error('Failed to ensure plan_usage table:', err);
  }
}

async function consumeBasicMultiScan(userId) {
  if (!userId) {
    return { allowed: false, remaining: 0, limit: BASIC_MULTI_LIMIT, nextReset: null };
  }
  await usageTableReady;
  const weekStart = getWeekStartDate();
  let usage = await knex('plan_usage').where({ user_id: userId, week_start: weekStart }).first();
  if (!usage) {
    await knex('plan_usage').insert({ user_id: userId, week_start: weekStart, multi_scans: 0 });
    usage = { multi_scans: 0 };
  }
  if (usage.multi_scans >= BASIC_MULTI_LIMIT) {
    const nextReset = new Date(weekStart);
    nextReset.setUTCDate(nextReset.getUTCDate() + 7);
    return {
      allowed: false,
      remaining: 0,
      limit: BASIC_MULTI_LIMIT,
      nextReset: nextReset.toISOString()
    };
  }
  await knex('plan_usage').where({ user_id: userId, week_start: weekStart }).increment('multi_scans', 1);
  return {
    allowed: true,
    remaining: BASIC_MULTI_LIMIT - (usage.multi_scans + 1),
    limit: BASIC_MULTI_LIMIT,
    nextReset: null
  };
}

async function getBasicMultiScanStatus(userId) {
  if (!userId) {
    return { remaining: 0, limit: BASIC_MULTI_LIMIT, nextReset: null };
  }
  await usageTableReady;
  const weekStart = getWeekStartDate();
  let usage = await knex('plan_usage').where({ user_id: userId, week_start: weekStart }).first();
  if (!usage) {
    usage = { multi_scans: 0 };
  }
  const remaining = Math.max(BASIC_MULTI_LIMIT - usage.multi_scans, 0);
  const nextReset = new Date(weekStart);
  nextReset.setUTCDate(nextReset.getUTCDate() + 7);
  return {
    remaining,
    limit: BASIC_MULTI_LIMIT,
    nextReset: nextReset.toISOString()
  };
}

// POST route to analyze an uploaded image (legacy Google Cloud Vision)
router.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const imageBuffer = req.file.buffer;

    // Analyze the image using Google Cloud Vision API
    const [result] = await visionClient.annotateImage({
      image: { content: imageBuffer },
      features: [
        { type: 'LABEL_DETECTION', maxResults: 10 },
        { type: 'TEXT_DETECTION' },
        { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
        { type: 'IMAGE_PROPERTIES', maxResults: 10 },
      ],
    });

    const labels = result.labelAnnotations.map(label => label.description);
    const objects = result.localizedObjectAnnotations.map(obj => obj.name);
    const colors = result.imagePropertiesAnnotation.dominantColors.colors;
    const detectedText = result.textAnnotations[0]?.description || '';

    res.json({ labels, objects, colors, detectedText });
  } catch (error) {
    console.error('Error analyzing image:', error);
    res.status(500).send('Internal server error');
  }
});

// POST route to analyze item photo using multimodal AI (Claude, GPT-4, or Gemini)
// REQUIRES AUTHENTICATION
// Accepts either multipart file upload OR JSON with imageUrl
router.post('/analyze-item', verifyToken, upload.single('image'), async (req, res) => {
  try {
    let imageSource, mimeType;

    // Check for image URL in body (new flow)
    if (req.body.imageUrl) {
      imageSource = req.body.imageUrl;
      mimeType = req.body.mimeType || 'image/jpeg';

      // Security: Only allow GCS URLs or data URLs (no arbitrary external URLs)
      const isGcsUrl = imageSource.includes('storage.googleapis.com') || imageSource.startsWith('gs://');
      const isDataUrl = imageSource.startsWith('data:');

      if (!isGcsUrl && !isDataUrl) {
        return res.status(400).json({ error: 'Only Google Cloud Storage URLs or data URLs are allowed' });
      }

      console.log(`Analyzing item photo from URL - Type: ${mimeType}, Provider: ${req.query.provider || req.body.provider || 'default'}`);
    }
    // Fall back to file upload (legacy flow)
    else if (req.file) {
      imageSource = req.file.buffer.toString('base64');
      mimeType = req.file.mimetype;
      console.log(`Analyzing item photo from upload - Size: ${req.file.size} bytes, Type: ${mimeType}, Provider: ${req.query.provider || req.body.provider || 'default'}`);
    }
    else {
      return res.status(400).json({ error: 'No image provided (imageUrl or file required)' });
    }

    // Get provider from query param or body (optional - defaults to current provider)
    let provider = (req.query.provider || req.body.provider || '').toLowerCase();
    const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
    const allowedBasicProviders = ['scout', 'qwen'];
    const isPro = plan === 'pro';
    if (!isPro) {
      provider = allowedBasicProviders.includes(provider) ? provider : 'scout';
    }

    // Call vision service (now supports both base64 and URLs)
    const result = await visionService.analyzeItemPhoto(imageSource, mimeType, provider);

    if (result.success) {
      // Map AI response fields to database schema
      if (result.data) {
        // Map 'color' to 'primary_color' for consistency with database schema
        if (result.data.color && !result.data.primary_color) {
          result.data.primary_color = result.data.color;
        }
        // Ensure material, primary_color, and tags are present
        result.data.material = result.data.material || null;
        result.data.primary_color = result.data.primary_color || null;
        result.data.tags = result.data.tags || [];
      }
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('Error analyzing item photo:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST route to analyze photo for multiple items
// REQUIRES AUTHENTICATION
// Accepts either multipart file upload OR JSON with imageUrl
router.post('/analyze-multi-item', verifyToken, upload.single('image'), async (req, res) => {
  try {
    let imageSource, mimeType;

    // Check for image URL in body (new flow)
    if (req.body.imageUrl) {
      imageSource = req.body.imageUrl;
      mimeType = req.body.mimeType || 'image/jpeg';

      // Security: Only allow GCS URLs or data URLs (no arbitrary external URLs)
      const isGcsUrl = imageSource.includes('storage.googleapis.com') || imageSource.startsWith('gs://');
      const isDataUrl = imageSource.startsWith('data:');

      if (!isGcsUrl && !isDataUrl) {
        return res.status(400).json({ error: 'Only Google Cloud Storage URLs or data URLs are allowed' });
      }

      console.log(`Analyzing multi-item photo from URL - Type: ${mimeType}, Provider: ${req.query.provider || req.body.provider || 'default'}`);
    }
    // Fall back to file upload (legacy flow)
    else if (req.file) {
      imageSource = req.file.buffer.toString('base64');
      mimeType = req.file.mimetype;
      console.log(`Analyzing multi-item photo from upload - Size: ${req.file.size} bytes, Type: ${mimeType}, Provider: ${req.query.provider || req.body.provider || 'default'}`);
    }
    else {
      return res.status(400).json({ error: 'No image provided (imageUrl or file required)' });
    }

    const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
    let demoInfo = null;

    // For basic plan, check quota BEFORE consuming it
    if (plan !== 'pro') {
      const status = await getBasicMultiScanStatus(req.user?.user_id);
      if (status.remaining <= 0) {
        return res.status(402).json({
          success: false,
          error: 'You have used your 3 multi-item scans this week. Upgrade to Pro for unlimited scans.',
          demoLimitReached: true,
          limit: status.limit,
          nextReset: status.nextReset
        });
      }
    }

    // Get provider from query param or body (optional - defaults to current provider)
    let provider = (req.query.provider || req.body.provider || '').toLowerCase();
    if (plan !== 'pro') {
      provider = 'scout';
    }

    // Call vision service for multi-item detection (now supports both base64 and URLs)
    const result = await visionService.analyzeMultiItemPhoto(imageSource, mimeType, provider);

    if (result.success) {
      // Only consume quota AFTER successful API call
      if (plan !== 'pro') {
        const quota = await consumeBasicMultiScan(req.user?.user_id);
        demoInfo = {
          remaining: quota.remaining,
          limit: quota.limit,
          nextReset: quota.nextReset
        };
      }

      res.json({
        ...result,
        demoInfo
      });
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('Error analyzing multi-item photo:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET multi-item quota status
router.get('/multi-quota', verifyToken, async (req, res) => {
  try {
    const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
    if (plan === 'pro') {
      return res.json({
        plan,
        limit: null,
        remaining: null,
        nextReset: null
      });
    }
    const status = await getBasicMultiScanStatus(req.user?.user_id);
    res.json({
      plan,
      ...status
    });
  } catch (error) {
    console.error('Error fetching multi quota:', error);
    res.status(500).json({ error: 'Failed to fetch quota' });
  }
});

// GET current vision provider
// REQUIRES AUTHENTICATION
router.get('/provider', verifyToken, (req, res) => {
  const plan = (resolveEffectivePlan(req) || 'pro').toLowerCase();
  const available = visionService.getAvailableProviders();
  const allowedBasicProviders = ['scout', 'qwen'];

  if (plan === 'pro') {
    return res.json({
      current: visionService.getCurrentProvider(),
      available,
      plan
    });
  }

  const safeProviders = allowedBasicProviders.filter(p => available.includes(p));
  const list = safeProviders.length ? safeProviders : allowedBasicProviders;
  const currentGlobal = visionService.getCurrentProvider();
  const current = list.includes(currentGlobal) ? currentGlobal : list[0];

  res.json({
    current,
    available: list,
    plan
  });
});

// POST set vision provider
// REQUIRES AUTHENTICATION
router.post('/provider', verifyToken, (req, res) => {
  try {
    let { provider } = req.body;
    if (!provider) {
      return res.status(400).json({ error: 'Provider is required' });
    }

    provider = String(provider).toLowerCase();
    const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
    const allowedBasicProviders = ['scout', 'qwen'];
    if (plan !== 'pro' && !allowedBasicProviders.includes(provider)) {
      return res.status(402).json({ error: 'Upgrade to Pro to use premium AI providers.' });
    }

    const newProvider = visionService.setProvider(provider);
    res.json({
      success: true,
      provider: newProvider,
      available: visionService.getAvailableProviders()
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
