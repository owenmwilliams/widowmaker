# Beta scan reliability: investigation, diagnosis, and logging gaps

**Date:** 2026-07-01
**Scope:** Reliability of logging inventory items from photos/videos (the "scan my dining room" flow), based on the most recent beta test.
**Caveat:** This investigation was run from a sandbox with no production credentials (no Cloud SQL, GCS, or Cloud Logging access). Section 2 is a runbook of exactly what to pull from prod; Sections 3–4 are a code-level diagnosis of the failure modes that best explain the beta symptoms; Section 5 is the logging-gap assessment and recommendations.

---

## 1. TL;DR

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
