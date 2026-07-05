//
//  Theme+Typography.swift
//  Nexus Moves
//
//  Type scale from design/tokens/typography.css. UI text uses system SF,
//  mapped to the nearest Dynamic Type text style so it scales with the user's
//  preferred text size (design/briefs/ios.md §1) — sizes below are FLOORS at
//  the system default category, never hard-locked px.
//

import SwiftUI
import UIKit

extension Theme {
    enum Typography {
        // Display (56/44/34) — Bricolage Grotesque is SKIPPED for v1 per
        // design/briefs/ios.md §1; system bold stands in. Rare on this
        // surface (marketing/display-only) — displayM is the one sheet
        // numeral ("In progress") the mobile kit actually uses.
        static func displayXL(weight: Font.Weight = .bold) -> Font { scaled(56, weight, .largeTitle) }
        static func displayL(weight: Font.Weight = .bold) -> Font { scaled(44, weight, .largeTitle) }
        static func displayM(weight: Font.Weight = .bold) -> Font { scaled(34, weight, .largeTitle) }

        static func titleL(weight: Font.Weight = .bold) -> Font { scaled(28, weight, .title1) }
        /// Card / section headers ("Nexus Moves").
        static func titleM(weight: Font.Weight = .bold) -> Font { scaled(22, weight, .title2) }
        static func titleS(weight: Font.Weight = .semibold) -> Font { scaled(18, weight, .title3) }

        /// Chat body — floor is 17pt, never smaller.
        static func chatBody(weight: Font.Weight = .regular) -> Font { scaled(17, weight, .body) }
        /// Default UI body — floor is 15pt, never smaller.
        static func body(weight: Font.Weight = .regular) -> Font { scaled(15, weight, .subheadline) }
        /// Captions, meta.
        static func label(weight: Font.Weight = .medium) -> Font { scaled(13, weight, .footnote) }
        /// Eyebrows, status-bar-adjacent micro copy.
        static func micro(weight: Font.Weight = .semibold) -> Font { scaled(11, weight, .caption2) }

        /// JetBrains Mono — eyebrows and data readouts (weights/volumes).
        /// Bundled as `MoveTrack/Fonts/*.ttf` + `UIAppFonts` (design/assets/fonts,
        /// merged #82). Falls back to the system monospaced face if the
        /// PostScript name doesn't resolve — e.g. a `UIAppFonts` entry drops
        /// out of sync with the bundled filenames, which fails SILENTLY
        /// (no crash, no console error), so this must be confirmed by eye,
        /// not just by compiling.
        static func mono(size: CGFloat, weight: Font.Weight = .regular) -> Font {
            let postscriptName: String
            switch weight {
            case .medium, .semibold: postscriptName = "JetBrainsMono-Medium"
            case .bold, .heavy, .black: postscriptName = "JetBrainsMono-Bold"
            default: postscriptName = "JetBrainsMono-Regular"
            }
            guard let custom = UIFont(name: postscriptName, size: size) else {
                return .system(size: size, weight: weight, design: .monospaced)
            }
            return scaledFont(custom, relativeTo: .body)
        }

        private static func scaled(_ size: CGFloat, _ weight: Font.Weight, _ style: UIFont.TextStyle) -> Font {
            scaledFont(UIFont.systemFont(ofSize: size, weight: weight.uiWeight), relativeTo: style)
        }

        private static func scaledFont(_ base: UIFont, relativeTo style: UIFont.TextStyle) -> Font {
            Font(UIFontMetrics(forTextStyle: style).scaledFont(for: base))
        }
    }

    /// Tracking (letter-spacing) multipliers — em-relative; use with
    /// `.nexusTracking(_:size:)` since SwiftUI's `.tracking` takes points.
    enum Tracking {
        static let display: CGFloat = -0.02
        static let title: CGFloat = -0.01
        static let body: CGFloat = 0
        static let eyebrow: CGFloat = 0.14
    }

    /// Line-height multipliers (`--lh-*`) — reference only; SwiftUI's
    /// `.lineSpacing` takes additional points, not a multiplier, so a
    /// component applying this converts per its own font size.
    enum LineHeight {
        static let tight: CGFloat = 1.08
        static let snug: CGFloat = 1.25
        static let body: CGFloat = 1.45
        static let loose: CGFloat = 1.6
    }
}

extension View {
    /// Applies an em-relative tracking token (`Theme.Tracking.*`) at a given point size.
    func nexusTracking(_ emMultiplier: CGFloat, size: CGFloat) -> some View {
        tracking(emMultiplier * size)
    }
}

private extension Font.Weight {
    var uiWeight: UIFont.Weight {
        switch self {
        case .black: return .black
        case .heavy: return .heavy
        case .bold: return .bold
        case .semibold: return .semibold
        case .medium: return .medium
        case .light: return .light
        case .thin: return .thin
        case .ultraLight: return .ultraLight
        default: return .regular
        }
    }
}
