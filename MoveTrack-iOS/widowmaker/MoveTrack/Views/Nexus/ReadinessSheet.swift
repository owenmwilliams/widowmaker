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

    private func warningCard(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.warn)
            Text(text).font(.subheadline)
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
