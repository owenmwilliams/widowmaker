# Agent-First "Inventory in 10 Minutes" — Flow & Build Plan

## North Star

**Download → a link you text to 3 moving companies for quotes, in under 10 minutes, in 3 steps.**

Success metric: a brand-new user reaches a *shareable, mover-ready inventory* (room-by-room item list with quantities, weights, cubic feet, fragile/oversized flags, and access notes) in <10 min of wall-clock time and ≤3 decisions. "Reasonable, not perfect" — good enough for a binding-ish quote, refined on site.

The three steps (user's framing, kept):
1. **Current home details** — where you're moving *from* + how big it is.
2. **Take a video of each room** — the core capture.
3. **Where you're moving *to*** — destination + share.

---

## What we already have (the asset base)

The backend is far more complete than the UX implies. Grounded findings:

- **The agent-first onboarding flow is already scripted** in the orchestrator system prompt (`movetrack-api/agents/nexusOrchestratorAgent.js:104–125`): ask name → `set_location` → home type/beds → `delegate_to_census` to create rooms → `mark_onboarding_complete` → offer camera / type / auto-fill via tappable `[BUTTONS]`. It is essentially the 3-step flow already — it's just **never reached** because the frontend routes first-time users into a 7-step form wizard instead of the chat.
- **Orchestration is production-ready**: Nexus orchestrator + Census (inventory) + Vector (logistics) agents, session persistence (`nexus_sessions`/`nexus_messages`), SSE streaming, attachment handling (photo/video → GCS → agent), parallel delegation with cost budget, guidance mode.
  - Orchestrator tools: `set_user_profile`, `set_location`, `update_location`, `get_inventory_status`, `mark_onboarding_complete`, `delegate_to_census`, `delegate_to_vector`.
  - Census tools: `add_item`, `add_room`, `analyze_photo`, `analyze_video`, `find_duplicates`, `estimate_missing_items`, `inventory_readiness` (0–100 score + next steps), etc.
  - Vector tools: `get_move_summary`, `recommend_truck_size`, `estimate_move_cost`, `flag_special_items`, `get_room_breakdown`.
- **Origin & destination are solved primitives**: both are `locations` rows; `set_location` takes a bare address and **geocodes + auto-corrects** it (Google). A move is a `saved_moves` row linking `origin_location_id` + `destination_location_id`; `createSavedMove` exists. Access details (stairs/parking) and routing are optional and deferrable.
- **Video → items exists** (`services/infra/vision/videoService.js`): Gemini reads a whole clip → items with `room`, `quantity`, `notes` (fragile/heavy/disassembly), `timestamp`, `bbox`; `frameExtractor.js` pulls the sharpest frame per item for thumbnails. **Caveats:** pro/admin-gated, returns **no dimensions/weight/material**, and dedup relies on the LLM ("don't list twice"). A richer frame-sampling + IoU-dedup + SAM + attribute pipeline exists but is **sandbox-only** (`VisionLab`).
- **Photo → items is mature**: single-item returns full dims/weight/material/fragile/confidence; multi-item returns name/quantity/bbox; multi-image dedup (Gemini).
- **Estimate engine exists** (`itemEstimationService.js`): Gemini fills per-item weight/dimensions/volume with a confidence score; `estimate_missing_items` tool applies it in bulk. Totals (weight, cubic feet, counts, "missing data" counts) computed in `inventorySummaryQueryService.js`.
- **iOS app backbone works**: magic-link auth + Keychain, inventory CRUD, MVVM, models, deep-link login. **Gaps:** camera/video capture is a stub, no multipart upload (backend endpoint exists, iOS doesn't call it), no share/export.

### The one big hole: mover-shareable output
This is the weakest link and the thing that makes an inventory "shareable with moving companies":
- A **client-side** PDF generator exists with a `mover-bidding` template (`movetrack-app/src/services/pdfGenerator.ts`) — but it's browser-only (manual download), with **no backend endpoint, no tokenized share link, and no CSV** (CSV is promised in marketing copy, not built). The `permissions` table exists but there's no public/tokenized inventory view.

---

## The 3-step flow, designed

Everything below is conversational (the agent drives) with tappable buttons to minimize typing. Times are for a typical 1–2 BR.

### Step 1 — "Where & what" (~90s)
- Agent: name → "Where are you moving *from*?" → `set_location(address)` (geocoded).
- "How big is it?" → buttons: Studio / 1BR / 2BR / 3BR / House. → `delegate_to_census` auto-creates the room list (Kitchen, Living Room, Bedroom(s), Bath, Garage…). No manual room building.
- Immediately, Vector can produce a *rough* estimate from home size alone — so the user has value before capturing anything.

### Step 2 — "Show me each room" (the core, ~30–60s/room)
- A room checklist appears. For each room the agent launches a **guided camera**: "Walk slowly around your Kitchen — counters, cabinets, floor."
- Upload → `analyze_video` (room known from context, not guessed) → dedup → **estimate engine fills weight/dims** → items land in that room.
- Agent shows a running tally per room: *"Kitchen: 23 items, ~1,400 lbs, ~180 cu ft"* and a total. Bulk-accept; quick "remove wrong / add missed" affordance. No per-item confirmation.
- "Kitchen done ✓ — next: Living Room?" Repeat. User can stop anytime and still have something shareable.

### Step 3 — "Where to & share" (~60s)
- Agent: "Where are you moving *to*?" → `set_location` (destination) → `createSavedMove(origin, destination, date?)`.
- Produce the deliverable: a **tokenized share link + PDF (mover-bidding)** with room-by-room items, totals (weight/cu ft/count), fragile/oversized/disassembly flags, and access notes. Optional Vector summary (truck size, rough cost range).
- "Here's your inventory — text this link to movers for quotes." iOS/web share sheet.

---

## Product principles (friction-killers)

1. **Agent is the UI.** The chat + tappable buttons replace forms. Capture launches inline.
2. **Video over taps.** One slow pan replaces 20 manual entries. This is the core bet.
3. **Never ship a null number.** Movers need weight + cu ft. Any item missing them gets auto-filled by the estimate engine before it's shown/shared. "Reasonable, confirm on site."
4. **Bulk-accept, don't confirm-each.** Show room tallies; let users correct in aggregate.
5. **Progressive value.** Skeleton + rough estimate after Step 1; sharpens per room; shareable at any point.
6. **Defer everything optional.** Access details, exact dates, high-value declarations — prompted only if the user wants tighter quotes.

---

## Engineering plan (phased)

### Phase A — Flip the front door (unlock what exists)
Mostly frontend + the existing agent. Highest ratio of impact to effort.
- Route first-time users (`onboarding_completed=false`) to the Nexus chat instead of the form wizard (`movetrack-app/src/router/index.ts`).
- Make photo/video capture launchable **inline** from the chat (`NexusChat.vue`), feeding attachments to the orchestrator.
- Verify the scripted onboarding prompt drives end-to-end; add a guided room-checklist UI affordance.
- Keep the old wizard reachable as a fallback.

### Phase B — Mover-shareable output (the missing deliverable) ← highest-value gap
- **Report service** (backend): assemble the mover inventory (room-by-room items + per-item qty/dims/weight/fragile + totals + access + optional Vector cost/truck).
- **Tokenized share link**: new `inventory_shares` table (token, user_id, move_id, created_at, expires_at, revoked); a **public** read-only route (added to the auth allowlist) that serves only that snapshot. Revocable/expiring.
- **Server-side PDF + CSV**: move/duplicate the `mover-bidding` PDF to a backend endpoint for email/attach; add CSV. (Reuse the existing template logic.)
- Share sheet wiring on web + iOS.

### Phase C — Video capture quality (make "video of each room" reliable)
- Promote video→items from pro/admin to the **default consumer path** (cost caps already enforced).
- **Fill numbers:** after detection, run `estimate_missing_items`/`itemEstimationService` on the video items so weight/dims/volume are populated (video gives names/counts/room/fragile; estimate fills the rest).
- **Harden dedup + quantity** across the clip (bring the VisionLab IoU/tracking approach into production, or a dedup/consensus pass over Gemini output).
- **Room from context** (capture is launched "for the Kitchen"), not Gemini's guess.
- Budget per flow (a 2-min room clip ≈ $0.10; multiple rooms add up — meter against the existing caps).

### Phase D — Standalone iOS simple app
- 3 screens mirroring the flow; **native AVFoundation video capture** is the headline feature.
- Add **multipart upload** to `APIClient` (backend endpoints already exist) + image/video compression.
- Wire share sheet (tokenized link + PDF) to text/email movers.
- Submittability: `PrivacyInfo.xcprivacy`, signing.
- **Key choice — how iOS drives the flow:**
  - **(a) Embed the agent chat** (fastest to parity; the agent already scripts the flow; native camera hands attachments to the same endpoints). Less native-feeling.
  - **(b) Native 3-screen wizard** calling the same vision/inventory/share APIs directly (more polished, more work, duplicates the flow logic).
  - Recommendation: **(a) first** to ship the wedge fast, then selectively nativize Step 2 (capture) which benefits most from native UX.

---

## Risks & open questions
- **Video accuracy/cost** drives trust and unit economics — needs real-clip testing + per-flow budgeting against caps.
- **Estimate accuracy** for mover trust — set expectations ("good for a quote, confirm on site"); see `docs/plan/implementation-moving-estimates-guardrails.md`.
- **Dedup quality** determines whether tallies are believable; the biggest technical unknown in Phase C.
- **Upload size** on iOS (500MB cap today) — compress/segment per room.
- **Public share link** is an unauthenticated surface — token entropy, expiry, revocation, rate-limiting, no PII beyond the inventory.

## Sequencing & rough effort
- **A** (flip front door): small, days — unlocks the existing agent flow on web.
- **B** (sharing): medium — the deliverable that makes inventories mover-ready; do early.
- **C** (video quality): medium–large — the reliability of the core capture.
- **D** (iOS): medium — the standalone app; depends on A/B/C endpoints.

Recommended order: **A → B → C → D**, with B started in parallel since it's the missing product surface and is backend-independent of A.

## Decisions needed
1. **iOS approach:** embed the agent chat (fast) vs. native 3-screen wizard (polished). Recommend embed-first.
2. **Where to start:** flip the web front door (A), build sharing (B), or harden video (C) first.
3. **Sharing surface:** tokenized public link + PDF + CSV — all three, or link-first?
