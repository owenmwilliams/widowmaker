//
//  NexusItemCard.swift
//  Nexus Moves
//
//  Native port of design/components/data/ItemCard.{jsx,d.ts,prompt.md} — a
//  floating "verified item" chip (icon + name + weight). The product's
//  signature proof-of-inventory moment.
//

import SwiftUI

struct NexusItemCard: View {
    var icon: Image? = nil
    let name: String
    /// Secondary line — weight, volume, or count (mono), e.g. "44 lb".
    var meta: String? = nil
    var verified: Bool = true

    var body: some View {
        HStack(spacing: 13) {
            ZStack {
                // Theme-invariant: this badge stays light in both app themes
                // (see Theme.lightChipFill) — matches --l-card-2 + --navy-600
                // in the source exactly, not a dark-mode-reactive surface.
                RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous)
                    .fill(Theme.lightChipFill)
                (icon ?? Image(systemName: "shippingbox"))
                    .resizable().scaledToFit()
                    .foregroundStyle(Theme.Navy.ink600)
                    .frame(width: 24, height: 24)
            }
            .frame(width: 40, height: 40)

            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(name)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    if verified {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.success)
                            .accessibilityLabel("Verified")
                    }
                }
                if let meta {
                    Text(meta)
                        .font(Theme.Typography.mono(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textTertiary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(minWidth: 168, alignment: .leading)
        .background(Theme.surfaceCard)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
        .nexusShadow(Theme.Shadows.md)
    }
}
