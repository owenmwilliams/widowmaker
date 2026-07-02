# Beta scan reliability: investigation, diagnosis, and logging gaps

**Date:** 2026-07-01
**Scope:** Reliability of logging inventory items from photos/videos (the "scan my dining room" flow), based on the most recent beta test.
**Caveat:** This investigation was run from a sandbox with no production credentials (no Cloud SQL, GCS, or Cloud Logging access). Section 2 is a runbook of exactly what to pull from prod; Sections 3–4 are a code-level diagnosis of the failure modes that best explain the beta symptoms; Section 5 is the logging-gap assessment and recommendations.

---

## 0. UPDATE — confirmed diagnosis from the 2026-07-01 beta session data

Prod exports (nexus_messages transcript, beta_interaction_logs, room_videos, items, user_costs) for the beta session confirmed the diagnosis. The session: onboarding at 20:20, Living Room video at 20:57 (worked — 23 detected, 22 committed), then a Dining Room video analyzed **four times** between 21:11 and 21:17 (2, 2, 9, 3 items — none committed), user gave up, returned at 23:00, re-recorded twice (12 items, then 6), finally committed 5 items at 23:17, and ended with duplicate rows in the inventory.

### 0.1 Primary failure: intermittent frame extraction → silent fallback to inline video analysis

Items only receive a `picture_url` when the frames path runs (`mediaInventoryWorkflowService.js:216-222`); the inline fallback (`:229-231`) never attaches one. That makes `withPic` a perfect tracer in the tool results:

| Time | Video | itemCount | items with picture | Path taken |
|---|---|---|---|---|
| 20:59 | Living Room | **23** | 22 | frames ✅ |
| 21:11 | Dining #1 | **2** | 0 | **inline fallback** |
| 21:13 | Dining #1 (same file) | **2** | 1 | partial frames |
| 21:15 | Dining #1 (same file) | **9** | 8 | frames ✅ |
| 21:17 | Dining #1 (same file) | **3** | 0 | **inline fallback** |
| 23:08 | Dining #2 | **12** | 11 | frames ✅ |
| 23:16 | Dining #3 | **6** | 0 | **inline fallback** |

The **same video file** produced 2, 2, 9, 3 items across four runs — item count correlates exactly with whether frames were extracted, and failure is intermittent, i.e. not a property of the video. The inline fallback is the pre-#24 "only 2 items" bug reintroduced as a silent degradation: Gemini clearly received the full clip inline (the narration notes in `room_videos` are rich and accurate every time) but its low-res inline item recall is terrible. `parseError` was null throughout; `success: true` throughout — nothing surfaced the degradation to the user or to telemetry.

Suspected root causes of the intermittent extraction failure (both fit; Cloud Run logs will disambiguate — see 0.5):
- `downloadBuffer` (`:26-36`) has no HTTP status check, no timeout, no retry, and no Content-Length verification — a truncated GCS download yields a `.mov` whose trailing `moov` atom is missing, which ffmpeg cannot open (0 frames) or only partially decodes (few frames, cf. the 21:13 run).
- Cloud Run default 512MB where `/tmp` is tmpfs (counts toward memory): video buffer + tmp file + ffmpeg + 28 JPEGs under any concurrency is genuine OOM territory.

### 0.2 Photo failure: wine photo returned 0 items in 460ms, reported as success

At 23:18 the user sent a photo of their wine (mentioned repeatedly: 90–180 bottles, the single biggest packing concern) plus four explicitly described boxes. `analyze_photo` returned `itemCount: 0, ok: true` with `visionMs: 460` — far too fast for a real vision call. Something failed before or at the provider and was swallowed into an empty-but-successful result (the `result.data?.items || result.items || []` pattern at `:105`, or an error-page buffer from `downloadBuffer`). The four explicit boxes were added; the wine never was, and the user was told the photo "didn't come through with any detectable items."

### 0.3 Agent refused to rescan; then duplicates from two parallel add paths

- At 23:00 and 23:01 the user asked twice to re-analyze; **no `analyze_video` call was made either turn** — the census LLM apologized from context ("it's consistently failing") instead of running the tool. Media re-analysis is at LLM discretion, and after several bad scans the model gives up on the user's behalf.
- The user committed 5 items via the native review card at 23:17:09; `/inventory/commit` writes nothing to `nexus_messages`, so the agent never saw it. When the user then triggered the chat-side "Add the 6 items identified from the last video" (the `[BUTTONS]` add-all path that census offers in parallel with the native card), the agent re-added all 6 at 23:19:11 → 11 rows for 6 physical items. `find_duplicates` flagged 6 pairs, but resolution requires user action and never happened — the duplicates are still in the inventory.

### 0.4 Confirmed telemetry findings

Everything Section 5 predicted, now observed in real rows: `had_error` false on all 23 turns (including the failed wine photo); `items_added_this_turn` = 0 on every turn despite 33 items being added; `detected_item_count`, `avg_confidence`, and `vision_provider` empty on every row even though the tool results carried `_detectedItemCount` and `_visionProvider`; "Gemini did not return structured JSON — fallback used" warnings on the majority of delegations (the structured-response contract fails more often than it works); and the onboarding turn hit `delegation_budget_exhausted (4/4)` — the "processing limit" the user saw — leaving the Bathroom uncreated (improved but not eliminated by #36, which visibly deployed mid-session: budgets change from 4 to 5/6 between 20:26 and 20:59). Only $0.32 of AI spend for the whole day — cost is not the constraint; reliability is.

### 0.5 Immediate actions (this week, in order)

1. **Pull Cloud Run logs now** (default retention 30 days) for 2026-07-01 20:55–23:20 UTC, filters: `"[census] frame extraction failed"`, `"[census] no frames extracted"`, `"[census] Video downloaded:"`, `"[census] analyzePhotoForInventory"`. Comparing the "Video downloaded: X.XMB" values across the four runs of the same dining video proves (or rules out) truncated downloads vs OOM.
2. **Fix `downloadBuffer`**: status check, timeout, retry, Content-Length verification, authenticated GCS SDK reads.
3. **Kill the silent inline fallback**: on frame-extraction failure, retry extraction once, then fail the scan loudly ("Scan failed — tap to retry") instead of returning a 2-item result as success. A wrong-but-confident answer costs more trust than an honest error.
4. **Make rescans deterministic**: an explicit user retry (or a Rescan button) must always invoke `analyze_video` — not depend on LLM mood.
5. **Unify the add paths**: record `/inventory/commit` results into `nexus_messages` so the agent knows; drop the chat `[BUTTONS]` add-all when a native review card was emitted for the same scan.
6. **Raise Cloud Run memory/timeout** (e.g. `--memory 2Gi --timeout 600`, low concurrency) to protect ffmpeg and tmpfs.
7. **Wire the telemetry that already exists**: populate `detected_item_count`, `vision_provider`, `items_added_this_turn` (incl. `add_items` + commit), and `had_error` from the delegated census results.

Even on the healthy frames path, recall for a genuinely cluttered dining room peaked at 9–12 items with the room's headline pieces (table, chairs, wine) inconsistently captured — capture guidance and/or segmented multi-pass analysis is the medium-term detection lever, but transport/fallback reliability above is what actually burned this beta.

---

## 1. TL;DR (original pre-data analysis)

- **The single richest forensic source that already exists is `nexus_messages`** — it persists the full turn-by-turn transcript including every `analyze_photo`/`analyze_video` tool result (detected items, `parseError`) and every `add_items` result (including its `failures[]` array). Start there (queries below).
- **However, several of the most likely failure modes leave no durable trace at all.** `beta_interaction_logs.had_error` is hardcoded to `false` at both call sites, hard failures skip telemetry entirely, the vision calls are uninstrumented, and the iOS client has zero crash/error reporting. So a full diagnosis of the beta session may not be possible from stored data — the logging improvements in Section 5 are needed before the next beta round.
- **The top code-level suspects** (Section 3) are: the iOS 120s inter-byte timeout vs. a scan pipeline that goes silent for the whole vision-processing window; `downloadBuffer` ignoring HTTP status (a 403/404 XML error page gets analyzed as if it were the video); a `sendMedia` bug that discards the uploaded video from the composer when the scan turn fails; and silent truncation caps (20 items/photo, 60 lines/video, 8192 output tokens).

---

## 2. Runbook: what to pull from prod for the beta user

Everything below exists today. Replace `:userId` with the beta user's `users.id` (find via email in `users`).

### 2.1 Reconstruct the session transcript (primary source)

```sql
-- Sessions for the user
SELECT id, title, session_type, items_added, rooms_added, created_at, updated_at
FROM nexus_sessions WHERE user_id = :userId ORDER BY created_at;

-- Full transcript for the dining-room session, incl. tool calls/results
SELECT created_at, role, tool_name,
       left(content, 200) AS content_preview,
       tool_args, tool_response, attachments
FROM nexus_messages
WHERE session_id = :sessionId
ORDER BY created_at, id;
```

What to look for in `tool_response`:
- `analyze_video` / `analyze_photo` rows: `itemCount`, `items[]`, and especially **`parseError`** — a set `parseError` with `items: []` means the model's JSON was truncated/malformed and *everything detected was silently dropped* while still reporting `success: true`.
- `add_items` rows: the **`failures[]`** array — items that failed DB insert. The most common cause is `No location found` (user scanned before a primary location existed; every item fails).
- `delegate_to_census` tool_args: check whether **`include_attachments: true`** was set. If the orchestrator omitted it, census received the URL as *text* with no actual file — it analyzes nothing.
- User rows: `attachments` JSONB confirms what media URL was actually submitted, and whether it points at `users/<id>/chat/nexus/…` (direct-GCS path from PR #35) vs. the multipart path.

### 2.2 Timing and turn telemetry

```sql
SELECT created_at, total_latency_ms, ttfe_ms, gemini_latency_ms, vision_latency_ms,
       had_attachments, attachment_count, attachment_types, tool_calls,
       items_added_this_turn, detected_item_count, avg_confidence,
       vision_provider, gemini_model, gemini_rounds, had_error, error_message
FROM beta_interaction_logs
WHERE user_id = :userId ORDER BY created_at;
```

Interpretation caveats (these are bugs, see Gaps A–C in Section 5):
- `had_error` is **always false** — do not treat it as evidence nothing failed.
- `items_added_this_turn` counts only the legacy single `add_item` tool; the batched `add_items` path (which the prompt prefers) records **0**. A row with `detected_item_count: 24, items_added_this_turn: 0` does not mean items were lost.
- **A missing row means a hard failure**: `logInteraction` runs only on the success paths, so a turn that threw mid-loop writes nothing. Gaps in the timeline are themselves evidence.
- `total_latency_ms > ~110,000` on a video turn is a smoking gun for the iOS 120s timeout (Section 3.1): the server finished, but the client had already given up.

### 2.3 What actually landed

```sql
-- Items created during the beta window, with confidence
SELECT i.id, i.name, i.confidence_score, i.confidence_source, i.picture_url, i.created_at,
       c.name AS room
FROM items i LEFT JOIN collections c ON c.id = i.collection_id
WHERE i.user_id = :userId AND i.created_at > :betaStart
ORDER BY i.created_at;

-- Videos the pipeline recorded, and how many items each yielded
SELECT room_name, video_url, item_count, notes, created_at
FROM room_videos WHERE user_id = :userId ORDER BY created_at;

-- Media registry (NOTE: misses direct-GCS videos, frames, crops — Gap F)
SELECT asset_uuid, image_url, file_size, mime_type, source, status, uploaded_at
FROM image_uploads WHERE user_id = :userId ORDER BY uploaded_at;

-- Daily AI spend (rollup only; per-call attribution doesn't exist — Gap I)
SELECT usage_date, calls, input_tokens, output_tokens, cost_usd
FROM user_costs WHERE user_id = :userId ORDER BY usage_date;
```

Cross-check: `room_videos.item_count` vs. detected counts in `nexus_messages` vs. rows actually in `items`. Divergence localizes the loss to detection, review, or commit.

### 2.4 GCS and Cloud Logging

- List `gs://<bucket>/users/<userId>/chat/nexus/` and `users/<userId>/nexus/` — confirm the video object exists and its `size`/`contentType`. A 0-byte or missing object with a `room_videos` row means the direct-PUT upload failed after URL minting.
- Cloud Run logs: filter on `[census]`, `[media]`, `[videoService]`, `[metrics]` around the session timestamps. This is the **only** place frame-extraction failures, per-frame upload failures, download failures, and vision-call failures are recorded (Gap E). Note many lines lack user/session IDs, so bracket by time using `nexus_messages.created_at`.

---

## 3. Most likely causes of the beta failures (ranked)

The beta symptoms across PRs #32–#38 (agent "thinking then nothing", 413s, lost videos, "found N saved fewer", connection errors) map onto these code paths. Ranked by (probability × impact) for a dining-room scan today, post-#38.

### 3.1 iOS 120s inter-byte timeout vs. a silent scan pipeline — most probable "it just failed"

`NexusService.swift:23-25` sets `timeoutIntervalForRequest = 120`, which is the max gap **between bytes received**. After the SSE stream emits the `analyze_video` tool-call event, the server goes completely silent for the entire vision window: download video from GCS → ffmpeg extract 28 frames → audio extraction → 28 frame uploads to GCS → one large Gemini multi-image call. For a multi-minute dining-room walkthrough this can exceed 120s, at which point URLSession aborts with `.timedOut`, the app shows "Connection interrupted" (softened in #38), and — critically — the **staged review card is discarded** (`NexusViewModel.swift:124-133`), so items detected server-side are never shown. `waitsForConnectivity = true` makes flaky-network cases *hang* rather than fail fast, which reads as "stuck thinking."

**Fix:** emit SSE heartbeat/progress events every few seconds during vision processing (e.g. `frame 12/28`, `analyzing…`). Cheap, kills the whole class. Secondarily: raise `timeoutIntervalForRequest` for the chat session.

### 3.2 `sendMedia` returns success even when the scan turn failed → uploaded video discarded

`NexusViewModel.swift:148-174`: the doc comment promises "false on any failure so the caller can keep the attachment for retry," but `send()` catches its own errors internally (`:131-135`) and never rethrows, so after upload `sendMedia` **unconditionally returns `true`**. `NexusChatView.sendDraft` then clears `pendingMedia`. Net effect: when 3.1 (or any turn error) fires, the user's just-recorded walkthrough is gone from the composer and they must re-film. This is exactly the "media persistence" regression PR #37 meant to fix — the fix covered the *upload* leg but not the *send/scan* leg.

**Fix:** have `send()` rethrow (or return success), and only clear the composer when the turn truly completed.

### 3.3 `downloadBuffer` ignores HTTP status → error pages analyzed as media

`mediaInventoryWorkflowService.js:26-36` accumulates the response body regardless of status code, over an **unauthenticated** `https.get`. If the GCS object isn't publicly readable, the signed URL flow misfired, or the object path is wrong, GCS returns a 403/404 **XML error page — which is then base64'd and sent to Gemini as the "video."** Result: 0 items, `success: true`, user told "I didn't find anything." There is also no timeout on this fetch, so a hang here feeds 3.1. Note the `/upload-url` endpoint (`nexus.js:294-317`) returns a plain public URL and PR #35's direct-GCS path was never exercised outside prod — this whole chain silently depends on bucket ACLs being right.

**Fix:** check `res.statusCode`, use the authenticated GCS SDK for `storage.googleapis.com` URLs (as `imageService.fetchImageAsBase64` already does), add a timeout, and fail loudly.

### 3.4 Silent truncation caps drop items from dense rooms

Three independent caps, all silent:
- Photo multi-item analysis truncates to **20 items** (`imageService.js:1104-1107`, logged, never surfaced).
- Video prompts cap output at **25 lines** (inline) / **60 lines** (frames) (`videoService.js:24,54`) — the model simply omits the rest.
- `maxOutputTokens: 8192` on frame analysis and on census `add_items` tool calls (`videoService.js:230`, `censusAgent.js:632`): truncated JSON → `parseError` → **all** items dropped while `success: true` (`mediaInventoryWorkflowService.js:261-266`); `parseError` is stored in the tool result but never shown to anyone. The frame count has been raised 14→20→28 as a recall band-aid while these output-side caps still bound what can come back.

**Fix:** surface `parseError` as a real failure; chunk `add_items`; page multi-item analysis instead of truncating.

### 3.5 Commit-path losses reported as success

`POST /inventory/commit` (`nexus.js:218-267`): per-item `addItem` failures are collected and dropped; the response carries only `addedCount`, and iOS shows "✅ Added N items" with no indication some were lost. If the user has **no primary location** (scanned before onboarding finished), *every* item throws `No location found` (`inventoryMutationService.js:36-38`) and the whole commit 500s — a plausible first-session beta experience. `resolve-duplicates` likewise swallows all delete failures.

**Fix:** return and display per-item failures; auto-create a default location during onboarding before the first scan is possible.

### 3.6 Vision calls have no timeout, retry, or failover

The heaviest calls in the system — `videoService.js:162,243` and `imageService.js` Gemini calls — bypass `instrumentModel`/`resilientModel` entirely: no 30s timeout, no retry on 429/503, no token metering. A transient Gemini overload just fails the scan; recovery depends on the census LLM *choosing* to retry (a prompt suggestion, not code). Photos at least have provider failover; **video has none**.

### 3.7 Infra headroom

`cloudbuild.yaml` deploys with Cloud Run defaults: **512MB / 1 CPU / 300s / concurrency 80**. A video buffer + ffmpeg + 28 in-memory frames + base64 payloads under any concurrency is an OOM/restart risk mid-scan, and 300s caps the worst-case turn. Set `--memory 2Gi --cpu 2 --timeout 600 --concurrency` low (scan requests are heavy), or move scans out of the request path (Section 5.3).

### 3.8 Orchestration fragility (lower probability, still real)

- `delegate_to_census` forwards attachments only when the orchestrator LLM remembers `include_attachments: true` (`agentDelegationService.js:31`) — omission means census gets a URL as prose and no file.
- Turn budget exhaustion (#36 raised rounds 4→5, delegations 4→6) still terminates via a fallback that can eat the scan's result.
- The "thinking then nothing" fix (#32) raised `maxOutputTokens` but doesn't bound thinking-token growth; the empty-reply guard masks rather than prevents.

---

## 4. Verdict: can we diagnose the beta session from stored data?

**Partially.** If the failures were of types 3.3–3.5 (bad media analyzed, truncation, commit failures), `nexus_messages.tool_response` + `room_videos` + `items` will show them — run Section 2. If they were of types 3.1–3.2 or client-side (timeouts, discarded review cards, upload aborts, app backgrounding), **prod data will show at most a suspicious silence**: a `beta_interaction_logs` row with huge latency and nothing after it, or no row at all. The iOS client records nothing, `had_error` is never true, and hard server failures skip telemetry. Expect to correlate timestamps and infer.

---

## 5. Logging & data-store improvements (prioritized)

### 5.1 Fix the broken instrumentation we already have (small, do first)

1. **Wire `had_error` for real** — both `logInteraction` call sites hardcode `error: { hadError: false }` (`censusAgent.js:732,888`). Thread actual tool failures and `parseError` into it.
2. **Log the failure turn** — call `logInteraction` (or an error variant) in the `catch` paths of `processMessage` and the census route, so a hard failure writes a row instead of nothing.
3. **Count `add_items`** — `items_added_this_turn` / `nexus_sessions.items_added` only count legacy `add_item`; include the batched path and the `/inventory/commit` path so "items saved" is trustworthy.
4. **Surface `parseError`** — treat `items: [] + parseError` as `success: false` end-to-end; tell the user the scan failed rather than "found nothing."

### 5.2 New capture for the scan pipeline (medium)

5. **A `scan_events` table** (analog of the existing `item_estimate_events`, which the scan path doesn't use): one row per `analyze_photo`/`analyze_video` with `user_id, session_id, media_url, media_bytes, frame_count, provider, model, latency_ms, token_usage, item_count, parse_error, error_stage, raw_response_text`. This single table would have answered most of this investigation.
6. **Per-stage status on the video path** — download (with HTTP status!), frame extraction, audio, frame uploads, model call, persist — recorded on that row, not just `console.warn`.
7. **Register all scan media in `image_uploads`** — direct-GCS videos (`/upload-url` writes no DB row), extracted frames, and crops currently bypass `mediaAssetService`, which also breaks `deleteUserImages.js` retention/GDPR cleanup.
8. **Structured server logs** — adopt pino (or minimal JSON `console.log`), and put `user_id`, `session_id`, `request_id` on every line in the scan path so Cloud Logging can be filtered to one user. Add a log-based alert on scan-stage errors.
9. **Instrument the vision calls** — route them through `instrumentModel` for timeout/retry/backoff and token metering; record usage into `user_costs` (currently the most expensive calls are invisible to cost tracking) and per-call into `scan_events`.

### 5.3 Client-side visibility + architecture (larger)

10. **iOS crash/error reporting** (Sentry or Crashlytics) plus a lightweight client event log posted to the API (`upload_started/succeeded/failed`, `sse_timeout`, `review_card_shown/committed`, with session id). Today a client-side failure is invisible; PrivacyInfo.xcprivacy already exists.
11. **SSE heartbeats during vision processing** — also the fix for 3.1.
12. **Move scans out of the request path**: persist an upload record immediately, process async (Cloud Tasks / job), notify the client when the review card is ready. This removes the whole timeout/connection-drop class (the scan currently lives or dies inside one SSE HTTP request), makes retries safe, and gives every scan a durable, resumable record. This is the structural fix; everything above still pays off once it lands.

---

## Appendix: prior fixes and what they did/didn't close

| PR | Fix | Status |
|----|-----|--------|
| #32 | Agent "thinking then nothing" — `maxOutputTokens` 2048→8192 + empty-reply guard | Band-aid: masks empties, doesn't bound thinking growth |
| #33 | Video 413s — 720p export preset + 30MB pre-flight | Superseded by #35 for video; photos still capped |
| #35 | Direct-to-GCS signed upload | **Never verified end-to-end outside prod**; writes no DB row |
| #36 | Processing limit — rounds 4→5, delegations 4→6, single-call room creation | Reduces trigger; budget exhaustion still reachable |
| #37 | Media persistence on failed send; frames 20→28 | Covered the upload leg only — send/scan-leg loss remains (3.2) |
| #38 | Media checklist, softer network errors | Cosmetic on the error side; no retry |
