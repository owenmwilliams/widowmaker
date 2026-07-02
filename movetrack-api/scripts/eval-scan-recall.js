#!/usr/bin/env node
'use strict';

/**
 * eval-scan-recall.js — golden-set recall/precision harness for the video scan path.
 *
 * Pathway E (issue #44). Until now, frame counts were bumped 14→20→28 blind:
 * there was no way to tell whether a prompt or frame-count change actually helped.
 * This runs the REAL frame-analysis path over a set of videos with known
 * ground-truth item lists and reports, per video:
 *   - recall / precision against ground truth (fuzzy name match)
 *   - item-count stability across N runs (mean / stdev / min / max)
 *   - parse errors and output truncation (the acceptance-criteria tracers)
 *
 * It exercises the same detection code that determines recall in production —
 * frameExtractor.extractFramesForScan + extractAudio + videoService.analyzeFrames,
 * with the inline analyzeVideo fallback — but deliberately skips the GCS frame
 * uploads and the room_videos DB write that analyzeVideoForInventory does around
 * it. Those are side effects that don't change what items are detected, and
 * skipping them is what lets this run locally with ONLY an API key (+ ffmpeg).
 *
 * Requirements: GOOGLE_AI_API_KEY, ffmpeg (bundled via ffmpeg-static).
 *
 * Usage:
 *   node scripts/eval-scan-recall.js --config scripts/eval/golden-set.json --runs 3
 *   node scripts/eval-scan-recall.js --config scripts/eval/golden-set.json --runs 20 --out /tmp/recall.json
 *
 * Options:
 *   --config <path>   Ground-truth config, JSON (see scripts/eval/golden-set.example.json). Default: scripts/eval/golden-set.json
 *   --runs <n>        Runs per video (default 3). Use 20 for a stability sweep.
 *   --plan <basic|pro>  Model tier (default basic).
 *   --frames <n>      Max frames sampled per run (default 28 — production value).
 *   --threshold <f>   Fuzzy-match token-overlap threshold 0..1 (default 0.5).
 *   --out <path>      Also write the full report as JSON.
 *   --no-fail         Exit 0 even if parse errors / truncation occur (default: exit 2).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');

const { analyzeFrames, analyzeVideo } = require('../services/infra/vision/videoService');
const { extractFramesForScan, extractAudio } = require('../services/infra/vision/frameExtractor');

// ── args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { runs: 3, plan: 'basic', frames: 28, threshold: 0.5, fail: true, config: 'scripts/eval/golden-set.json', out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--config': out.config = argv[++i]; break;
      case '--runs': out.runs = parseInt(argv[++i], 10); break;
      case '--plan': out.plan = argv[++i]; break;
      case '--frames': out.frames = parseInt(argv[++i], 10); break;
      case '--threshold': out.threshold = parseFloat(argv[++i]); break;
      case '--out': out.out = argv[++i]; break;
      case '--no-fail': out.fail = false; break;
      case '--help': case '-h': out.help = true; break;
      default: console.warn(`[eval] ignoring unknown arg: ${a}`);
    }
  }
  return out;
}

// ── name matching ──────────────────────────────────────────────────────────
const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'with', 'and', 'set', 'unit', 'inch', 'inches', 'in']);

/** Normalize an item name into a set of comparison tokens. */
function tokenize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/["'.,()/\\-]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/s$/, '')) // crude singularization
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Jaccard token overlap of two names, plus a containment boost. */
function nameSimilarity(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  const jaccard = inter / union;
  // Containment: "tv" vs "55 tv" — reward when all tokens of the smaller set match.
  const smaller = ta.size <= tb.size ? ta : tb;
  const larger = ta.size <= tb.size ? tb : ta;
  let containedAll = true;
  for (const t of smaller) if (!larger.has(t)) { containedAll = false; break; }
  return containedAll ? Math.max(jaccard, 0.8) : jaccard;
}

/**
 * Greedy one-to-one match of ground-truth names to detected names.
 * Returns { matchedGt: Set<index>, matchedDet: Set<index>, pairs: [...] }.
 */
function matchItems(groundTruth, detected, threshold) {
  const pairs = [];
  const matchedGt = new Set();
  const matchedDet = new Set();
  // Score all candidate pairs, then greedily take the best available.
  const scored = [];
  for (let g = 0; g < groundTruth.length; g++) {
    for (let d = 0; d < detected.length; d++) {
      const s = nameSimilarity(groundTruth[g], detected[d]);
      if (s >= threshold) scored.push({ g, d, s });
    }
  }
  scored.sort((x, y) => y.s - x.s);
  for (const { g, d, s } of scored) {
    if (matchedGt.has(g) || matchedDet.has(d)) continue;
    matchedGt.add(g);
    matchedDet.add(d);
    pairs.push({ groundTruth: groundTruth[g], detected: detected[d], score: Number(s.toFixed(2)) });
  }
  return { matchedGt, matchedDet, pairs };
}

// ── stats ────────────────────────────────────────────────────────────────────
function stats(nums) {
  if (nums.length === 0) return { mean: 0, stdev: 0, min: 0, max: 0 };
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return { mean: Number(mean.toFixed(2)), stdev: Number(Math.sqrt(variance).toFixed(2)), min: Math.min(...nums), max: Math.max(...nums) };
}

// ── download (status-checked, unlike the prod downloadBuffer) ─────────────────
function downloadToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('download timeout')));
  });
}

// ── one analysis run (the real detection path) ────────────────────────────────
async function analyzeOnce(source, video, opts) {
  const started = Date.now();
  let frames = [];
  try {
    frames = await extractFramesForScan(source, { maxFrames: opts.frames, fps: 1 });
  } catch (e) {
    console.warn(`[eval]   frame extraction failed: ${e.message}`);
  }

  let audio = null;
  try {
    audio = await extractAudio(source);
  } catch (_) { /* best-effort, as in prod */ }

  let result;
  let pathTaken;
  if (frames.length > 0) {
    pathTaken = 'frames';
    result = await analyzeFrames(frames, opts.plan, video.room_hint || null, audio);
  } else {
    pathTaken = 'inline';
    // Inline fallback needs the raw bytes + a mime type.
    const buffer = fs.readFileSync(source);
    result = await analyzeVideo(buffer, video.mime_type || 'video/mp4', opts.plan, null, video.room_hint || null);
  }

  const items = (result.items || []).filter((it) => it && it.name);
  return {
    pathTaken,
    frameCount: frames.length,
    itemCount: items.length,
    names: items.map((it) => it.name),
    parseError: result.parseError || null,
    truncated: !!result.truncated,
    elapsedMs: Date.now() - started,
  };
}

// ── per-video evaluation ──────────────────────────────────────────────────────
async function evalVideo(video, opts) {
  const gt = Array.isArray(video.ground_truth) ? video.ground_truth : [];
  console.log(`\n[eval] ── ${video.id} — ${gt.length} ground-truth items, ${opts.runs} run(s) ──`);

  // Resolve the source to a local file (download once, reuse across runs).
  let source = video.path;
  let tmp = null;
  if (!source && video.url) {
    tmp = path.join(os.tmpdir(), `eval-${video.id.replace(/[^\w.-]/g, '_')}-${process.pid}.mov`);
    console.log(`[eval]   downloading ${video.url}`);
    source = await downloadToFile(video.url, tmp);
  }
  if (!source) throw new Error(`video "${video.id}" has neither path nor url`);
  if (!fs.existsSync(source)) throw new Error(`video source not found: ${source}`);

  const runs = [];
  try {
    for (let r = 0; r < opts.runs; r++) {
      const run = await analyzeOnce(source, video, opts);
      const { matchedGt, matchedDet, pairs } = matchItems(gt, run.names, opts.threshold);
      const recall = gt.length ? matchedGt.size / gt.length : null;
      const precision = run.names.length ? matchedDet.size / run.names.length : null;
      const missed = gt.filter((_, i) => !matchedGt.has(i));
      run.recall = recall;
      run.precision = precision;
      run.matched = matchedGt.size;
      run.missed = missed;
      run.pairs = pairs;
      runs.push(run);
      console.log(
        `[eval]   run ${r + 1}/${opts.runs}: ${run.itemCount} items (${run.pathTaken}, ${run.frameCount} frames), ` +
        `recall ${fmtPct(recall)}, precision ${fmtPct(precision)}, ${run.elapsedMs}ms` +
        `${run.parseError ? ' PARSE_ERROR' : ''}${run.truncated ? ' TRUNCATED' : ''}`
      );
    }
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch (_) {} }
  }

  const countStats = stats(runs.map((r) => r.itemCount));
  const recallStats = stats(runs.filter((r) => r.recall != null).map((r) => r.recall));
  const precisionStats = stats(runs.filter((r) => r.precision != null).map((r) => r.precision));
  return {
    id: video.id,
    room_hint: video.room_hint || null,
    groundTruthCount: gt.length,
    runs,
    itemCount: countStats,
    recall: recallStats,
    precision: precisionStats,
    parseErrors: runs.filter((r) => r.parseError).length,
    truncations: runs.filter((r) => r.truncated).length,
    // Items never found in ANY run — the persistent recall gaps worth chasing.
    alwaysMissed: gt.filter((name) => runs.every((r) => !r.pairs.some((p) => p.groundTruth === name))),
  };
}

function fmtPct(x) {
  return x == null ? ' n/a ' : `${(x * 100).toFixed(0)}%`;
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 40).join('\n'));
    return;
  }
  if (!process.env.GOOGLE_AI_API_KEY) {
    console.error('[eval] GOOGLE_AI_API_KEY is not set — this harness makes real Gemini calls. Aborting.');
    process.exit(1);
  }

  const configPath = path.resolve(opts.config);
  if (!fs.existsSync(configPath)) {
    console.error(`[eval] config not found: ${configPath}`);
    console.error('[eval] Copy scripts/eval/golden-set.example.json to scripts/eval/golden-set.json and fill in videos + ground truth.');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (config.matching && typeof config.matching.threshold === 'number' && !process.argv.includes('--threshold')) {
    opts.threshold = config.matching.threshold;
  }
  const videos = Array.isArray(config.videos) ? config.videos : [];
  if (videos.length === 0) {
    console.error('[eval] config has no videos');
    process.exit(1);
  }

  console.log(`[eval] config=${configPath} runs=${opts.runs} plan=${opts.plan} frames=${opts.frames} threshold=${opts.threshold}`);

  const results = [];
  for (const video of videos) {
    try {
      results.push(await evalVideo(video, opts));
    } catch (e) {
      console.error(`[eval] video "${video.id}" failed: ${e.message}`);
      results.push({ id: video.id, error: e.message, parseErrors: 0, truncations: 0 });
    }
  }

  // ── report ──
  const totalParseErrors = results.reduce((a, r) => a + (r.parseErrors || 0), 0);
  const totalTruncations = results.reduce((a, r) => a + (r.truncations || 0), 0);

  console.log('\n[eval] ══════════════════ SUMMARY ══════════════════');
  console.log('video                         gt   items(mean±sd)   recall   prec   parseErr  trunc');
  for (const r of results) {
    if (r.error) { console.log(`${pad(r.id, 28)}  ERROR: ${r.error}`); continue; }
    console.log(
      `${pad(r.id, 28)}  ${pad(r.groundTruthCount, 3)}  ${pad(`${r.itemCount.mean}±${r.itemCount.stdev}`, 13)}  ` +
      `${pad(fmtPct(r.recall.mean), 6)}  ${pad(fmtPct(r.precision.mean), 5)}  ${pad(r.parseErrors, 8)}  ${r.truncations}`
    );
    if (r.alwaysMissed && r.alwaysMissed.length) {
      console.log(`${pad('', 28)}  always-missed: ${r.alwaysMissed.join(', ')}`);
    }
  }
  console.log('[eval] ═══════════════════════════════════════════════');
  console.log(`[eval] parse errors: ${totalParseErrors} | truncations: ${totalTruncations}`);
  console.log('[eval] NOTE: recall gaps (headline items missed) are follow-up work — this harness measures the baseline; deeper recall is a separate issue.');

  const report = {
    generatedAtMs: Date.now(),
    options: opts,
    totals: { parseErrors: totalParseErrors, truncations: totalTruncations, videos: results.length },
    results,
  };
  if (opts.out) {
    fs.writeFileSync(opts.out, JSON.stringify(report, null, 2));
    console.log(`[eval] wrote report → ${opts.out}`);
  }

  if (opts.fail && (totalParseErrors > 0 || totalTruncations > 0)) {
    console.error(`[eval] FAIL: ${totalParseErrors} parse error(s), ${totalTruncations} truncation(s) — the structured-output contract should produce zero. (use --no-fail to override)`);
    process.exit(2);
  }
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

if (require.main === module) {
  main().catch((e) => { console.error('[eval] fatal:', e); process.exit(1); });
}

module.exports = { tokenize, nameSimilarity, matchItems, stats };
