//
//  NexusViewModel.swift
//  Nexus Moves
//
//  Drives the native Nexus chat screen: loads the active session, streams
//  messages, uploads photos/videos, and surfaces a share link when the agent
//  creates one. This is the entire app's brain — there are no dashboards.
//

import Foundation
import SwiftUI
import Combine
import CryptoKit

/// Outcome of preparing to share: either we need to warn the user first, we have
/// a ready link, or it failed (error surfaced on the view model).
enum SharePrep {
    case warn(String)
    case ready(URL)
    case failed
}

@MainActor
final class NexusViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var quickStartChips: [QuickStartChip] = []
    @Published var isLoading = false        // a message round-trip is in flight
    @Published var isUploading = false      // a photo/video is uploading
    @Published var uploadProgress: Double = 0  // 0…1 for the direct-GCS PUT; 0 = indeterminate
    @Published var phaseText = ""           // "Thinking…", "Scanning your photo…"
    @Published var detailText = ""          // secondary specialist detail
    @Published var errorMessage: String?
    @Published var shareURL: URL?           // most recent share link (agent- or user-created)
    @Published var isPreparingShare = false // a share link is being fetched/created
    @Published var sessionExpired = false   // a 401 occurred — the view bounces to login
    @Published var readiness: ShareReadinessDTO?  // drives the share-readiness banner/sheet
    @Published var pendingReview: DetectedItemsReview?   // drives the detected-items review sheet
    @Published var pendingDuplicates: DuplicateReview?   // drives the duplicate-review sheet

    private let service = NexusService.shared
    private var sessionId: String?
    private var didLoad = false

    // Staged during a streaming turn; promoted to the @Published sheets after the
    // turn's reply lands so the card appears once, below the agent's message.
    private var stagedReview: DetectedItemsReview?
    private var stagedDuplicates: [DuplicatePair]?

    // The most recent scanned media, remembered so "Rescan" can deterministically
    // re-run analysis on the same file (issue #43) without the user re-recording.
    private struct LastScan { let url: String; let mimeType: String; var room: String? }
    private var lastScan: LastScan?

    // Review cards awaiting the user, one presented at a time. A card's scan
    // job is consumed only when the user closes the card (commit or dismiss),
    // so killing the app with a card on screen re-surfaces it on next launch.
    private var reviewQueue: [DetectedItemsReview] = []
    private var presentedReviewJobId: String?
    private var presentedReviewPillId: UUID?
    private var presentedReviewCount = 0
    private var presentedReviewHandled = false

    var isBusy: Bool { isLoading || isUploading }

    // MARK: - Load

    func loadIfNeeded() async {
        guard !didLoad else { return }
        didLoad = true
        await reload()
    }

    private func reload() async {
        do {
            let resp = try await service.loadActiveSession()
            sessionId = resp.session?.id
            messages = resp.messages.map { ChatMessage(from: $0) }
            quickStartChips = resp.quickStartChips
        } catch NexusError.unauthorized {
            sessionExpired = true
        } catch {
            errorMessage = (error as? NexusError)?.userMessage ?? error.localizedDescription
        }
        await materializeUnconsumedScans()
        await refreshReadiness()
    }

    /// Refresh the share-readiness snapshot (best-effort; never disrupts the UI).
    func refreshReadiness() async {
        if let r = try? await service.shareReadiness() { readiness = r }
    }

    // MARK: - Send

    @discardableResult
    func send(_ text: String) async -> Bool {
        await send(text: text, attachments: [])
    }

    /// Returns true only when the turn genuinely completed (a `done` event
    /// arrived). Callers that clear state on send — like the composer clearing
    /// its pending media — must key off this, not off the call returning.
    @discardableResult
    func send(text rawText: String, attachments: [OutgoingAttachment]) async -> Bool {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || !attachments.isEmpty else { return false }
        guard !isLoading else { return false }

        let optimistic = ChatMessage(
            role: .user,
            text: text,
            attachments: attachments.map { NexusAttachment(url: $0.url, mimeType: $0.mimeType) }
        )
        messages.append(optimistic)
        quickStartChips = []
        errorMessage = nil
        isLoading = true
        phaseText = "Thinking…"
        detailText = ""
        stagedReview = nil
        stagedDuplicates = nil

        var completed = false
        do {
            let done = try await service.sendMessage(text: text, attachments: attachments) { [weak self] event in
                self?.handle(event)
            }
            completed = true
            sessionId = done.sessionId ?? sessionId
            let rawReply = (done.reply ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            // When a review/duplicate card is about to appear, drop the agent's
            // [BUTTONS] (e.g. "Add them all") from its bubble so the card is the
            // single commit path — this prevents a double-add.
            let hasCard = stagedReview != nil || stagedDuplicates != nil
            let reply: String
            if hasCard {
                let prose = AgentMessageParser.parse(rawReply).prose
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                reply = prose.isEmpty ? rawReply : prose
            } else {
                reply = rawReply
            }
            if !reply.isEmpty {
                messages.append(ChatMessage(role: .model, text: reply))
            }
            captureShare(from: done)
            // Promote staged review/duplicates now that the reply is on screen.
            if let review = stagedReview { presentReview(review) }
            if let dups = stagedDuplicates { pendingDuplicates = DuplicateReview(pairs: dups) }
            stagedReview = nil
            stagedDuplicates = nil
        } catch NexusError.unauthorized {
            messages.removeAll { $0.id == optimistic.id }
            sessionExpired = true
        } catch {
            // Drop the optimistic bubble and surface the error — but keep any
            // review card that already arrived. The scan can finish server-side
            // and stream `detected_items` before the connection drops; the
            // detected items shouldn't die with the connection.
            messages.removeAll { $0.id == optimistic.id }
            errorMessage = friendlyError(error)
            if let review = stagedReview { presentReview(review) }
            if let dups = stagedDuplicates { pendingDuplicates = DuplicateReview(pairs: dups) }
            stagedReview = nil
            stagedDuplicates = nil
            // `NexusError.server("The assistant stopped responding...")` is the SSE
            // stream ending without a `done` event (streamSSE, NexusService.swift) —
            // a soft timeout the raw URLError check alone would miss.
            if let urlErr = error as? URLError, urlErr.code == .timedOut {
                ClientEventLogger.shared.log(.sseTimeout, sessionId: sessionId)
            } else if case .server(let message) = error as? NexusError, message.contains("stopped responding") {
                ClientEventLogger.shared.log(.sseTimeout, sessionId: sessionId, metadata: ["reason": "no_done_event"])
            } else {
                ClientEventLogger.shared.log(.turnFailed, sessionId: sessionId,
                                              metadata: ["error": String(describing: error).prefix(200).description])
            }
        }

        isLoading = false
        phaseText = ""
        detailText = ""
        await refreshReadiness()
        return completed
    }

    // MARK: - Media

    /// Returns true if the media uploaded and the scan finished; false on any
    /// failure so the caller can keep the attachment in the composer for a retry.
    @discardableResult
    func sendMedia(data: Data, mimeType: String, filename: String, caption: String = "", roomHint: String? = nil) async -> Bool {
        guard !isBusy else { return false }
        errorMessage = nil

        // Content-derived idempotency key: identical bytes → identical key, so
        // a retry after a timeout, crash, or relaunch (even via a fresh upload)
        // reuses the in-flight/unseen job instead of scanning twice. A rescan
        // AFTER the previous result was acknowledged gets a fresh job — the
        // server scopes uniqueness to unconsumed jobs.
        let idempotencyKey = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()

        let isVideo = mimeType.hasPrefix("video")

        // Images go through the multipart endpoint (small, well under the cap).
        // Photos over ~30MB would 413, so guard those; videos upload directly to
        // storage via a signed URL and aren't bound by the request cap.
        if !isVideo && data.count > 30 * 1024 * 1024 {
            errorMessage = "That photo is too large to upload (\(data.count / 1024 / 1024) MB)."
            return false
        }

        // The bubble appears the moment the user hits send — the upload can take
        // a while for a big walkthrough video, and dead air reads as a broken app.
        let optimistic = ChatMessage(
            role: .user,
            text: caption.isEmpty
                ? (isVideo ? "\u{1F3A5} Video walkthrough" : "\u{1F4F7} Photo")
                : caption
        )
        messages.append(optimistic)

        isUploading = true
        uploadProgress = 0
        phaseText = isVideo ? "Uploading video…" : "Uploading photo…"
        let mediaMetadata = ["mediaKind": isVideo ? "video" : "photo", "bytes": String(data.count)]
        ClientEventLogger.shared.log(.uploadStarted, sessionId: sessionId, metadata: mediaMetadata)
        let uploaded: UploadResponse
        do {
            uploaded = isVideo
                ? try await service.uploadMediaDirect(data: data, mimeType: mimeType, filename: filename) { [weak self] p in
                      Task { @MainActor in self?.uploadProgress = p }
                  }
                : try await service.uploadMedia(data: data, mimeType: mimeType, filename: filename)
            isUploading = false
            phaseText = ""
            ClientEventLogger.shared.log(.uploadSucceeded, sessionId: sessionId, metadata: mediaMetadata)
            // Remember this media so the user can deterministically rescan it
            // (issue #43). The room is backfilled when the review card
            // materializes from the finished scan job.
            lastScan = LastScan(url: uploaded.url, mimeType: uploaded.mimeType, room: nil)
        } catch NexusError.unauthorized {
            isUploading = false
            phaseText = ""
            messages.removeAll { $0.id == optimistic.id }
            sessionExpired = true
            ClientEventLogger.shared.log(.uploadFailed, sessionId: sessionId, metadata: mediaMetadata)
            return false
        } catch {
            isUploading = false
            phaseText = ""
            messages.removeAll { $0.id == optimistic.id }
            errorMessage = friendlyError(error)
            ClientEventLogger.shared.log(.uploadFailed, sessionId: sessionId,
                                          metadata: mediaMetadata.merging(["error": String(describing: error).prefix(200).description]) { a, _ in a })
            return false
        }
        isUploading = false
        phaseText = ""

        // The scan itself is a durable server-side job, not a chat turn: the
        // job — not this connection — owns the scan, so a drop, backgrounding,
        // or even an app relaunch can't lose it (reload() re-materializes any
        // finished-but-unseen job).
        return await runScanJob(
            mediaUrl: uploaded.url,
            mimeType: uploaded.mimeType,
            caption: caption,
            roomHint: roomHint,
            idempotencyKey: idempotencyKey,
            isVideo: isVideo,
            optimistic: optimistic
        )
    }

    /// Register the uploaded media as a scan job, poll it to a terminal state,
    /// and materialize the review card from the job record.
    private func runScanJob(mediaUrl: String, mimeType: String, caption: String, roomHint: String?, idempotencyKey: String, isVideo: Bool, optimistic: ChatMessage) async -> Bool {
        quickStartChips = []
        isLoading = true
        phaseText = isVideo ? "Scanning your video…" : "Scanning your photo…"
        defer {
            isLoading = false
            phaseText = ""
            detailText = ""
        }

        do {
            let created = try await service.createScanJob(
                mediaUrl: mediaUrl,
                mimeType: mimeType,
                caption: caption.isEmpty ? nil : caption,
                idempotencyKey: idempotencyKey,
                sessionId: sessionId,
                roomHint: roomHint
            )
            let job = try await pollScanJob(id: created.id)
            if job.status == "completed" {
                // NOT consumed here: the job is acknowledged when the user
                // closes the review card (commit or dismiss), so killing the
                // app with the card on screen re-surfaces it on relaunch.
                materializeReview(from: job)
                await refreshReadiness()
                return true
            }
            messages.removeAll { $0.id == optimistic.id }
            errorMessage = job.error ?? "The scan failed. Please try again."
            // A failure has no card to acknowledge; surfacing the error is the
            // acknowledgment (the composer keeps the media for the retry).
            try? await service.consumeScanJob(id: job.id)
            return false
        } catch NexusError.unauthorized {
            messages.removeAll { $0.id == optimistic.id }
            sessionExpired = true
            return false
        } catch {
            messages.removeAll { $0.id == optimistic.id }
            errorMessage = friendlyError(error)
            return false
        }
    }

    /// Poll a scan job until it reaches a terminal state. Transient poll
    /// failures are tolerated — the job keeps running server-side, so a network
    /// blip mid-poll must not abort the scan the way it aborted the old SSE
    /// request. On timeout the job is left unconsumed so reload() surfaces it.
    private func pollScanJob(id: String) async throws -> ScanJobDTO {
        let deadline = Date().addingTimeInterval(15 * 60)
        var consecutiveErrors = 0
        while Date() < deadline {
            do {
                let job = try await service.scanJob(id: id)
                consecutiveErrors = 0
                if job.isTerminal { return job }
            } catch NexusError.unauthorized {
                throw NexusError.unauthorized
            } catch {
                consecutiveErrors += 1
                if consecutiveErrors >= 10 { throw error }
            }
            try await Task.sleep(nanoseconds: 3_000_000_000)
        }
        throw NexusError.network(
            "The scan is taking longer than expected. It keeps running in the background — pull to refresh in a bit to see the result."
        )
    }

    /// Flip a scan pill to a new state in place.
    private func updatePill(_ id: UUID?, to state: ChatMessage.ScanReviewState) {
        guard let id, let idx = messages.firstIndex(where: { $0.id == id }) else { return }
        messages[idx].kind = .scanReview(state)
    }

    /// Turn a completed scan job into a review card plus a summary bubble.
    /// Zero-item scans have no card to acknowledge, so they surface a message
    /// and consume immediately.
    private func materializeReview(from job: ScanJobDTO) {
        let items = job.result?.items ?? []
        let kindWord = (job.result?.mediaKind ?? job.mediaKind ?? "photo") == "video" ? "video" : "photo"
        guard !items.isEmpty else {
            messages.append(ChatMessage(
                role: .model,
                text: "I couldn't detect any items in that \(kindWord). Try again with more light, or pan a little slower."
            ))
            let jobId = job.id
            Task { try? await service.consumeScanJob(id: jobId) }
            return
        }
        // The review card IS the response — the chat keeps a compact pill,
        // not a prose bubble that duplicates the modal.
        let pill = ChatMessage(role: .model, text: "\(items.count) items found",
                               kind: .scanReview(.pending(count: items.count)))
        messages.append(pill)
        // Backfill the room onto the remembered media so a later Rescan
        // (issue #43) targets the same room this scan resolved to.
        if let room = job.result?.room ?? job.roomHint, lastScan != nil { lastScan?.room = room }
        presentReview(DetectedItemsReview(
            mediaKind: job.result?.mediaKind ?? job.mediaKind ?? "photo",
            room: job.result?.room ?? job.roomHint,
            items: items,
            jobId: job.id,
            pillId: pill.id
        ))
    }

    /// Surface scans that finished while the app was away (connection drop,
    /// backgrounding, relaunch). Every completed scan becomes a review card,
    /// queued oldest-first and presented one at a time; completed jobs are NOT
    /// consumed here — only when the user closes their card. Failures surface
    /// as messages and are consumed (the remedy is rescanning).
    private func materializeUnconsumedScans() async {
        guard let jobs = try? await service.unconsumedScanJobs(), !jobs.isEmpty else { return }
        for job in jobs where job.status == "completed" {
            materializeReview(from: job)
        }
        let failures = jobs.filter { $0.status == "failed" }
        for job in failures {
            messages.append(ChatMessage(
                role: .model,
                text: "⚠️ A scan didn't finish: \(job.error ?? "unknown error"). Please try scanning again."
            ))
            try? await service.consumeScanJob(id: job.id)
        }
        if let last = failures.last {
            errorMessage = "A scan from earlier didn't finish: \(last.error ?? "unknown error"). Please try again."
        }
    }

    // MARK: - Review-card queue

    /// Queue a review card and present it if nothing is on screen. Cards from
    /// multiple scans (e.g. three rooms scanned while backgrounded) present
    /// sequentially — none are dropped.
    private func presentReview(_ review: DetectedItemsReview) {
        reviewQueue.append(review)
        presentNextReview()
    }

    private func presentNextReview() {
        guard pendingReview == nil, let next = reviewQueue.first else { return }
        reviewQueue.removeFirst()
        presentedReviewJobId = next.jobId
        presentedReviewPillId = next.pillId
        presentedReviewCount = next.items.count
        presentedReviewHandled = false
        pendingReview = next
    }

    /// Called from the review sheet's onDismiss — commit, skip, and swipe-down
    /// all funnel here. Closing the card is the acknowledgment: consume its
    /// job (idempotent server-side) and present the next queued card.
    func reviewSheetClosed() {
        let jobId = presentedReviewJobId
        presentedReviewJobId = nil
        // Swipe-down / skip without committing: the pill records the outcome.
        if !presentedReviewHandled {
            updatePill(presentedReviewPillId, to: .dismissed(count: presentedReviewCount))
        }
        presentedReviewPillId = nil
        presentedReviewHandled = false
        Task {
            if let jobId {
                try? await service.consumeScanJob(id: jobId)
            }
            presentNextReview()
        }
    }

    // MARK: - Share

    /// Run the reasonableness check and, if it looks fine, prepare a link — all
    /// under a SINGLE loading state so the overlay doesn't flash. Returns `.warn`
    /// (show the warning first), `.ready` (present the share sheet), or `.failed`.
    func evaluateAndPrepareShare() async -> SharePrep {
        guard !isPreparingShare else { return .failed }
        isPreparingShare = true
        errorMessage = nil
        defer { isPreparingShare = false }

        // Reasonableness gate (warn-but-allow). Don't block sharing if the check
        // itself fails — only surface a high-severity verdict.
        do {
            if let warning = try await service.shareReadiness().shareWarning {
                return .warn(warning)
            }
        } catch NexusError.unauthorized {
            sessionExpired = true
            return .failed
        } catch {
            // ignore — proceed to share
        }

        if let url = await createOrFetchShareURL() {
            return .ready(url)
        }
        return .failed
    }

    /// "Share anyway" path — skip the warning, just prepare the link.
    func forceShare() async -> URL? {
        guard !isPreparingShare else { return shareURL }
        isPreparingShare = true
        errorMessage = nil
        defer { isPreparingShare = false }
        return await createOrFetchShareURL()
    }

    /// Reuse an active share link or create one. Sets `shareURL`. No loading
    /// toggle of its own — callers own the `isPreparingShare` state.
    private func createOrFetchShareURL() async -> URL? {
        do {
            let existing = try await service.listShares().first(where: { $0.isActive })
            let share: ShareDTO
            if let existing {
                share = existing
            } else {
                share = try await service.createShare()
            }
            if let urlString = share.url, let url = URL(string: urlString) {
                shareURL = url
                return url
            }
            errorMessage = "Couldn't prepare a share link. Please try again."
            return nil
        } catch NexusError.unauthorized {
            sessionExpired = true
            return nil
        } catch {
            errorMessage = (error as? NexusError)?.userMessage ?? error.localizedDescription
            return nil
        }
    }

    // MARK: - Review commit (native cards)

    /// Commit the items the user kept/edited in the detected-items review sheet.
    /// The client owns this commit (exact, no LLM re-interpretation), so the agent
    /// is told in its prompt not to re-add items the user added themselves.
    func commitReview(_ items: [DetectedItem], room: String?, scanId: String?) async {
        pendingReview = nil
        let kept = items.filter {
            $0.keep && !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        guard !kept.isEmpty else { return }
        let pillId = presentedReviewPillId
        let totalDetected = presentedReviewCount
        isLoading = true
        phaseText = "Adding your items…"
        errorMessage = nil

        var report: String? = nil
        do {
            let payload = kept.map { ReviewedItemPayload(from: $0, fallbackRoom: room) }
            let result = try await service.commitReviewedItems(payload, room: room, scanId: scanId)
            presentedReviewHandled = true
            updatePill(pillId, to: .reviewed(added: result.added, skipped: result.skipped))
            ClientEventLogger.shared.log(.reviewCardCommitted, sessionId: sessionId,
                                          metadata: ["itemCount": String(result.added)])
            // A re-submitted card is already in the inventory — flip the pill,
            // but don't send a second report for the same review.
            if !(result.alreadyCommitted || (result.added == 0 && result.skipped > 0)) {
                let fromScan = room.map { " from the \($0) scan" } ?? " from the scan"
                var t = "Added \(result.added) of the \(totalDetected) items\(fromScan)."
                if result.skipped > 0 { t += " \(result.skipped) were already on the list." }
                if result.failed > 0 { t += " \(result.failed) couldn't be added." }
                report = t
            }
        } catch NexusError.unauthorized {
            sessionExpired = true
        } catch {
            errorMessage = (error as? NexusError)?.userMessage ?? error.localizedDescription
        }
        isLoading = false
        phaseText = ""
        await refreshReadiness()

        // Closing the loop conversationally: the commit report goes out as a
        // REAL user message, and the model's reply — not a canned toast — is
        // what moves the chat forward. (send() owns its own loading state.)
        if let report {
            _ = await send(report)
        }
    }

    /// Deterministically re-run analysis on the most recently scanned media and
    /// re-present the review card. Backed by POST /rescan, which always invokes
    /// the vision tool — so this can't be talked out of the way a chat "please
    /// re-analyze" was in the beta (issue #43). No-op if nothing was scanned yet.
    func rescanLast() async {
        guard let scan = lastScan, !isBusy else { return }
        isLoading = true
        phaseText = "Rescanning…"
        errorMessage = nil
        defer { isLoading = false; phaseText = "" }
        do {
            var review = try await service.rescan(url: scan.url, mimeType: scan.mimeType, room: scan.room)
            if review.items.isEmpty {
                messages.append(ChatMessage(
                    role: .model,
                    text: "I ran the scan again but still couldn't pick out any items. Try a slower, well-lit pan with closets open — or add the items by name."
                ))
            } else {
                let pill = ChatMessage(role: .model, text: "\(review.items.count) items found",
                                       kind: .scanReview(.pending(count: review.items.count)))
                messages.append(pill)
                review.pillId = pill.id
                presentReview(review)
            }
        } catch NexusError.unauthorized {
            sessionExpired = true
        } catch {
            errorMessage = friendlyError(error)
        }
    }

    /// Remove the item ids the user chose in the duplicate-review sheet.
    func resolveDuplicates(removing rawIds: [Int]) async {
        pendingDuplicates = nil
        let ids = rawIds.filter { $0 > 0 }
        guard !ids.isEmpty else { return }
        isLoading = true
        phaseText = "Removing duplicates…"
        errorMessage = nil
        defer { isLoading = false; phaseText = "" }
        do {
            let removed = try await service.resolveDuplicates(removeItemIds: ids)
            messages.append(ChatMessage(
                role: .model,
                text: "🧹 Removed \(removed) duplicate\(removed == 1 ? "" : "s")."
            ))
        } catch NexusError.unauthorized {
            sessionExpired = true
        } catch {
            errorMessage = (error as? NexusError)?.userMessage ?? error.localizedDescription
        }
        await refreshReadiness()
    }

    // MARK: - New conversation

    func startNewConversation() async {
        guard !isBusy else { return }
        if let id = sessionId {
            try? await service.clearSession(id: id)
        }
        sessionId = nil
        messages = []
        quickStartChips = []
        shareURL = nil
        errorMessage = nil
        pendingReview = nil
        pendingDuplicates = nil
        stagedReview = nil
        stagedDuplicates = nil
        reviewQueue = []
        presentedReviewJobId = nil
        await reload()
    }

    // MARK: - SSE handling (mirrors the web app's phase logic, simplified)

    /// Map errors to a user-facing message, softening the transient ones that
    /// happen when the app is backgrounded / loses connectivity mid-request (a
    /// cancelled or dropped connection) so they don't read as a scary failure.
    private func friendlyError(_ error: Error) -> String {
        if let urlErr = error as? URLError,
           [.cancelled, .networkConnectionLost, .notConnectedToInternet, .timedOut].contains(urlErr.code) {
            return "Connection interrupted — please try again."
        }
        return (error as? NexusError)?.userMessage ?? error.localizedDescription
    }

    private func handle(_ event: SSEEvent) {
        switch event.type {
        case "thinking":
            if event.phase == "finalizing" {
                phaseText = "Putting it together…"
            } else if phaseText.isEmpty {
                phaseText = "Thinking…"
            }

        case "tool_call":
            if event.source == "orchestrator" {
                if event.phase == "delegation" {
                    switch event.delegationTarget {
                    case "census":
                        phaseText = (event.hasAttachments == true) ? "Scanning your photo…" : "Working on your inventory…"
                    case "vector":
                        phaseText = "Planning your move…"
                    default:
                        phaseText = event.label ?? "Working…"
                    }
                } else {
                    phaseText = event.label ?? "Working…"
                }
            } else if let label = event.label {
                detailText = event.detail.map { "\(label): \($0)" } ?? label
            }

        case "detected_items":
            if let items = event.detectedItems, !items.isEmpty {
                stagedReview = DetectedItemsReview(
                    mediaKind: event.mediaKind ?? "photo",
                    room: event.room,
                    items: items,
                    scanId: event.scanId
                )
                ClientEventLogger.shared.log(.reviewCardShown, sessionId: sessionId,
                                              metadata: ["mediaKind": event.mediaKind ?? "photo", "itemCount": String(items.count)])
                // Remember the room so a later rescan targets the same room.
                if let room = event.room, lastScan != nil { lastScan?.room = room }
            }

        case "duplicate_pairs":
            if let pairs = event.duplicatePairs, !pairs.isEmpty {
                stagedDuplicates = pairs
            }

        default:
            break
        }
    }

    private func captureShare(from done: SSEEvent) {
        guard let action = done.actions?.first(where: { $0.tool == "create_share" }),
              let urlString = action.result?.url,
              let url = URL(string: urlString) else { return }
        shareURL = url
    }
}
