//
//  NexusChatView.swift
//  Nexus Moves
//
//  The whole app: a clean, native chat with the Nexus agent. A brand header with
//  a live "share readiness" banner makes it obvious how close the inventory is to
//  shareable and where to share it; the agent's [BUTTONS] render as real buttons.
//

import SwiftUI
import UIKit

struct NexusChatView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    @StateObject private var vm = NexusViewModel()

    @State private var draft = ""
    @State private var showAttachDialog = false
    @State private var pickerSource: MediaPicker.Source?
    @State private var shareItem: ShareItem?
    @State private var shareWarningText: String?
    @State private var showAINotice = false
    @State private var showReadiness = false
    @State private var captureCaption = ""
    @State private var pendingMedia: PendingMedia?
    @AppStorage("aiCaptureNoticeShown") private var aiNoticeShown = false
    @FocusState private var inputFocused: Bool

    private let bottomID = "nexus-bottom-anchor"

    var body: some View {
        VStack(spacing: 0) {
            header
            conversation
            if let error = vm.errorMessage {
                errorBar(error)
            }
            inputBar
        }
        .background(Theme.canvas, ignoresSafeAreaEdges: .all)
        .task { await vm.loadIfNeeded() }
        .confirmationDialog("Add a room photo or video", isPresented: $showAttachDialog, titleVisibility: .visible) {
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Take Photo or Video") { pickerSource = .camera }
            }
            Button("Choose from Library") { pickerSource = .library }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Recording a room? For the best results:\n1) Talk through your items out loud — Nexus listens.\n2) Open closets, cabinets & drawers.\n3) Pan slowly across the whole room (phone sideways, lights on).\nFor big items, add a straight-on close-up photo.")
        }
        .sheet(item: $pickerSource) { source in
            MediaPicker(
                source: source,
                onPicked: { data, mime, name in
                    pickerSource = nil
                    // Attach to the composer instead of sending immediately — the
                    // user can add a note (e.g. the room) and then tap send.
                    if draft.isEmpty && !captureCaption.isEmpty { draft = captureCaption }
                    captureCaption = ""
                    pendingMedia = PendingMedia(data: data, mimeType: mime, filename: name)
                },
                onCancel: { pickerSource = nil }
            )
            .ignoresSafeArea()
        }
        .sheet(item: $shareItem) { item in
            ShareSheet(items: [item.url])
        }
        .sheet(item: $vm.pendingReview, onDismiss: { vm.reviewSheetClosed() }) { review in
            ReviewItemsSheet(
                review: review,
                onCommit: { items in Task { await vm.commitReview(items, room: review.room, scanId: review.scanId) } },
                onCancel: { vm.pendingReview = nil },
                onRescan: {
                    vm.pendingReview = nil
                    Task { await vm.rescanLast() }
                }
            )
        }
        .sheet(item: $vm.pendingDuplicates) { dup in
            DuplicateReviewSheet(
                review: dup,
                onApply: { ids in Task { await vm.resolveDuplicates(removing: ids) } },
                onCancel: { vm.pendingDuplicates = nil }
            )
        }
        .sheet(isPresented: $showReadiness) {
            ReadinessSheet(
                readiness: vm.readiness,
                onShare: { Task { await onShareTapped() } },
                onEstimateWeights: { Task { await vm.send("Estimate the missing weights for my items.") } },
                onAddVideo: { beginCapture(caption: "") }
            )
        }
        .alert("Photos & videos use AI", isPresented: $showAINotice) {
            Button("Continue") {
                aiNoticeShown = true
                showAttachDialog = true
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("To build your inventory, the photos and videos you add are sent to AI services to identify your items and estimate their size and weight.")
        }
        .alert("Before you share", isPresented: Binding(
            get: { shareWarningText != nil },
            set: { if !$0 { shareWarningText = nil } }
        )) {
            Button("Share anyway") {
                Task { if let url = await vm.forceShare() { shareItem = ShareItem(url: url) } }
            }
            Button("Go back & fix", role: .cancel) { shareWarningText = nil }
        } message: {
            Text(shareWarningText ?? "")
        }
        .overlay {
            if vm.isPreparingShare { sharePreparingOverlay }
        }
        .onChange(of: vm.sessionExpired) { _, expired in
            if expired { Task { await authViewModel.logout() } }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(Theme.brandGradient)
                    .frame(width: 34, height: 34)
                    .overlay(Image(systemName: "sparkles").font(.system(size: 15, weight: .bold)).foregroundStyle(.white))
                VStack(alignment: .leading, spacing: 0) {
                    Text("Nexus Moves").font(.headline)
                    Text("Your moving assistant").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                Menu {
                    Button { Task { await vm.startNewConversation() } } label: {
                        Label("New conversation", systemImage: "square.and.pencil")
                    }
                    Divider()
                    Button(role: .destructive) { Task { await authViewModel.logout() } } label: {
                        Label("Log out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.title2).foregroundStyle(.secondary)
                }
            }
            ReadinessBanner(
                readiness: vm.readiness,
                isPreparing: vm.isPreparingShare,
                onTap: { showReadiness = true },
                onShare: { Task { await onShareTapped() } }
            )
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 12)
        .background { Theme.card.ignoresSafeArea(edges: .top) }
        .overlay(alignment: .bottom) { Divider() }
    }

    // MARK: - Conversation

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if vm.messages.isEmpty && !vm.isLoading {
                        welcomeCard
                    }
                    ForEach(vm.messages) { message in
                        MessageBubble(message: message, onButton: handleAgentButton)
                            .id(message.id)
                    }
                    if vm.isUploading {
                        UploadProgressRow(progress: vm.uploadProgress, label: vm.phaseText)
                    }
                    if vm.isLoading {
                        TypingIndicator(phase: vm.phaseText, detail: vm.detailText)
                    }
                    Color.clear.frame(height: 1).id(bottomID)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: vm.messages.count) { _, _ in scrollToBottom(proxy) }
            .onChange(of: vm.isLoading) { _, _ in scrollToBottom(proxy) }
            .onChange(of: vm.isUploading) { _, _ in scrollToBottom(proxy) }
            .onChange(of: vm.phaseText) { _, _ in scrollToBottom(proxy) }
            .onChange(of: vm.detailText) { _, _ in scrollToBottom(proxy) }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo(bottomID, anchor: .bottom)
        }
    }

    private var welcomeCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("👋 Hi, I'm Nexus")
                .font(.title2.bold())
            Text("Tell me about your move and I'll build an inventory you can share with movers — in three quick steps:")
                .foregroundStyle(.secondary)
            stepRow(1, "house.fill", "Tell me about your current home")
            stepRow(2, "video.fill", "Add a photo or video of each room")
            stepRow(3, "square.and.arrow.up", "Share your inventory with movers")
            Text("First — **what's your name?** Type it below to get started.")
                .font(.subheadline)
                .foregroundStyle(.primary)
                .padding(.top, 4)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        .padding(.top, 4)
    }

    private func stepRow(_ n: Int, _ icon: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Theme.brandSoft).frame(width: 32, height: 32)
                Image(systemName: icon).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.brand)
            }
            Text(text).font(.subheadline)
            Spacer(minLength: 0)
        }
    }

    private var chips: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(vm.quickStartChips) { chip in
                Button {
                    inputFocused = false
                    Task { await vm.send(chip.message) }
                } label: {
                    Text(chip.label)
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 9)
                        .background(Theme.brandSoft)
                        .foregroundStyle(Theme.brand)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 4)
    }

    // MARK: - Error

    private func errorBar(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(message).font(.footnote)
            Spacer(minLength: 0)
            Button { vm.errorMessage = nil } label: { Image(systemName: "xmark") }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .foregroundStyle(.white)
        .background(Theme.danger.opacity(0.92))
    }

    // MARK: - Input

    private var inputBar: some View {
        VStack(spacing: 8) {
            if let media = pendingMedia {
                pendingMediaChip(media)
            }
            HStack(alignment: .bottom, spacing: 10) {
                Button {
                    beginCapture(caption: "")
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(vm.isBusy ? AnyShapeStyle(Color.gray) : AnyShapeStyle(Theme.brandGradient))
                        .clipShape(Circle())
                }
                .disabled(vm.isBusy)

                TextField(pendingMedia == nil ? "Message Nexus…" : "Add a note (optional)…", text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($inputFocused)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 9)
                    .background(Theme.canvas)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.primary.opacity(0.08)))

                Button(action: sendDraft) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(canSend ? AnyShapeStyle(Theme.brandGradient) : AnyShapeStyle(Color.gray.opacity(0.5)))
                        .clipShape(Circle())
                }
                .disabled(!canSend)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background { Theme.card.ignoresSafeArea(edges: .bottom) }
        .overlay(alignment: .top) { Divider() }
    }

    private func pendingMediaChip(_ media: PendingMedia) -> some View {
        HStack(spacing: 8) {
            Image(systemName: media.isVideo ? "video.fill" : "photo.fill")
                .foregroundStyle(Theme.brand)
            Text(media.isVideo ? "Video attached" : "Photo attached")
                .font(.subheadline.weight(.medium))
            Spacer()
            Button { pendingMedia = nil } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.brandSoft)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var canSend: Bool {
        !vm.isBusy && (pendingMedia != nil || !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    // MARK: - Overlay

    private var sharePreparingOverlay: some View {
        ZStack {
            Color.black.opacity(0.25).ignoresSafeArea()
            VStack(spacing: 12) {
                ProgressView()
                Text("Preparing share link…").font(.subheadline)
            }
            .padding(24)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    // MARK: - Actions

    private func sendDraft() {
        let text = draft
        inputFocused = false
        if let media = pendingMedia {
            draft = ""
            pendingMedia = nil
            Task {
                let ok = await vm.sendMedia(data: media.data, mimeType: media.mimeType, filename: media.filename, caption: text)
                if !ok {
                    // Don't lose the video on a failed send — put it back so the
                    // user can retry. Exception: if the scan finished server-side
                    // and its review card survived the drop, restoring the media
                    // would just invite a duplicate rescan.
                    await MainActor.run {
                        guard vm.pendingReview == nil else { return }
                        pendingMedia = media
                        if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { draft = text }
                    }
                }
            }
        } else {
            draft = ""
            Task { await vm.send(text) }
        }
    }

    private func handleAgentButton(_ button: AgentButton) {
        switch button.primaryAction {
        case .send:
            inputFocused = false
            Task { await vm.send(button.message) }
        case .prefill:
            draft = button.message
            inputFocused = true
        case .camera:
            beginCapture(caption: button.message)
        }
    }

    private func beginCapture(caption: String) {
        captureCaption = caption
        inputFocused = false
        if aiNoticeShown {
            showAttachDialog = true
        } else {
            showAINotice = true
        }
    }

    private func onShareTapped() async {
        switch await vm.evaluateAndPrepareShare() {
        case .warn(let message): shareWarningText = message
        case .ready(let url): shareItem = ShareItem(url: url)
        case .failed: break
        }
    }
}

// MARK: - Readiness banner

private struct ReadinessBanner: View {
    let readiness: ShareReadinessDTO?
    let isPreparing: Bool
    let onTap: () -> Void
    let onShare: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onTap) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(readiness?.statusLabel ?? "Building your inventory")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                        Spacer()
                        Text("\(readiness?.overall ?? 0)%")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    ProgressView(value: readiness?.progress ?? 0).tint(Theme.brand)
                    HStack(spacing: 3) {
                        Text("See what's left")
                        Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold))
                    }
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Theme.brand)
                }
            }
            .buttonStyle(.plain)

            Button(action: onShare) {
                VStack(spacing: 3) {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 16, weight: .semibold))
                    Text("Share").font(.caption2.weight(.bold))
                }
                .frame(width: 60, height: 56)
                .background(Theme.brandGradient)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .opacity(isPreparing ? 0.6 : 1)
            }
            .disabled(isPreparing)
        }
        .padding(12)
        .background(Theme.canvas)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius).stroke(Color.primary.opacity(0.06)))
    }
}

// MARK: - Message bubble

private struct MessageBubble: View {
    let message: ChatMessage
    let onButton: (AgentButton) -> Void

    private var isUser: Bool { message.role == .user }

    var body: some View {
        let parsed: ParsedAgentMessage? = isUser ? nil : AgentMessageParser.parse(message.text)
        let displayText = isUser ? message.text : (parsed?.prose ?? message.text)

        VStack(alignment: isUser ? .trailing : .leading, spacing: 8) {
            HStack {
                if isUser { Spacer(minLength: 44) }
                VStack(alignment: isUser ? .trailing : .leading, spacing: 6) {
                    ForEach(Array(message.attachments.enumerated()), id: \.offset) { _, attachment in
                        Text(attachment.displayLabel)
                            .font(.footnote.weight(.medium))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(isUser ? Color.white.opacity(0.25) : Theme.brandSoft)
                            .foregroundStyle(isUser ? .white : Theme.brand)
                            .clipShape(Capsule())
                    }
                    if !displayText.isEmpty {
                        Text(styled(displayText))
                            .textSelection(.enabled)
                            .padding(.horizontal, 15)
                            .padding(.vertical, 11)
                            .background(isUser ? AnyShapeStyle(Theme.brandGradient) : AnyShapeStyle(Theme.modelBubble))
                            .foregroundStyle(isUser ? Color.white : Color.primary)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.bubbleRadius, style: .continuous))
                    }
                }
                if !isUser { Spacer(minLength: 44) }
            }

            if let buttons = parsed?.buttons, !buttons.isEmpty {
                VStack(spacing: 8) {
                    ForEach(buttons) { button in
                        AgentButtonRow(button: button) { onButton(button) }
                    }
                }
                .padding(.trailing, 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    private func styled(_ string: String) -> AttributedString {
        (try? AttributedString(
            markdown: string,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(string)
    }
}

// MARK: - Agent inline button

private struct AgentButtonRow: View {
    let button: AgentButton
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.subheadline)
                Text(button.label).font(.subheadline.weight(.semibold)).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.brandSoft)
            .foregroundStyle(Theme.brand)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var icon: String {
        switch button.primaryAction {
        case .send: return "paperplane.fill"
        case .prefill: return "square.and.pencil"
        case .camera: return "camera.fill"
        }
    }
}

// MARK: - Typing indicator

private struct TypingIndicator: View {
    let phase: String
    let detail: String

    var body: some View {
        HStack(spacing: 10) {
            TimelineView(.animation) { context in
                let t = context.date.timeIntervalSinceReferenceDate
                HStack(spacing: 4) {
                    ForEach(0..<3) { i in
                        Circle()
                            .frame(width: 7, height: 7)
                            .foregroundStyle(Theme.brand.opacity(0.7))
                            .scaleEffect(0.7 + 0.3 * abs(CGFloat(sin(t * 4 + Double(i) * 0.7))))
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 13)
                .background(Theme.modelBubble)
                .clipShape(RoundedRectangle(cornerRadius: Theme.bubbleRadius, style: .continuous))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(phase.isEmpty ? "Thinking…" : phase).font(.subheadline).foregroundStyle(.secondary)
                if !detail.isEmpty {
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Small types

// Wrapper so the native share sheet presents data-driven via `.sheet(item:)`.
private struct ShareItem: Identifiable {
    let id = UUID()
    let url: URL
}

// A captured photo/video attached to the composer, sent on the next Send tap.
private struct PendingMedia {
    let data: Data
    let mimeType: String
    let filename: String
    var isVideo: Bool { mimeType.hasPrefix("video") }
}

// Lets `.sheet(item:)` present the camera/library picker.
extension MediaPicker.Source: Identifiable {
    var id: Int { self == .camera ? 0 : 1 }
}


/// Upload feedback under the just-sent bubble: a determinate bar once the
/// direct-GCS PUT reports bytes (videos), an indeterminate spinner otherwise.
private struct UploadProgressRow: View {
    let progress: Double
    let label: String

    var body: some View {
        HStack(spacing: 10) {
            if progress > 0 {
                ProgressView(value: min(progress, 1))
                    .progressViewStyle(.linear)
                    .frame(maxWidth: 180)
                Text("\(Int(min(progress, 1) * 100))%")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            } else {
                ProgressView()
                    .controlSize(.small)
            }
            Text(label.isEmpty ? "Uploading…" : label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
    }
}
