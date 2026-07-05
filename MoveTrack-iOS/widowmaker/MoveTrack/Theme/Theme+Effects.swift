//
//  Theme+Effects.swift
//  Nexus Moves
//
//  Elevation (shadows/glows) and gradient tokens from design/tokens/effects.css.
//  CSS blur-radius has no exact SwiftUI equivalent; shadow `radius` below is
//  blur-radius/2, the standard approximation (SwiftUI's shadow is a Gaussian
//  blur sigma, CSS's is roughly 2x that).
//

import SwiftUI

extension Theme {

    /// One shadow/glow token: pass to `.nexusShadow(_:)`.
    struct Shadow {
        let color: Color
        let radius: CGFloat
        let x: CGFloat
        let y: CGFloat
    }

    enum Shadows {
        // Light-theme soft, cool-tinted elevation (navy-tinted rgba(22,32,74,·)).
        private static let navy = Color(red: 22 / 255, green: 32 / 255, blue: 74 / 255)
        static let xs = Shadow(color: navy.opacity(0.06), radius: 1, x: 0, y: 1)
        static let sm = Shadow(color: navy.opacity(0.07), radius: 4, x: 0, y: 2)
        static let md = Shadow(color: navy.opacity(0.09), radius: 12, x: 0, y: 8)
        static let lg = Shadow(color: navy.opacity(0.14), radius: 24, x: 0, y: 18)
        static let xl = Shadow(color: navy.opacity(0.20), radius: 40, x: 0, y: 30)

        // Dark-theme elevation — mostly glow/lift rather than heavy drop shadows.
        static let darkSm = Shadow(color: .black.opacity(0.45), radius: 5, x: 0, y: 2)
        static let darkMd = Shadow(color: .black.opacity(0.55), radius: 16, x: 0, y: 12)
        /// Upward-cast shadow for bottom sheets.
        static let sheet = Shadow(color: .black.opacity(0.55), radius: 24, x: 0, y: -12)

        static let glowAccent = Shadow(color: Theme.accent.opacity(0.45), radius: 11, x: 0, y: 6)
        static let glowBeacon = Shadow(color: Theme.beacon.opacity(0.65), radius: 10, x: 0, y: 0)
        static let glowShimmer = Shadow(color: Theme.Shimmer.cyan.opacity(0.40), radius: 14, x: 0, y: 8)
    }

    /// Accent-colored diagonal gradient (accent → accentPress). The generic
    /// "brand, but a gradient" fill for buttons/avatars/bubbles that don't
    /// carry the signature shimmer — NOT the shimmer itself (see
    /// `Theme.Shimmer`), which is reserved for intelligence/hero moments only
    /// (COMMON.md restraint list).
    static let accentGradient = LinearGradient(
        colors: [accent, accentPress],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )

    /// The brand "aurora" backdrop wash (`--aurora`) — hero/marketing and the
    /// app header behind the assistant. Sparing: one per screen at most.
    static let auroraGradient = LinearGradient(
        colors: [Shimmer.cyan.opacity(0.16), .clear, Color(hex: "#3D45D9").opacity(0.20)],
        startPoint: .topTrailing, endPoint: .bottomLeading
    )
}

extension View {
    /// Applies a `Theme.Shadow` token.
    func nexusShadow(_ shadow: Theme.Shadow) -> some View {
        self.shadow(color: shadow.color, radius: shadow.radius, x: shadow.x, y: shadow.y)
    }
}
