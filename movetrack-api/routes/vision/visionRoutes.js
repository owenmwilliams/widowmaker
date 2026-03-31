const express = require('express');
const path = require('path');
const fs = require('fs');
const vision = require('@google-cloud/vision');
const visionService = require('../../services/vision/visionService');
const augmentationService = require('../../services/vision/augmentationService');
const { authenticate, resolveEffectivePlan } = require('../../services/infra/authService');
const { verifyToken } = require('../../services/infra/jwtMiddleware');
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
  },
  pool: { min: 0, max: 5, acquireTimeoutMillis: 30000 }
});
const isLocalEnvironment = process.env.NODE_ENV !== 'production'; // Detect local development environment
const BASIC_MULTI_LIMIT = parseInt(process.env.BASIC_MULTI_SCANS_PER_WEEK || '3', 10);
const usageTableReady = ensureUsageTable();



// const storageOptions = {
//   projectId: 'take-stock-364901',
// };

// if (isLocalEnvironment) {
//   storageOptions.keyFilename = path.join(__dirname, '../../devkeys/service-account.json');
// }

// Create a Vision API client using the default service account identity

// Load the service account key JSON if in local/demo environment
let visionClient;
if (process.env.NODE_ENV !== 'production' || process.env.NODE_ENV === 'demo') {
  const localKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.join(__dirname, '../../devkeys/service-account.json');
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

async function ensureUsageTable(attempt = 1) {
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
    if (attempt < 3) {
      console.warn(`[vision] ensureUsageTable failed (attempt ${attempt}), retrying in 2s...`, err.code || err.message);
      await new Promise(r => setTimeout(r, 2000));
      return ensureUsageTable(attempt + 1);
    }
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
  const requestId = `single-${Date.now()}`;
  console.log(`[${requestId}] === Single item analyze request ===`);
  console.log(`[${requestId}] User:`, req.user?.user_id);
  console.log(`[${requestId}] Has file:`, !!req.file);
  console.log(`[${requestId}] Body keys:`, Object.keys(req.body));
  console.log(`[${requestId}] Query params:`, req.query);

  try {
    let imageSource, mimeType;
    const itemHint = req.body.itemHint || null;

    // Check for image URL in body (new flow)
    if (req.body.imageUrl) {
      imageSource = req.body.imageUrl;
      mimeType = req.body.mimeType || 'image/jpeg';

      console.log(`[${requestId}] Image from URL:`, {
        urlLength: imageSource.length,
        mimeType,
        startsWithData: imageSource.startsWith('data:'),
        startsWithGCS: imageSource.includes('storage.googleapis.com')
      });

      // Security: Only allow GCS URLs or data URLs (no arbitrary external URLs)
      const isGcsUrl = imageSource.includes('storage.googleapis.com') || imageSource.startsWith('gs://');
      const isDataUrl = imageSource.startsWith('data:');

      if (!isGcsUrl && !isDataUrl) {
        console.log(`[${requestId}] ERROR: Invalid URL type`);
        return res.status(400).json({ error: 'Only Google Cloud Storage URLs or data URLs are allowed' });
      }
    }
    // Fall back to file upload (legacy flow)
    else if (req.file) {
      imageSource = req.file.buffer.toString('base64');
      mimeType = req.file.mimetype;
      console.log(`[${requestId}] Image from file upload:`, {
        size: req.file.size,
        mimeType,
        base64Length: imageSource.length
      });
    }
    else {
      console.log(`[${requestId}] ERROR: No image provided`);
      return res.status(400).json({ error: 'No image provided (imageUrl or file required)' });
    }

    // Get provider from query param or body (optional - defaults based on plan)
    let provider = (req.query.provider || req.body.provider || '').toLowerCase();

    // Check if user is admin
    const ADMIN_USERS = (process.env.ADMIN_USERS || '').toLowerCase().split(',').map(e => e.trim()).filter(Boolean);
    const isAdmin = req.user?.is_admin || ADMIN_USERS.includes(req.user?.email?.toLowerCase());
    const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();

    if (isAdmin) {
      // Admin: allow any provider from request or use current default
      provider = provider || visionService.getCurrentProvider();
    } else if (plan === 'pro') {
      // Pro users: Gemini 2.5 Pro for single item
      provider = 'gemini-pro';
    } else {
      // Basic users: Gemini 2.5 Flash
      provider = 'gemini';
    }

    console.log(`[${requestId}] Processing:`, { plan, provider, isAdmin });

    // Call vision service (now supports both base64 and URLs)
    console.log(`[${requestId}] Calling visionService.analyzeItemPhoto`, itemHint ? `(hint: ${itemHint})` : '');
    const result = await visionService.analyzeItemPhoto(imageSource, mimeType, provider, undefined, itemHint);

    console.log(`[${requestId}] Vision service result:`, {
      success: result.success,
      hasData: !!result.data,
      provider: result.provider,
      error: result.error
    });

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
      console.log(`[${requestId}] Sending success response`);
      res.json(result);
    } else {
      console.log(`[${requestId}] Sending error response (500):`, result.error);
      res.status(500).json(result);
    }
  } catch (error) {
    console.error(`[${requestId}] FATAL ERROR:`, {
      message: error.message,
      stack: error.stack,
      type: error.constructor.name
    });
    res.status(500).json({
      success: false,
      error: error.message,
      requestId
    });
  }
});

// POST route to augment a single item from an image (callable by frontend)
// REQUIRES AUTHENTICATION
// Accepts either multipart file upload OR JSON with imageUrl
router.post('/augment-item', verifyToken, upload.single('image'), async (req, res) => {
  const requestId = `augment-${Date.now()}`;
  console.log(`[${requestId}] === Augment item request ===`);
  console.log(`[${requestId}] User:`, req.user?.user_id);

  try {
    let imageSource, mimeType;
    const itemHint = req.body.itemHint || null;

    if (req.body.imageUrl) {
      imageSource = req.body.imageUrl;
      mimeType = req.body.mimeType || 'image/jpeg';

      const isGcsUrl = imageSource.includes('storage.googleapis.com') || imageSource.startsWith('gs://');
      const isDataUrl = imageSource.startsWith('data:');
      if (!isGcsUrl && !isDataUrl) {
        return res.status(400).json({ error: 'Only Google Cloud Storage URLs or data URLs are allowed' });
      }
    } else if (req.file) {
      imageSource = req.file.buffer.toString('base64');
      mimeType = req.file.mimetype;
    } else {
      return res.status(400).json({ error: 'No image provided (imageUrl or file required)' });
    }

    let provider = (req.query.provider || req.body.provider || '').toLowerCase();
    const ADMIN_USERS = (process.env.ADMIN_USERS || '').toLowerCase().split(',').map(e => e.trim()).filter(Boolean);
    const isAdmin = req.user?.is_admin || ADMIN_USERS.includes(req.user?.email?.toLowerCase());
    const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();

    if (isAdmin) {
      provider = provider || visionService.getCurrentProvider();
    } else if (plan === 'pro') {
      provider = 'gemini-pro';
    } else {
      provider = 'gemini';
    }

    const result = await augmentationService.augmentItemFromImage(imageSource, mimeType, provider, itemHint);
    if (result.success) {
      if (result.data) {
        if (result.data.color && !result.data.primary_color) {
          result.data.primary_color = result.data.color;
        }
        result.data.material = result.data.material || null;
        result.data.primary_color = result.data.primary_color || null;
        result.data.tags = result.data.tags || [];
      }
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error(`[${requestId}] Augmentation error:`, error.message);
    res.status(500).json({ success: false, error: error.message, requestId });
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

    // Get provider from query param or body (optional - defaults based on plan)
    let provider = (req.query.provider || req.body.provider || '').toLowerCase();
    if (plan === 'pro') {
      provider = 'gemini-3-pro'; // Pro: Gemini 3.1 Pro Preview
    } else {
      provider = 'gemini'; // Basic: Gemini 2.5 Flash
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
  const allowedBasicProviders = ['gemini'];

  if (plan === 'pro') {
    return res.json({
      current: visionService.getCurrentProvider(),
      available,
      plan
    });
  }

  const safeProviders = allowedBasicProviders.filter(p => available.includes(p));
  const list = safeProviders.length ? safeProviders : allowedBasicProviders;
  const current = 'gemini';

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
    const allowedBasicProviders = ['gemini'];
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

// POST test provider connection (admin only)
// REQUIRES AUTHENTICATION + ADMIN
// Tests if a vision AI provider is working correctly
router.post('/test-provider', verifyToken, async (req, res) => {
  const requestId = `test-${Date.now()}`;
  console.log(`[${requestId}] === Provider test request ===`);

  try {
    const { provider } = req.body;

    if (!provider) {
      return res.status(400).json({ error: 'Provider is required' });
    }

    // Check if user is admin
    const ADMIN_USERS = (process.env.ADMIN_USERS || '').toLowerCase().split(',').map(e => e.trim()).filter(Boolean);
    const isAdmin = req.user?.is_admin || ADMIN_USERS.includes(req.user?.email?.toLowerCase());

    if (!isAdmin) {
      console.log(`[${requestId}] ERROR: Non-admin user attempted to test provider`);
      return res.status(403).json({ error: 'Admin access required' });
    }

    console.log(`[${requestId}] Testing provider:`, provider);

    // Create minimal 1x1 pixel test image (red pixel, PNG format, base64)
    // This is the smallest valid PNG image possible
    const testImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

    const startTime = Date.now();
    try {
      const result = await visionService.analyzeItemPhoto(testImage, 'image/png', provider);
      const elapsedTime = Date.now() - startTime;

      console.log(`[${requestId}] Test result:`, {
        success: result.success,
        provider: result.provider,
        model: result.model,
        elapsedTime
      });

      res.json({
        success: result.success,
        provider: result.provider,
        model: result.model,
        elapsedTimeMs: elapsedTime,
        error: result.error || null
      });
    } catch (error) {
      const elapsedTime = Date.now() - startTime;
      console.error(`[${requestId}] Test failed:`, error);

      res.json({
        success: false,
        provider,
        elapsedTimeMs: elapsedTime,
        error: error.message
      });
    }
  } catch (error) {
    console.error(`[${requestId}] FATAL ERROR:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId
    });
  }
});

// POST batch analyze items
// REQUIRES AUTHENTICATION
// Accepts array of data URLs (base64 encoded images)
router.post('/analyze-batch', verifyToken, async (req, res) => {
  const requestId = `batch-${Date.now()}`;
  console.log(`[${requestId}] === Batch analyze request started ===`);
  console.log(`[${requestId}] Request body keys:`, Object.keys(req.body));
  console.log(`[${requestId}] User:`, req.user?.user_id);

  try {
    const { images, category } = req.body;

    console.log(`[${requestId}] Images received:`, {
      isArray: Array.isArray(images),
      count: images?.length,
      category
    });

    if (!Array.isArray(images) || images.length === 0) {
      console.log(`[${requestId}] ERROR: Invalid images array`);
      return res.status(400).json({
        success: false,
        error: 'images array is required and must not be empty'
      });
    }

    if (images.length > 50) {
      console.log(`[${requestId}] ERROR: Too many images (${images.length})`);
      return res.status(400).json({
        success: false,
        error: 'Maximum 50 images per batch'
      });
    }

    // Get provider based on plan
    let provider = (req.query.provider || req.body.provider || '').toLowerCase();

    // Check if user is admin
    const ADMIN_USERS = (process.env.ADMIN_USERS || '').toLowerCase().split(',').map(e => e.trim()).filter(Boolean);
    const isAdmin = req.user?.is_admin || ADMIN_USERS.includes(req.user?.email?.toLowerCase());
    const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();

    if (isAdmin) {
      // Admin: allow any provider from request or use current default
      provider = provider || visionService.getCurrentProvider();
    } else if (plan === 'pro') {
      // Paid users: force Claude
      provider = 'claude';
    } else {
      // Free users: force Gemini
      provider = 'gemini';
    }

    console.log(`[${requestId}] Processing ${images.length} items:`, {
      category: category || 'all',
      plan,
      provider,
      isAdmin,
      imageLengths: images.map((img, i) => ({ index: i, length: img?.length || 0 }))
    });

    // Process all images in parallel
    const startTime = Date.now();
    const results = await Promise.allSettled(
      images.map(async (imageDataUrl, index) => {
        const itemId = `${requestId}-${index}`;
        try {
          console.log(`[${itemId}] Starting analysis`);

          // Extract base64 and mime type from data URL
          const isDataUrl = imageDataUrl.startsWith('data:');
          let imageSource, mimeType;

          if (isDataUrl) {
            const [metadata, base64Data] = imageDataUrl.split(',');
            const mimeMatch = metadata.match(/^data:(.*?);base64$/);
            mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
            imageSource = base64Data;
            console.log(`[${itemId}] Extracted from data URL:`, {
              mimeType,
              base64Length: base64Data.length
            });
          } else {
            // Assume it's already base64
            imageSource = imageDataUrl;
            mimeType = 'image/jpeg';
            console.log(`[${itemId}] Using as raw base64:`, {
              mimeType,
              length: imageDataUrl.length
            });
          }

          console.log(`[${itemId}] Calling visionService.analyzeItemPhoto with provider: ${provider}`);
          const result = await visionService.analyzeItemPhoto(imageSource, mimeType, provider);
          console.log(`[${itemId}] Result:`, { success: result.success, hasData: !!result.data });

          return {
            index,
            ...result
          };
        } catch (error) {
          console.error(`[${itemId}] ERROR:`, {
            message: error.message,
            stack: error.stack
          });
          return {
            index,
            success: false,
            error: error.message
          };
        }
      })
    );

    const elapsedTime = Date.now() - startTime;
    console.log(`[${requestId}] All items processed in ${elapsedTime}ms`);

    // Format results
    const formattedResults = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.error(`[${requestId}] Item ${index} rejected:`, result.reason);
        return {
          index,
          success: false,
          error: result.reason?.message || 'Unknown error'
        };
      }
    });

    const successCount = formattedResults.filter(r => r.success).length;
    const failureCount = formattedResults.length - successCount;

    console.log(`[${requestId}] Final summary:`, {
      total: images.length,
      successful: successCount,
      failed: failureCount,
      provider,
      elapsedTime
    });

    const response = {
      success: true,
      results: formattedResults,
      summary: {
        total: images.length,
        successful: successCount,
        failed: failureCount,
        provider,
        elapsedTimeMs: elapsedTime
      }
    };

    console.log(`[${requestId}] Sending response`);
    res.json(response);
  } catch (error) {
    console.error(`[${requestId}] FATAL ERROR:`, {
      message: error.message,
      stack: error.stack,
      type: error.constructor.name
    });
    res.status(500).json({
      success: false,
      error: error.message,
      requestId
    });
  }
});

module.exports = router;
