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

@MainActor
final class NexusViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var quickStartChips: [QuickStartChip] = []
    @Published var isLoading = false        // a message round-trip is in flight
    @Published var isUploading = false      // a photo/video is uploading
    @Published var phaseText = ""           // "Thinking…", "Scanning your photo…"
    @Published var detailText = ""          // secondary specialist detail
    @Published var errorMessage: String?
    @Published var shareURL: URL?           // set when the agent creates a share link

    private let service = NexusService.shared
    private var sessionId: String?
    private var didLoad = false

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
            errorMessage = NexusError.unauthorized.userMessage
        } catch {
            errorMessage = (error as? NexusError)?.userMessage ?? error.localizedDescription
        }
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

        do {
            let done = try await service.sendMessage(text: text, attachments: attachments) { [weak self] event in
                self?.handle(event)
            }
            sessionId = done.sessionId ?? sessionId
            let reply = (done.reply ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !reply.isEmpty {
                messages.append(ChatMessage(role: .model, text: reply))
            }
            captureShare(from: done)
        } catch {
            // Drop the optimistic bubble and surface the error.
            messages.removeAll { $0.id == optimistic.id }
            errorMessage = (error as? NexusError)?.userMessage ?? error.localizedDescription
        }

        isLoading = false
        phaseText = ""
        detailText = ""
    }

    // MARK: - Media

    func sendMedia(data: Data, mimeType: String, filename: String, caption: String = "") async {
        guard !isBusy else { return }
        errorMessage = nil
        isUploading = true
        phaseText = mimeType.hasPrefix("video") ? "Uploading video…" : "Uploading photo…"
        do {
            let uploaded = try await service.uploadMedia(data: data, mimeType: mimeType, filename: filename)
            isUploading = false
            phaseText = ""
            await send(
                text: caption,
                attachments: [OutgoingAttachment(url: uploaded.url, mimeType: uploaded.mimeType)]
            )
        } catch {
            isUploading = false
            phaseText = ""
            errorMessage = (error as? NexusError)?.userMessage ?? error.localizedDescription
        }
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
        await reload()
    }

    // MARK: - SSE handling (mirrors the web app's phase logic, simplified)

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
