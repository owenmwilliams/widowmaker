const express = require('express');
const multer = require('multer');
const visionService = require('../../../services/infra/vision/imageService');
const { authenticate, resolveEffectivePlan } = require('../../../services/infra/authService');
const { resolveImageSource } = require('../../../services/infra/gcsService');
const { getBasicMultiScanStatus, consumeBasicMultiScan, BASIC_MULTI_LIMIT } = require('../../../services/workflow/userService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.use(authenticate);

// ── POST /analyze-item ────────────────────────────────────────────────────────
// Single item photo analysis. Accepts file upload or JSON with imageUrl.
router.post('/analyze-item', upload.single('image'), async (req, res) => {
  const requestId = `single-${Date.now()}`;
  try {
    const { imageSource, mimeType, error } = resolveImageSource(req);
    if (error) return res.status(400).json({ error });

    const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
    const isAdmin = visionService.isAdminUser(req);
    const provider = visionService.resolveProvider({
      plan,
      isAdmin,
      requestedProvider: req.query.provider || req.body.provider || '',
    });
    const itemHint = req.body.itemHint || null;

    const result = await visionService.analyzeItemPhoto(imageSource, mimeType, provider, undefined, itemHint);

    if (result.success) {
      if (result.data) result.data = visionService.normalizeItemResult(result.data);
      return res.json(result);
    }
    res.status(500).json(result);
  } catch (err) {
    console.error(`[${requestId}] analyze-item fatal:`, err.message);
    res.status(500).json({ success: false, error: err.message, requestId });
  }
});

// ── POST /analyze-multi-item ──────────────────────────────────────────────────
// Multi-item detection from a single photo. Basic plan: 3 scans/week.
router.post('/analyze-multi-item', upload.single('image'), async (req, res) => {
  try {
    const { imageSource, mimeType, error } = resolveImageSource(req);
    if (error) return res.status(400).json({ error });

    const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();

    if (plan !== 'pro') {
      const status = await getBasicMultiScanStatus(req.user?.user_id);
      if (status.remaining <= 0) {
        return res.status(402).json({
          success: false,
          error: `You have used your ${BASIC_MULTI_LIMIT} multi-item scans this week. Upgrade to Pro for unlimited scans.`,
          demoLimitReached: true,
          limit: status.limit,
          nextReset: status.nextReset,
        });
      }
    }

    const provider = visionService.resolveMultiProvider({ plan, isAdmin: visionService.isAdminUser(req) });
    const result = await visionService.analyzeMultiItemPhoto(imageSource, mimeType, provider);

    if (result.success) {
      let demoInfo = null;
      if (plan !== 'pro') {
        const quota = await consumeBasicMultiScan(req.user?.user_id);
        demoInfo = { remaining: quota.remaining, limit: quota.limit, nextReset: quota.nextReset };
      }
      return res.json({ ...result, demoInfo });
    }
    res.status(500).json(result);
  } catch (err) {
    console.error('[vision] analyze-multi-item fatal:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /multi-quota ──────────────────────────────────────────────────────────
// Returns remaining multi-item scan quota for the current week.
router.get('/multi-quota', async (req, res) => {
  try {
    const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
    if (plan === 'pro') {
      return res.json({ plan, limit: null, remaining: null, nextReset: null });
    }
    const status = await getBasicMultiScanStatus(req.user?.user_id);
    res.json({ plan, ...status });
  } catch (err) {
    console.error('[vision] multi-quota error:', err.message);
    res.status(500).json({ error: 'Failed to fetch quota' });
  }
});

// ── GET /provider ─────────────────────────────────────────────────────────────
// Returns the current vision AI provider and available options for the user's plan.
router.get('/provider', (req, res) => {
  const plan = (resolveEffectivePlan(req) || 'pro').toLowerCase();
  const available = visionService.getAvailableProviders();
  const allowedBasicProviders = ['gemini'];

  if (plan === 'pro') {
    return res.json({ current: visionService.getCurrentProvider(), available, plan });
  }

  const safeProviders = allowedBasicProviders.filter(p => available.includes(p));
  res.json({ current: 'gemini', available: safeProviders.length ? safeProviders : allowedBasicProviders, plan });
});

// ── POST /provider ────────────────────────────────────────────────────────────
// Set the active vision AI provider (pro/admin only for non-Gemini providers).
router.post('/provider', express.json(), (req, res) => {
  try {
    let { provider } = req.body;
    if (!provider) return res.status(400).json({ error: 'Provider is required' });

    provider = String(provider).toLowerCase();
    const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
    if (plan !== 'pro' && provider !== 'gemini') {
      return res.status(402).json({ error: 'Upgrade to Pro to use premium AI providers.' });
    }

    const newProvider = visionService.setProvider(provider);
    res.json({ success: true, provider: newProvider, available: visionService.getAvailableProviders() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /test-provider ───────────────────────────────────────────────────────
// Admin-only: test whether a vision provider is functional.
router.post('/test-provider', express.json(), async (req, res) => {
  const requestId = `test-${Date.now()}`;
  try {
    const { provider } = req.body;
    if (!provider) return res.status(400).json({ error: 'Provider is required' });
    if (!visionService.isAdminUser(req)) return res.status(403).json({ error: 'Admin access required' });

    // Minimal 1×1 red pixel PNG (smallest valid test image)
    const testImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const startTime = Date.now();
    try {
      const result = await visionService.analyzeItemPhoto(testImage, 'image/png', provider);
      res.json({ success: result.success, provider: result.provider, model: result.model, elapsedTimeMs: Date.now() - startTime, error: result.error || null });
    } catch (err) {
      res.json({ success: false, provider, elapsedTimeMs: Date.now() - startTime, error: err.message });
    }
  } catch (err) {
    console.error(`[${requestId}] test-provider fatal:`, err.message);
    res.status(500).json({ success: false, error: err.message, requestId });
  }
});

// ── POST /analyze-batch ───────────────────────────────────────────────────────
// Batch analyze up to 50 images in parallel (used by MobileLiveScan).
router.post('/analyze-batch', express.json(), async (req, res) => {
  const requestId = `batch-${Date.now()}`;
  try {
    const { images } = req.body;

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ success: false, error: 'images array is required and must not be empty' });
    }
    if (images.length > 50) {
      return res.status(400).json({ success: false, error: 'Maximum 50 images per batch' });
    }

    const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
    const isAdmin = visionService.isAdminUser(req);
    const provider = visionService.resolveProvider({ plan, isAdmin, requestedProvider: req.query.provider || req.body.provider || '' });

    const startTime = Date.now();
    const settled = await Promise.allSettled(
      images.map(async (imageDataUrl, index) => {
        try {
          let imageSource, mimeType;
          if (imageDataUrl.startsWith('data:')) {
            const [metadata, base64Data] = imageDataUrl.split(',');
            const mimeMatch = metadata.match(/^data:(.*?);base64$/);
            mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
            imageSource = base64Data;
          } else {
            imageSource = imageDataUrl;
            mimeType = 'image/jpeg';
          }
          const result = await visionService.analyzeItemPhoto(imageSource, mimeType, provider);
          return { index, ...result };
        } catch (err) {
          return { index, success: false, error: err.message };
        }
      })
    );

    const elapsedTime = Date.now() - startTime;
    const results = settled.map((r, index) =>
      r.status === 'fulfilled' ? r.value : { index, success: false, error: r.reason?.message || 'Unknown error' }
    );
    const successCount = results.filter(r => r.success).length;

    res.json({
      success: true,
      results,
      summary: { total: images.length, successful: successCount, failed: results.length - successCount, provider, elapsedTimeMs: elapsedTime },
    });
  } catch (err) {
    console.error(`[${requestId}] analyze-batch fatal:`, err.message);
    res.status(500).json({ success: false, error: err.message, requestId });
  }
});

module.exports = router;
