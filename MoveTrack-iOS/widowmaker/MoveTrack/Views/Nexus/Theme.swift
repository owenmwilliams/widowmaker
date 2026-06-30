//
//  Theme.swift
//  Nexus Moves
//
//  A small design system so the app looks fresh, clean and consistent: one brand
//  color, a few semantic colors, spacing, radii, and reusable button styles.
//

import SwiftUI

enum Theme {
    // Brand
    static let brand = Color(red: 0.357, green: 0.357, blue: 0.851)     // #5B5BD9 indigo
    static let brandDeep = Color(red: 0.286, green: 0.275, blue: 0.769) // pressed/gradient end
    static let brandSoft = brand.opacity(0.12)

    // Surfaces
    static let canvas = Color(.systemGroupedBackground)
    static let card = Color(.secondarySystemGroupedBackground)
    static let modelBubble = Color(.secondarySystemGroupedBackground)

    // Semantic
    static let warn = Color(red: 0.83, green: 0.52, blue: 0.0)
    static let warnSoft = Color(red: 1.0, green: 0.97, blue: 0.92)
    static let danger = Color(red: 0.78, green: 0.13, blue: 0.16)
    static let good = Color(red: 0.13, green: 0.62, blue: 0.40)

    // Geometry
    static let bubbleRadius: CGFloat = 20
    static let cardRadius: CGFloat = 18
    static let controlRadius: CGFloat = 14

    static let brandGradient = LinearGradient(
        colors: [brand, brandDeep],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
}

/// Filled brand button (primary CTA).
struct PrimaryButtonStyle: ButtonStyle {
    var enabled: Bool = true
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(enabled ? AnyShapeStyle(Theme.brandGradient) : AnyShapeStyle(Color.gray.opacity(0.4)))
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// Outlined/tinted secondary button.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(Theme.brandSoft)
            .foregroundStyle(Theme.brand)
            .clipShape(RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
            .opacity(configuration.isPressed ? 0.7 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
