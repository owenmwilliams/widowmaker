//
//  Banner.swift
//  Nexus Moves
//
//  Native port of design/components/feedback/Banner.{jsx,d.ts,prompt.md} —
//  inline callout for honest nudges, confirmations, and alerts.
//

import SwiftUI

enum NexusBannerTone { case warning, success, info, danger }

struct NexusBanner: View {
    var tone: NexusBannerTone = .warning
    var icon: Image? = nil
    var title: String? = nil
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            (icon ?? Image(systemName: "exclamationmark.triangle"))
                .resizable().scaledToFit()
                .frame(width: 22, height: 22)
                .foregroundStyle(iconColor)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                if let title {
                    Text(title).font(.system(size: 15, weight: .bold))
                }
                Text(text)
            }
        }
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(textColor)
        .padding(.horizontal, 17)
        .padding(.vertical, 15)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
    }

    private var background: Color {
        switch tone {
        case .warning: Theme.warningSurface
        case .success: Theme.successQuiet
        case .info: Theme.accentQuiet
        case .danger: Theme.dangerQuiet
        }
    }
    private var textColor: Color {
        switch tone {
        case .warning: Theme.warningInk
        case .success: Theme.success
        case .info: Theme.accent
        case .danger: Theme.danger
        }
    }
    // warning's icon and text colors genuinely differ in the source (icon
    // uses the amber accent; body text uses the darker, more readable ink,
    // matching what ReadinessSheet's own warning card already did to avoid a
    // "white on white" read in dark mode). Every other tone reuses its color.
    private var iconColor: Color {
        switch tone {
        case .warning: Theme.warning
        case .success: Theme.success
        case .info: Theme.accent
        case .danger: Theme.danger
        }
    }
}
