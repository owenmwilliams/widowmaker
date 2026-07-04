//
//  Theme+Shimmer.swift
//  Nexus Moves
//
//  The shimmer — Nexus's signature "intelligence" gradient (design/tokens/effects.css).
//  Used ONLY on: the assistant avatar, the readiness progress fill, and at
//  most one hero CTA per screen (design/briefs/ios.md §1, COMMON.md restraint
//  list). It is NOT a generic button/surface style — everywhere else uses
//  `Theme.accent` / `Theme.accentGradient`.
//

import SwiftUI

extension Theme {
    enum Shimmer {
        static let blue = Color(hex: "#3B6FE0")
        static let mid = Color(hex: "#2F8FE0")
        static let cyan = Color(hex: "#34C8E0")

        /// `linear-gradient(115deg, blue 0%, mid 48%, cyan 100%)`. The unit
        /// points below approximate a 115° CSS gradient angle (measured
        /// clockwise from "up"); exact degree fidelity isn't load-bearing —
        /// the design source itself notes shimmer values are best-fit
        /// reconstructions from screenshots, not extracted source truth.
        static let gradient = LinearGradient(
            stops: [
                .init(color: blue, location: 0),
                .init(color: mid, location: 0.48),
                .init(color: cyan, location: 1),
            ],
            startPoint: UnitPoint(x: 0.05, y: 0.29),
            endPoint: UnitPoint(x: 0.95, y: 0.71)
        )

        /// `--shimmer-soft` — a slightly deeper variant for large/soft fills.
        static let softGradient = LinearGradient(
            stops: [
                .init(color: blue.blended(towardBlack: 0.10), location: 0),
                .init(color: cyan, location: 1),
            ],
            startPoint: UnitPoint(x: 0.05, y: 0.29),
            endPoint: UnitPoint(x: 1.3, y: 0.71)
        )

        /// `--shimmer-v` — vertical variant for streak bars / tall fills.
        static let verticalGradient = LinearGradient(
            colors: [cyan, blue, Color(hex: "#2F35B4")],
            startPoint: .top, endPoint: .bottom
        )

        /// Looping highlight animation (`nx-shimmer-sweep`, 2200ms, ease-standard).
        static let sweepAnimation = Animation
            .timingCurve(0.22, 0.61, 0.36, 1, duration: Theme.Motion.shimmerSweepDuration)
            .repeatForever(autoreverses: false)

        /// `nx-beacon-pulse` — the "almost home" heartbeat, slow (2s round trip
        /// via the same standard ease); opacity 0.55↔1, scale 1↔1.08.
        static let pulseAnimation = Animation
            .timingCurve(0.22, 0.61, 0.36, 1, duration: 1.0)
            .repeatForever(autoreverses: true)
    }
}

/// A looping diagonal highlight traveling across shimmer-gradient surfaces —
/// the "Nexus is working" signal. Apply to a view already filled with
/// `Theme.Shimmer.gradient`. No-ops (renders nothing extra) under Reduce Motion.
private struct ShimmerSweep: ViewModifier {
    var active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sweeping = false

    func body(content: Content) -> some View {
        content.overlay(
            GeometryReader { geo in
                if active && !reduceMotion {
                    let bandWidth = geo.size.width * 0.5
                    LinearGradient(
                        colors: [.clear, .white.opacity(0.4), .clear],
                        startPoint: .leading, endPoint: .trailing
                    )
                    .frame(width: bandWidth)
                    .rotationEffect(.degrees(-18))
                    .offset(x: sweeping ? geo.size.width + bandWidth : -bandWidth)
                    .onAppear {
                        withAnimation(Theme.Shimmer.sweepAnimation) { sweeping = true }
                    }
                }
            }
            .clipped()
            .allowsHitTesting(false)
        )
    }
}

/// The destination-dot heartbeat. No-ops under Reduce Motion (holds at rest state).
private struct BeaconPulse: ViewModifier {
    var active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    func body(content: Content) -> some View {
        content
            .opacity(active && !reduceMotion && pulsing ? 1 : 0.55)
            .scaleEffect(active && !reduceMotion && pulsing ? 1.08 : 1)
            .onAppear {
                guard active, !reduceMotion else { return }
                withAnimation(Theme.Shimmer.pulseAnimation) { pulsing = true }
            }
    }
}

extension View {
    /// - Parameter active: pass `false` to render the shimmer surface without
    ///   the sweep (e.g. a static specimen or when the parent isn't currently busy).
    func shimmerSweep(active: Bool = true) -> some View {
        modifier(ShimmerSweep(active: active))
    }

    func beaconPulse(active: Bool = true) -> some View {
        modifier(BeaconPulse(active: active))
    }
}

private extension Color {
    /// sRGB channel lerp toward black — used for `--shimmer-soft`'s
    /// `color-mix(in oklab, shimmer-blue 90%, black)` start stop.
    func blended(towardBlack amount: CGFloat) -> Color {
        let ui = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        return Color(red: r * (1 - amount), green: g * (1 - amount), blue: b * (1 - amount))
    }
}
