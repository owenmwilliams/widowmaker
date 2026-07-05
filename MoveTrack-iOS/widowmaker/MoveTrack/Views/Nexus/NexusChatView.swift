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
    @State private var pendingMedia: [PickedMedia] = []
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
        .background(Theme.bg, ignoresSafeAreaEdges: .all)
        .task { await vm.loadIfNeeded() }
        .confirmationDialog("Add a room photo or video", isPresented: $showAttachDialog, titleVisibility: .visible) {
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Take Photo or Video") { pickerSource = .camera }
            }
            Button("Choose Photos (up to 5)") { pickerSource = .photoLibrary }
            Button("Choose a Video") { pickerSource = .videoLibrary }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Recording a room? For the best results:\n1) Talk through your items out loud — Nexus listens.\n2) Open closets, cabinets & drawers.\n3) Pan slowly across the whole room (phone sideways, lights on).\nFor big items, add a straight-on close-up photo.")
        }
        .sheet(item: $pickerSource) { source in
            Group {
                if source == .photoLibrary {
                    PhotoLibraryPicker(
                        selectionLimit: photoSlotsLeft,
                        onPicked: { picked in
                            pickerSource = nil
                            attach(picked)
                        },
                        onCancel: { pickerSource = nil }
                    )
                } else {
                    MediaPicker(
                        source: source,
                        onPicked: { data, mime, name in
                            pickerSource = nil
                            attach([PickedMedia(data: data, mimeType: mime, filename: name)])
                        },
                        onCancel: { pickerSource = nil }
                    )
                }
            }
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
                onAddVideo: { beginCapture(caption: "") },
                onStep: { step in Task { await vm.send(step) } }
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
                AssistantAvatar(size: 34, shape: .square)
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
        .background { Theme.surfaceCard.ignoresSafeArea(edges: .top) }
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
                        if case .scanReview(let state) = message.kind {
                            ScanReviewPill(state: state)
                                .id(message.id)
                        } else {
                            MessageBubble(message: message, onButton: handleAgentButton)
                                .id(message.id)
                        }
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
        .background(Theme.surfaceCard)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
        .padding(.top, 4)
    }

    private func stepRow(_ n: Int, _ icon: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Theme.accentQuiet).frame(width: 32, height: 32)
                Image(systemName: icon).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.accent)
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
                        .background(Theme.accentQuiet)
                        .foregroundStyle(Theme.accent)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 4)
    }

    // MARK: - Error

    /// The "honest nudge" tone (warning, not danger) per ios.md — even a
    /// failed request reads as calm/kind rather than alarming, matching the
    /// brand voice ("frames gaps as gentle suggestions, never failures").
    private func errorBar(_ message: String) -> some View {
        NexusBanner(tone: .warning, text: message)
            .overlay(alignment: .topTrailing) {
                Button {
                    vm.errorMessage = nil
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Theme.warningInk)
                        .padding(10)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
    }

    // MARK: - Input

    private var inputBar: some View {
        VStack(spacing: 8) {
            if !pendingMedia.isEmpty {
                pendingMediaChips
            }
            HStack(alignment: .bottom, spacing: 10) {
                NexusIconButton(
                    tone: .accent, size: Theme.tapMin, disabled: vm.isBusy,
                    accessibilityLabel: "Add a photo or video",
                    icon: Image(systemName: "plus"),
                    action: { beginCapture(caption: "") }
                )

                NexusInput(
                    variant: .composer,
                    placeholder: pendingMedia.isEmpty ? "Message Nexus…" : "Add a note (optional)…",
                    text: $draft,
                    lineLimit: 1...5,
                    focused: $inputFocused
                )

                NexusIconButton(
                    tone: .accent, size: Theme.tapMin, disabled: !canSend,
                    accessibilityLabel: "Send",
                    icon: Image(systemName: "arrow.up"),
                    action: sendDraft
                )
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background { Theme.surfaceCard.ignoresSafeArea(edges: .bottom) }
        .overlay(alignment: .top) { Divider() }
    }

    private var pendingMediaChips: some View {
        VStack(spacing: 6) {
            ForEach(Array(pendingMedia.enumerated()), id: \.element.id) { index, media in
                HStack(spacing: 8) {
                    Image(systemName: media.isVideo ? "video.fill" : "photo.fill")
                        .foregroundStyle(Theme.accent)
                    Text(media.isVideo
                         ? "Video attached"
                         : (pendingMedia.count == 1 ? "Photo attached" : "Photo \(index + 1) of \(pendingMedia.count)"))
                        .font(.subheadline.weight(.medium))
                    Spacer()
                    Button { pendingMedia.removeAll { $0.id == media.id } } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Theme.accentQuiet)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    /// How many more photos the library picker may hand back. A pending video
    /// doesn't count — attaching photos replaces it.
    private var photoSlotsLeft: Int {
        let photos = pendingMedia.contains(where: { $0.isVideo }) ? 0 : pendingMedia.count
        return max(1, 5 - photos)
    }

    /// Composer attachment rules: a video always scans alone (attaching one
    /// replaces everything); photos accumulate up to five (attaching one
    /// replaces a pending video).
    private func attach(_ items: [PickedMedia]) {
        if draft.isEmpty && !captureCaption.isEmpty { draft = captureCaption }
        captureCaption = ""
        for item in items {
            if item.isVideo {
                pendingMedia = [item]
            } else {
                if pendingMedia.contains(where: { $0.isVideo }) { pendingMedia = [] }
                if pendingMedia.count < 5 { pendingMedia.append(item) }
            }
        }
    }

    private var canSend: Bool {
        !vm.isBusy && (!pendingMedia.isEmpty || !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
        if !pendingMedia.isEmpty {
            let items = pendingMedia
            draft = ""
            pendingMedia = []
            Task {
                let ok: Bool
                if items.count == 1, let only = items.first {
                    ok = await vm.sendMedia(data: only.data, mimeType: only.mimeType, filename: only.filename, caption: text)
                } else {
                    ok = await vm.sendMediaBatch(items, caption: text)
                }
                if !ok {
                    // Don't lose the media on a failed send — put it back so the
                    // user can retry. Exception: if the scan finished server-side
                    // and its review card survived the drop, restoring the media
                    // would just invite a duplicate rescan.
                    await MainActor.run {
                        guard vm.pendingReview == nil else { return }
                        pendingMedia = items
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
                    NexusProgressBar(
                        value: Double(readiness?.overall ?? 0),
                        label: readiness?.statusLabel ?? "Building your inventory",
                        height: 9
                    )
                    HStack(spacing: 3) {
                        Text("See what's left")
                        Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold))
                    }
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Theme.accent)
                }
            }
            .buttonStyle(.plain)

            Button(action: onShare) {
                VStack(spacing: 3) {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 16, weight: .semibold))
                    Text("Share").font(.caption2.weight(.bold))
                }
                .frame(width: 60, height: 56)
                // Solid accent, NOT shimmer — the kit reserves shimmer for
                // ReadinessSheet's full "Share inventory" CTA; two shimmer
                // buttons for the same action on one screen is a hard fail.
                .background(Theme.accent)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .opacity(isPreparing ? 0.6 : 1)
            }
            .disabled(isPreparing)
        }
        .padding(12)
        .background(Theme.bg)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Color.primary.opacity(0.06)))
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
                        HStack(spacing: 6) {
                            Image(systemName: attachment.isVideo ? "video.fill" : "photo.fill")
                            Text(attachment.displayLabel)
                        }
                        .font(.footnote.weight(.medium))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(isUser ? Color.white.opacity(0.25) : Theme.accentQuiet)
                        .foregroundStyle(isUser ? .white : Theme.accent)
                        .clipShape(Capsule())
                    }
                    if !displayText.isEmpty {
                        Text(styled(displayText))
                            .textSelection(.enabled)
                            .padding(.horizontal, 15)
                            .padding(.vertical, 11)
                            .background(isUser ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.bubbleOther))
                            .foregroundStyle(isUser ? Color.white : Color.primary)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.xl, style: .continuous))
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
            .background(Theme.accentQuiet)
            .foregroundStyle(Theme.accent)
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
                            .foregroundStyle(Theme.accent.opacity(0.7))
                            .scaleEffect(0.7 + 0.3 * abs(CGFloat(sin(t * 4 + Double(i) * 0.7))))
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 13)
                .background(Theme.bubbleOther)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.xl, style: .continuous))
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


// Lets `.sheet(item:)` present the camera/library picker.
extension MediaPicker.Source: Identifiable {
    var id: Int {
        switch self {
        case .camera: return 0
        case .videoLibrary: return 1
        case .photoLibrary: return 2
        }
    }
}


/// Upload feedback under the just-sent bubble: a determinate bar once the
/// direct-GCS PUT reports bytes (videos), an indeterminate spinner otherwise.
private struct UploadProgressRow: View {
    let progress: Double
    let label: String

    var body: some View {
        HStack(spacing: 10) {
            if progress > 0 {
                NexusProgressBar(value: min(progress, 1) * 100, showPercent: false, height: 6)
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


/// Compact artifact of a scan review in the message stream — the review modal
/// is the response; this pill just records that it happened and how it ended.
private struct ScanReviewPill: View {
    let state: ChatMessage.ScanReviewState

    // Plain (non-circular) glyphs — StatusPill already wraps the icon in its
    // own ring, so a circular SF Symbol here would read as a double ring.
    private var icon: String {
        switch state {
        case .pending: return "sparkles"
        case .reviewed: return "checkmark"
        case .dismissed: return "minus"
        case .record: return "checkmark.seal"
        }
    }

    private var tone: NexusStatusPillTone {
        switch state {
        case .reviewed: return .success
        default: return .neutral
        }
    }

    private var label: String {
        switch state {
        case .pending(let count):
            return "\(count) item\(count == 1 ? "" : "s") found \u{2014} reviewing\u{2026}"
        case .reviewed(let added, let skipped):
            var t = "Items reviewed \u{00B7} \(added) added"
            if skipped > 0 { t += ", \(skipped) skipped" }
            return t
        case .dismissed(let count):
            return "\(count) item\(count == 1 ? "" : "s") found \u{00B7} not added"
        case .record(let count):
            return count > 0 ? "\(count) item\(count == 1 ? "" : "s") found \u{00B7} reviewed" : "Items reviewed"
        }
    }

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            NexusStatusPill(tone: tone, icon: Image(systemName: icon), text: label)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
    }
}
