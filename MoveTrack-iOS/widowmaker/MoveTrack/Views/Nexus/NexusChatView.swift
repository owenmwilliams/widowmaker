//
//  NexusChatView.swift
//  Nexus Moves
//
//  The entire app, basically. A native chat with the Nexus agent: type or speak
//  to it, drop in a room photo/video, and it builds a moving inventory you can
//  share with movers. No dashboards, no item tables — just the agent.
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
    @AppStorage("aiCaptureNoticeShown") private var aiNoticeShown = false
    @FocusState private var inputFocused: Bool

    private let bottomID = "nexus-bottom-anchor"

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                conversation
                if let error = vm.errorMessage {
                    errorBar(error)
                }
                inputBar
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
            .task { await vm.loadIfNeeded() }
            .confirmationDialog("Add a room photo or video", isPresented: $showAttachDialog, titleVisibility: .visible) {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button("Take Photo or Video") { pickerSource = .camera }
                }
                Button("Choose from Library") { pickerSource = .library }
                Button("Cancel", role: .cancel) {}
            }
            .sheet(item: $pickerSource) { source in
                MediaPicker(
                    source: source,
                    onPicked: { data, mime, name in
                        pickerSource = nil
                        Task { await vm.sendMedia(data: data, mimeType: mime, filename: name) }
                    },
                    onCancel: { pickerSource = nil }
                )
                .ignoresSafeArea()
            }
            .sheet(item: $shareItem) { item in
                ShareSheet(items: [item.url])
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
                Button("Review & fix", role: .cancel) { shareWarningText = nil }
            } message: {
                Text(shareWarningText ?? "")
            }
            .overlay {
                if vm.isPreparingShare {
                    sharePreparingOverlay
                }
            }
            .onChange(of: vm.sessionExpired) { _, expired in
                if expired { Task { await authViewModel.logout() } }
            }
        }
    }

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

    // MARK: - Conversation

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if vm.messages.isEmpty && !vm.isLoading {
                        introCard
                    }
                    ForEach(vm.messages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                    }
                    if vm.isLoading {
                        typingIndicator
                    }
                    if !vm.quickStartChips.isEmpty && !vm.isLoading {
                        chips
                    }
                    Color.clear.frame(height: 1).id(bottomID)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: vm.messages.count) { _, _ in scrollToBottom(proxy) }
            .onChange(of: vm.isLoading) { _, _ in scrollToBottom(proxy) }
            .onChange(of: vm.phaseText) { _, _ in scrollToBottom(proxy) }
            .onChange(of: vm.detailText) { _, _ in scrollToBottom(proxy) }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo(bottomID, anchor: .bottom)
        }
    }

    private var introCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles")
                    .font(.title2)
                    .foregroundStyle(.blue)
                Text("Hi, I'm Nexus 👋")
                    .font(.title3.bold())
            }
            Text("I'll build a moving inventory you can share with movers — in three quick steps:")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 8) {
                stepRow(1, "Tell me about your current home")
                stepRow(2, "Take a video of each room")
                stepRow(3, "Tell me where you're moving to")
            }
            Text("Tap **+** anytime to add a room video or photo.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.top, 2)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.top, 8)
    }

    private func stepRow(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)")
                .font(.subheadline.bold())
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(Circle().fill(Color.blue))
            Text(text)
            Spacer(minLength: 0)
        }
    }

    private var typingIndicator: some View {
        HStack(spacing: 10) {
            ProgressView()
            VStack(alignment: .leading, spacing: 2) {
                Text(vm.phaseText.isEmpty ? "Thinking…" : vm.phaseText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if !vm.detailText.isEmpty {
                    Text(vm.detailText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var chips: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(vm.quickStartChips) { chip in
                Button {
                    inputFocused = false
                    Task { await vm.send(chip.message) }
                } label: {
                    Text(chip.label)
                        .font(.subheadline)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Color.blue.opacity(0.12))
                        .foregroundStyle(Color.blue)
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
            Button {
                vm.errorMessage = nil
            } label: {
                Image(systemName: "xmark")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .foregroundStyle(.white)
        .background(Color.red.opacity(0.9))
    }

    // MARK: - Input

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: 10) {
            Button {
                inputFocused = false
                if aiNoticeShown {
                    showAttachDialog = true
                } else {
                    showAINotice = true
                }
            } label: {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(vm.isBusy ? Color.gray : Color.blue)
            }
            .disabled(vm.isBusy)

            TextField("Message Nexus…", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .focused($inputFocused)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

            Button(action: sendDraft) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(canSend ? Color.blue : Color.gray)
            }
            .disabled(!canSend)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.thinMaterial)
    }

    private var canSend: Bool {
        !vm.isLoading && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func sendDraft() {
        let text = draft
        draft = ""
        inputFocused = false
        Task { await vm.send(text) }
    }

    private func onShareTapped() async {
        // One operation, one loading state. Warn first only if the inventory looks
        // implausible (warn-but-allow); otherwise present the share sheet.
        switch await vm.evaluateAndPrepareShare() {
        case .warn(let message):
            shareWarningText = message
        case .ready(let url):
            shareItem = ShareItem(url: url)
        case .failed:
            break // error (if any) is surfaced via vm.errorMessage
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            VStack(spacing: 1) {
                Text("Nexus").font(.headline)
                Text("Your moving assistant")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button {
                    Task { await onShareTapped() }
                } label: {
                    Label("Share inventory", systemImage: "square.and.arrow.up")
                }
                .disabled(vm.isPreparingShare)
                Button {
                    Task { await vm.startNewConversation() }
                } label: {
                    Label("New conversation", systemImage: "square.and.pencil")
                }
                Divider()
                Button(role: .destructive) {
                    Task { await authViewModel.logout() }
                } label: {
                    Label("Log out", systemImage: "rectangle.portrait.and.arrow.right")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
        }
    }
}

// MARK: - Message bubble

private struct MessageBubble: View {
    let message: ChatMessage

    private var isUser: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 6) {
                ForEach(Array(message.attachments.enumerated()), id: \.offset) { _, attachment in
                    Text(attachment.displayLabel)
                        .font(.footnote.weight(.medium))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.blue.opacity(0.15))
                        .clipShape(Capsule())
                }

                if !message.text.isEmpty {
                    Text(styled(message.text))
                        .textSelection(.enabled)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(isUser ? Color.blue : Color(.systemGray6))
                        .foregroundStyle(isUser ? Color.white : Color.primary)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
            }

            if !isUser { Spacer(minLength: 40) }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    /// Render light markdown (links, bold) the agent commonly returns; fall back
    /// to plain text on failure.
    private func styled(_ string: String) -> AttributedString {
        (try? AttributedString(
            markdown: string,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(string)
    }
}

// Lets `.sheet(item:)` present the camera/library picker.
extension MediaPicker.Source: Identifiable {
    var id: Int { self == .camera ? 0 : 1 }
}

// Wrapper so the native share sheet is presented data-driven via `.sheet(item:)`
// (avoids the overlay-then-sheet race that flashed the loading modal).
private struct ShareItem: Identifiable {
    let id = UUID()
    let url: URL
}
