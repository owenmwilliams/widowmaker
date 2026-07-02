# Scan recall eval harness

`scripts/eval-scan-recall.js` measures how well the video scan path detects the
items that are actually in a room. Until now, frame counts were tuned blind
(14 → 20 → 28) with no way to know whether a change helped. This gives a number.

## What it runs

The **real** detection path — `extractFramesForScan` + `extractAudio` +
`videoService.analyzeFrames` (with the inline `analyzeVideo` fallback). It
deliberately skips the GCS frame uploads and the `room_videos` DB write that
`analyzeVideoForInventory` does around that path: those are side effects that
don't change which items get detected, and skipping them is what lets this run
locally with only an API key.

## Requirements

- `GOOGLE_AI_API_KEY` (makes real Gemini calls — costs a little).
- `ffmpeg` — bundled via the `ffmpeg-static` dependency, no system install needed.

## Setup

1. Copy the example config and fill it in:
   ```
   cp scripts/eval/golden-set.example.json scripts/eval/golden-set.json
   ```
2. Add each video and its **ground truth** (the human-verified list of distinct
   movable items in the room — watch the clip once and list them; do NOT use the
   model's own output). Reference videos either by a public/temporary `url` or a
   local `path`.
3. **Do not commit videos.** `golden-set.json`, `videos/`, and `*.mov/*.mp4` here
   are gitignored. The first golden set is the 2026-07-01 beta session — fetch
   URLs from `room_videos`:
   ```sql
   SELECT room_name, video_url, item_count, created_at
   FROM room_videos WHERE user_id = :betaUserId ORDER BY created_at;
   ```

## Run

```
# quick sanity (3 runs/video)
node scripts/eval-scan-recall.js

# stability sweep (matches the acceptance criteria — 20 runs)
node scripts/eval-scan-recall.js --runs 20 --out /tmp/recall-report.json
```

Options: `--config`, `--runs`, `--plan basic|pro`, `--frames`, `--threshold`,
`--out`, `--no-fail`.

## Reading the output

Per video: mean ± stdev item count across runs, recall, precision, and — the
acceptance-criteria tracers — parse-error and truncation counts. With structured
output these should be **zero**; the harness exits non-zero if any occur (unless
`--no-fail`). `always-missed` lists ground-truth items no run ever found — the
persistent recall gaps.

Note: closing the recall gaps (segmented multi-pass analysis, tracking-based
dedup) is explicitly **follow-up work** — this harness establishes the baseline
so that work can be measured. File it as a separate issue with the baseline
numbers this produces.
