//
//  Theme+ButtonStyles.swift
//  Nexus Moves
//
//  Pre-existing button styles, retokenized onto the new semantic layer.
//  These predate the design-system rollout and keep their current look
//  (accent gradient / quiet fill) for now — adopting the full core/Button.d.ts
//  variant contract (primary/shimmer/secondary/ghost/danger) is
//  component-by-component work, not this commit.
//

import SwiftUI

/// Filled brand button (primary CTA).
struct PrimaryButtonStyle: ButtonStyle {
    var enabled: Bool = true
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(enabled ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surfaceHover))
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? Theme.pressScale : 1)
            .animation(.easeOut(duration: Theme.Motion.durFast), value: configuration.isPressed)
    }
}

/// Outlined/tinted secondary button.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(Theme.accentQuiet)
            .foregroundStyle(Theme.accent)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .opacity(configuration.isPressed ? 0.7 : 1)
            .scaleEffect(configuration.isPressed ? Theme.pressScale : 1)
            .animation(.easeOut(duration: Theme.Motion.durFast), value: configuration.isPressed)
    }
}
