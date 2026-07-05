//
//  SuggestionButton.swift
//  Nexus Moves
//
//  Native port of design/components/chat/SuggestionButton.{jsx,d.ts,prompt.md} —
//  the assistant's proposed next actions beneath a message.
//

import SwiftUI

enum NexusSuggestionVariant {
    /// Full-width accent-tinted row (mobile).
    case block
    /// Pill (desktop) — kept for contract parity even though iOS uses `block`.
    case outline
}

struct NexusSuggestionButton: View {
    var variant: NexusSuggestionVariant = .block
    var icon: Image? = nil
    let label: String
    let action: () -> Void

    private var isBlock: Bool { variant == .block }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                icon?.resizable().scaledToFit().frame(width: 20, height: 20)
                Text(label)
                if isBlock { Spacer(minLength: 0) }
            }
            .font(.system(size: isBlock ? 17 : 15, weight: .bold))
            .nexusTracking(Theme.Tracking.title, size: isBlock ? 17 : 15)
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 18)
            .padding(.vertical, isBlock ? 16 : 11)
            .frame(maxWidth: isBlock ? .infinity : nil, alignment: .leading)
        }
        .buttonStyle(NexusSuggestionButtonStyle(variant: variant))
    }
}

private struct NexusSuggestionButtonStyle: ButtonStyle {
    let variant: NexusSuggestionVariant

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        let shape: AnyShape = variant == .block
            ? AnyShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
            : AnyShape(Capsule())

        configuration.label
            .background(background(pressed: pressed))
            .overlay {
                if variant == .outline { shape.stroke(Theme.border, lineWidth: 1.5) }
            }
            .clipShape(shape)
            // SuggestionButton.jsx's own press scale (0.985) — distinct from
            // both Button (0.97) and IconButton (0.92); each component source
            // tunes its own value, which wins over the general guideline.
            .scaleEffect(pressed ? 0.985 : 1)
            .animation(.easeOut(duration: Theme.Motion.durFast), value: configuration.isPressed)
    }

    private func background(pressed: Bool) -> Color {
        switch variant {
        case .block: pressed ? Theme.accentQuiet2 : Theme.accentQuiet
        case .outline: pressed ? Theme.accentQuiet : Color.clear
        }
    }
}
