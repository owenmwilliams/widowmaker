//
//  NexusButton.swift
//  Nexus Moves
//
//  Native port of design/components/core/Button.{jsx,d.ts,prompt.md}. Matches
//  the prop contract: variant/size/fullWidth/disabled/icon/iconRight.
//
//  iOS has no hover, so the web's hover-deepen is reinterpreted as press-deepen
//  (readme.md "Interaction states": press = "scale 0.97 + slight darken" is
//  listed platform-agnostically, unlike hover which is web-only) — press swaps
//  to the *-press/-quiet-2 token rather than just scaling, for primary/secondary.
//  `danger` has no `--danger-press` semantic in tokens.json, so its press state
//  dims via opacity instead of inventing one (COMMON.md rule #2: never fork a
//  token that isn't there).
//

import SwiftUI

enum NexusButtonVariant {
    /// Solid Nexus Blue — default action.
    case primary
    /// Signature blue→cyan gradient with a looping sweep. Reserve for ONE
    /// hero/AI CTA per screen — never a generic button style (COMMON.md).
    case shimmer
    /// Quiet accent tint on a surface (e.g. "Estimate weights").
    case secondary
    /// Transparent, low-priority.
    case ghost
    /// Destructive.
    case danger
}

enum NexusButtonSize {
    case sm, md, lg

    var height: CGFloat {
        switch self { case .sm: 36; case .md: 48; case .lg: 56 }
    }
    var horizontalPadding: CGFloat {
        switch self { case .sm: 14; case .md: 20; case .lg: 26 }
    }
    var fontSize: CGFloat {
        switch self { case .sm: 14; case .md: 16; case .lg: 17 }
    }
    var gap: CGFloat {
        switch self { case .sm: 7; case .md: 9; case .lg: 10 }
    }
    var radius: CGFloat {
        switch self { case .sm, .md: Theme.Radius.md; case .lg: Theme.Radius.lg }
    }
    var iconSize: CGFloat { fontSize + 2 }
}

struct NexusButton<Label: View>: View {
    var variant: NexusButtonVariant = .primary
    var size: NexusButtonSize = .md
    var fullWidth: Bool = false
    var disabled: Bool = false
    var icon: Image? = nil
    var iconRight: Image? = nil
    let action: () -> Void
    @ViewBuilder let label: () -> Label

    var body: some View {
        Button(action: action) {
            HStack(spacing: size.gap) {
                icon?.resizable().scaledToFit().frame(width: size.iconSize, height: size.iconSize)
                label()
                iconRight?.resizable().scaledToFit().frame(width: size.iconSize, height: size.iconSize)
            }
            .frame(height: size.height)
            .padding(.horizontal, size.horizontalPadding)
            .frame(maxWidth: fullWidth ? .infinity : nil)
        }
        .buttonStyle(NexusButtonStyle(variant: variant, size: size, disabled: disabled))
        .disabled(disabled)
    }
}

private struct NexusButtonStyle: ButtonStyle {
    let variant: NexusButtonVariant
    let size: NexusButtonSize
    let disabled: Bool

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed && !disabled
        let shape = RoundedRectangle(cornerRadius: size.radius, style: .continuous)

        configuration.label
            .font(.system(size: size.fontSize, weight: .bold))
            .nexusTracking(Theme.Tracking.title, size: size.fontSize)
            .foregroundStyle(foreground)
            .background(background(pressed: pressed))
            .shimmerSweep(active: variant == .shimmer && !disabled)
            .clipShape(shape)
            .opacity(disabled ? Theme.disabledOpacity : 1)
            .scaleEffect(pressed ? Theme.pressScale : 1)
            .animation(.easeOut(duration: Theme.Motion.durFast), value: configuration.isPressed)
    }

    private var foreground: Color {
        switch variant {
        case .primary, .shimmer, .danger: Theme.textOnAccent
        case .secondary: Theme.accent
        case .ghost: Theme.textPrimary
        }
    }

    @ViewBuilder
    private func background(pressed: Bool) -> some View {
        switch variant {
        case .primary: pressed ? Theme.accentPress : Theme.accent
        case .shimmer: Theme.Shimmer.gradient
        case .secondary: pressed ? Theme.accentQuiet2 : Theme.accentQuiet
        case .ghost: pressed ? Theme.surfaceHover : Color.clear
        case .danger: Theme.danger.opacity(pressed ? 0.85 : 1)
        }
    }
}
