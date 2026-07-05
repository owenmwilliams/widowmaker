//
//  ProgressBar.swift
//  Nexus Moves
//
//  Native port of design/components/feedback/ProgressBar.{jsx,d.ts,prompt.md} —
//  inventory readiness. Fill uses the signature shimmer — one of the three
//  places shimmer is allowed (COMMON.md restraint list): here, the assistant
//  avatar, and one hero CTA per screen.
//

import SwiftUI

struct NexusProgressBar: View {
    /// 0...100.
    var value: Double = 0
    var label: String? = nil
    var showPercent: Bool = true
    var height: CGFloat = 10
    var sweep: Bool = true

    private var pct: Double { max(0, min(100, value)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if label != nil || showPercent {
                HStack(alignment: .lastTextBaseline) {
                    if let label {
                        Text(label)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(Theme.textPrimary)
                            .nexusTracking(Theme.Tracking.title, size: 17)
                    }
                    Spacer(minLength: 8)
                    if showPercent {
                        Text("\(Int(pct.rounded()))%")
                            .font(Theme.Typography.mono(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surfaceHover)
                    Capsule()
                        .fill(Theme.Shimmer.gradient)
                        .frame(width: geo.size.width * pct / 100)
                        .shimmerSweep(active: sweep && pct > 0 && pct < 100)
                        .animation(.timingCurve(0.22, 0.61, 0.36, 1, duration: Theme.Motion.durSlow), value: pct)
                }
            }
            .frame(height: height)
        }
    }
}
