//
//  NexusIconButton.swift
//  Nexus Moves
//
//  Native port of design/components/core/IconButton.{jsx,d.ts,prompt.md} —
//  circular/rounded-square icon-only control (composer +, send, ellipsis menu).
//

import SwiftUI

/// `.standard` is the contract's "default" (a Swift keyword, avoided as a case name).
enum NexusIconButtonTone { case standard, accent, quiet, plain }
enum NexusIconButtonShape { case circle, square }

struct NexusIconButton: View {
    var tone: NexusIconButtonTone = .standard
    /// Defaults to 44 — the minimum tap target (`Theme.tapMin`).
    var size: CGFloat = Theme.tapMin
    var shape: NexusIconButtonShape = .circle
    var disabled: Bool = false
    let accessibilityLabel: String
    let icon: Image
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            icon.resizable().scaledToFit()
                .frame(width: (size * 0.45).rounded(), height: (size * 0.45).rounded())
        }
        .frame(width: size, height: size)
        .buttonStyle(NexusIconButtonStyle(tone: tone, shape: shape, disabled: disabled))
        .disabled(disabled)
        .accessibilityLabel(accessibilityLabel)
    }
}

private struct NexusIconButtonStyle: ButtonStyle {
    let tone: NexusIconButtonTone
    let shape: NexusIconButtonShape
    let disabled: Bool

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed && !disabled
        configuration.label
            .foregroundStyle(foreground)
            .background(background(pressed: pressed))
            .clipShape(clipShape)
            .opacity(disabled ? Theme.disabledOpacity : 1)
            // IconButton.jsx presses tighter than the general Button (0.92 vs
            // ~0.97) — a deliberate, distinct value in the component source,
            // which COMMON.md says wins over the general guideline.
            .scaleEffect(pressed ? 0.92 : 1)
            .animation(.easeOut(duration: Theme.Motion.durFast), value: configuration.isPressed)
    }

    private var clipShape: AnyShape {
        switch shape {
        case .circle: AnyShape(Circle())
        case .square: AnyShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
        }
    }

    private var foreground: Color {
        switch tone {
        case .standard: Theme.textPrimary
        case .accent: Theme.textOnAccent
        case .quiet: Theme.accent
        case .plain: Theme.textSecondary
        }
    }

    private func background(pressed: Bool) -> Color {
        switch tone {
        case .standard: pressed ? Theme.surfaceHover : Theme.surfaceCard
        // Web's interactive state is accent-hover; native has no hover, so
        // press maps to accent-press (a distinct token meant for exactly
        // this), same reasoning as NexusButton's primary variant.
        case .accent: pressed ? Theme.accentPress : Theme.accent
        case .quiet: pressed ? Theme.accentQuiet2 : Theme.accentQuiet
        case .plain: pressed ? Theme.surfaceHover : Color.clear
        }
    }
}
