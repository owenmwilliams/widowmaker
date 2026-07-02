//
//  ReadinessSheet.swift
//  Nexus Moves
//
//  "Get ready to share" — shows how complete the inventory is, what's left to do,
//  any reasonableness warning, and the primary Share action. This is where the
//  user understands the steps to a shareable inventory.
//

import SwiftUI

struct ReadinessSheet: View {
    let readiness: ShareReadinessDTO?
    var onShare: () -> Void
    var onEstimateWeights: () -> Void
    var onAddVideo: () -> Void

    @Environment(\.dismiss) private var dismiss

    private var progress: Double { readiness?.progress ?? 0 }
    private var overall: Int { readiness?.overall ?? 0 }
    private var steps: [String] { readiness?.nextSteps ?? [] }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    header
                    if let warning = readiness?.shareWarning {
                        warningCard(warning)
                    }
                    stepsCard
                    if let gaps = readiness?.mediaGaps {
                        mediaCard(gaps)
                    }
                }
                .padding(20)
            }
            .background(Theme.canvas)
            .safeAreaInset(edge: .bottom) { ctaBar }
            .navigationTitle("Get ready to share")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - Header (progress ring)

    private var header: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().stroke(Theme.brandSoft, lineWidth: 14)
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(Theme.brandGradient, style: StrokeStyle(lineWidth: 14, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeOut(duration: 0.5), value: progress)
                VStack(spacing: 0) {
                    Text("\(overall)%").font(.system(size: 34, weight: .bold, design: .rounded))
                    Text("ready").font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(width: 132, height: 132)
            .padding(.top, 8)

            Text(readiness?.statusLabel ?? "Building your inventory")
                .font(.title3.bold())
            if let summary = readiness?.summary {
                Text(summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Warning

    // warnSoft is a fixed light cream, so the text needs a fixed DARK color — the
    // default (.primary) is white in dark mode → the "white on white" bug.
    private let warnText = Color(red: 0.42, green: 0.27, blue: 0.02)

    private func warningCard(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.warn)
            Text(text).font(.subheadline).foregroundStyle(warnText)
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Theme.warnSoft)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.cardRadius)
                .stroke(Theme.warn.opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - Steps

    private var stepsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(steps.isEmpty ? "You're all set" : "Next steps")
                .font(.headline)

            if steps.isEmpty {
                Label("Your inventory looks ready to share.", systemImage: "checkmark.seal.fill")
                    .font(.subheadline)
                    .foregroundStyle(Theme.good)
            } else {
                ForEach(Array(steps.enumerated()), id: \.offset) { _, step in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "circle")
                            .font(.body)
                            .foregroundStyle(Theme.brand)
                        Text(step).font(.subheadline)
                        Spacer(minLength: 0)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
    }

    // MARK: - Media gaps (which rooms have a walkthrough, which big items have a photo)

    private func mediaCard(_ gaps: ShareReadinessDTO.MediaGaps) -> some View {
        let rooms = gaps.roomsMissingVideo ?? []
        let items = gaps.largeItemsMissingPhoto ?? []
        return VStack(alignment: .leading, spacing: 14) {
            Text("Videos & photos").font(.headline)
            if rooms.isEmpty && items.isEmpty {
                Label("Every room has a walkthrough and the big items are photographed.", systemImage: "checkmark.seal.fill")
                    .font(.subheadline)
                    .foregroundStyle(Theme.good)
            } else {
                // One explicit to-do per room and per big item — a joined
                // summary string reads as one chore; a checklist reads as n
                // small ones the user can actually knock out.
                ForEach(rooms.compactMap { $0.room }, id: \.self) { room in
                    mediaRow(
                        icon: "video.fill",
                        title: "Record a walkthrough \u{2014} \(room)",
                        detail: "A slow 20-second pan; open closets and cupboards."
                    )
                }
                let photoTodos: [(String, String)] = items.flatMap { gap in
                    (gap.items ?? []).map { name in (name, gap.room ?? "") }
                }
                ForEach(Array(photoTodos.prefix(12).enumerated()), id: \.offset) { _, todo in
                    mediaRow(
                        icon: "camera.fill",
                        title: "Photograph \u{2014} \(todo.0)\(todo.1.isEmpty ? "" : " (\(todo.1))")",
                        detail: "One straight-on shot tightens the size and weight estimate."
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
    }

    private func mediaRow(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.body).foregroundStyle(Theme.brand)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: - CTAs

    private var ctaBar: some View {
        VStack(spacing: 10) {
            Button {
                dismiss()
                onShare()
            } label: {
                Label("Share inventory", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(PrimaryButtonStyle())

            HStack(spacing: 10) {
                Button {
                    dismiss()
                    onEstimateWeights()
                } label: {
                    Text("Estimate weights")
                }
                .buttonStyle(SecondaryButtonStyle())

                Button {
                    dismiss()
                    onAddVideo()
                } label: {
                    Text("Add a room")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(16)
        .background(.regularMaterial)
    }
}
