//
//  AssistantAvatar.swift
//  Nexus Moves
//
//  Native port of design/components/chat/AssistantAvatar.{jsx,d.ts,prompt.md} —
//  a sparkles glyph on the signature shimmer. The ONLY filled brand mark; it
//  appears in the app header and beside assistant chat rows, nowhere else.
//

import SwiftUI

struct AssistantAvatar: View {
    enum AvatarShape { case square, circle }

    var size: CGFloat = 44
    var shape: AvatarShape = .square
    /// Looping highlight sweep (the "Nexus is here" signal). Default true.
    var sweep: Bool = true

    var body: some View {
        ZStack {
            Theme.Shimmer.gradient
            Image(systemName: "sparkles")
                .resizable()
                .scaledToFit()
                .fontWeight(.bold)
                .foregroundStyle(.white)
                .frame(width: size * 0.5, height: size * 0.5)
        }
        // Sweep BEFORE clipShape so the overlay's own bounds get clipped to
        // the final shape together with the gradient — otherwise the sweep's
        // rectangular clip can peek past a circular avatar's corners.
        .shimmerSweep(active: sweep)
        .frame(width: size, height: size)
        .clipShape(clipShape)
        .nexusShadow(Theme.Shadows.glowShimmer)
    }

    private var clipShape: AnyShape {
        switch shape {
        case .circle: AnyShape(Circle())
        case .square: AnyShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
        }
    }
}
