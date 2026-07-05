//
//  NexusSheet.swift
//  Nexus Moves
//
//  Native port of design/components/surfaces/Sheet.{jsx,d.ts,prompt.md} — the
//  iOS-style bottom sheet chrome (grabber + title + Done), e.g. "Get ready to
//  share". Wraps arbitrary content below the header.
//

import SwiftUI

struct NexusSheet<Content: View>: View {
    var title: String? = nil
    var onDone: (() -> Void)? = nil
    var doneLabel: String = "Done"
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Theme.border)
                .frame(width: 40, height: 5)
                .padding(.top, 10)
                .padding(.bottom, 2)

            HStack {
                if let title {
                    Text(title)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                }
                Spacer()
                if let onDone {
                    Button(action: onDone) {
                        Text(doneLabel)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 8)
                            .background(Theme.surfaceCard)
                            .clipShape(Capsule())
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 10)
            .padding(.bottom, 16)

            content()
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
        }
        .background(Theme.surfaceSunk)
        .clipShape(
            UnevenRoundedRectangle(
                topLeadingRadius: Theme.Radius.xxl,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: Theme.Radius.xxl,
                style: .continuous
            )
        )
        .nexusShadow(Theme.Shadows.sheet)
    }
}
