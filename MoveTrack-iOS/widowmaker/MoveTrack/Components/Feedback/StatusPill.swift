//
//  StatusPill.swift
//  Nexus Moves
//
//  Native port of design/components/feedback/StatusPill.{jsx,d.ts,prompt.md} —
//  a centered inline status marker in the chat stream (a conversational
//  divider, not a badge), e.g. "Items reviewed · 8 added".
//

import SwiftUI

enum NexusStatusPillTone { case success, accent, neutral }

struct NexusStatusPill: View {
    var tone: NexusStatusPillTone = .success
    var icon: Image? = nil
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            ZStack {
                Circle().stroke(ringColor, lineWidth: 1.5)
                (icon ?? Image(systemName: "checkmark"))
                    .resizable().scaledToFit()
                    .fontWeight(.heavy)
                    .padding(4)
            }
            .frame(width: 18, height: 18)
            Text(text)
        }
        .font(.system(size: 14, weight: .bold))
        .foregroundStyle(color)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Theme.surfaceCard)
        .clipShape(Capsule())
    }

    private var color: Color {
        switch tone {
        case .success: Theme.success
        case .accent: Theme.accent
        case .neutral: Theme.textSecondary
        }
    }
    private var ringColor: Color {
        switch tone {
        case .success: Theme.success
        case .accent: Theme.accent
        case .neutral: Theme.textTertiary
        }
    }
}
