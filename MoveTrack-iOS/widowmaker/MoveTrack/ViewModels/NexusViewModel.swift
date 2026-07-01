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
        await refreshReadiness()
    }

    /// Refresh the share-readiness snapshot (best-effort; never disrupts the UI).
    func refreshReadiness() async {
        if let r = try? await service.shareReadiness() { readiness = r }
    }

    // MARK: - Send

    func send(_ text: String) async {
        await send(text: text, attachments: [])
    }

    func send(text rawText: String, attachments: [OutgoingAttachment]) async {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || !attachments.isEmpty else { return }
        guard !isLoading else { return }

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

        do {
            let done = try await service.sendMessage(text: text, attachments: attachments) { [weak self] event in
                self?.handle(event)
            }
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
            if let review = stagedReview { pendingReview = review }
            if let dups = stagedDuplicates { pendingDuplicates = DuplicateReview(pairs: dups) }
            stagedReview = nil
            stagedDuplicates = nil
        } catch NexusError.unauthorized {
            messages.removeAll { $0.id == optimistic.id }
            sessionExpired = true
        } catch {
            // Drop the optimistic bubble and surface the error.
            messages.removeAll { $0.id == optimistic.id }
            errorMessage = friendlyError(error)
        }

        isLoading = false
        phaseText = ""
        detailText = ""
        await refreshReadiness()
    }

    // MARK: - Media

    /// Returns true if the media uploaded and the message was sent; false on any
    /// failure so the caller can keep the attachment in the composer for a retry.
    @discardableResult
    func sendMedia(data: Data, mimeType: String, filename: String, caption: String = "") async -> Bool {
        guard !isBusy else { return false }
        errorMessage = nil

        let isVideo = mimeType.hasPrefix("video")

        // Images go through the multipart endpoint (small, well under the cap).
        // Photos over ~30MB would 413, so guard those; videos upload directly to
        // storage via a signed URL and aren't bound by the request cap.
        if !isVideo && data.count > 30 * 1024 * 1024 {
            errorMessage = "That photo is too large to upload (\(data.count / 1024 / 1024) MB)."
            return false
        }

        isUploading = true
        phaseText = isVideo ? "Uploading video…" : "Uploading photo…"
        do {
            let uploaded = isVideo
                ? try await service.uploadMediaDirect(data: data, mimeType: mimeType, filename: filename)
                : try await service.uploadMedia(data: data, mimeType: mimeType, filename: filename)
            isUploading = false
            phaseText = ""
            await send(
                text: caption,
                attachments: [OutgoingAttachment(url: uploaded.url, mimeType: uploaded.mimeType)]
            )
            return true
        } catch NexusError.unauthorized {
            isUploading = false
            phaseText = ""
            sessionExpired = true
            return false
        } catch {
            isUploading = false
            phaseText = ""
            errorMessage = friendlyError(error)
            return false
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
    func commitReview(_ items: [DetectedItem], room: String?) async {
        pendingReview = nil
        let kept = items.filter {
            $0.keep && !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        guard !kept.isEmpty else { return }
        isLoading = true
        phaseText = "Adding your items…"
        errorMessage = nil
        defer { isLoading = false; phaseText = "" }
        do {
            let payload = kept.map { ReviewedItemPayload(from: $0, fallbackRoom: room) }
            let added = try await service.commitReviewedItems(payload, room: room)
            let dest = room.map { " to the \($0)" } ?? ""
            messages.append(ChatMessage(
                role: .model,
                text: "✅ Added \(added) item\(added == 1 ? "" : "s")\(dest) to your inventory."
            ))
        } catch NexusError.unauthorized {
            sessionExpired = true
        } catch {
            errorMessage = (error as? NexusError)?.userMessage ?? error.localizedDescription
        }
        await refreshReadiness()
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
                    items: items
                )
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
