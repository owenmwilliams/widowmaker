//
//  Theme.swift
//  Nexus Moves
//
//  Generated design-token layer over design/tokens/tokens.json (see
//  design/briefs/COMMON.md and design/briefs/ios.md). This is the ONE place
//  token hex values are transcribed — feature code must consume these
//  semantic names only, never raw hex/ramps/literals. Any token change
//  happens in tokens.json first, then here; never fork a value.
//
//  Dark is the default appearance (design/briefs/ios.md §1); light is a real,
//  fully-specified second theme, not an afterthought — both resolve via the
//  dynamic colors below and are correct at every call site.
//

import SwiftUI
import UIKit

enum Theme {

    // MARK: - Raw ramps (tokens.json base palette — private; alias only below)

    private enum Ramp {
        static let blue400 = "#6E82F4"
        static let blue500 = "#4F5BF0"
        static let blue600 = "#3D45D9"
        static let blue700 = "#2F35B4"

        static let green400 = "#43D98A"
        static let green500 = "#2FB878"
        static let green600 = "#1F9A62"

        static let amber400 = "#E8A54B"
        static let amber500 = "#D98A2B"
        static let amberCream = "#FBF0D9"
        static let amberInk = "#7A5A1E"

        static let red400 = "#F0666B"
        static let red500 = "#E5484D"
        static let red600 = "#C93B40"

        static let beacon500 = "#F98D5B"

        // Neutrals — dark (warm-cool near-black)
        static let dBg = "#0B0B0F"
        static let dSurface1 = "#151519"
        static let dSurface2 = "#1C1C22"
        static let dCard = "#26262C"
        static let dCard2 = "#2E2E36"
        static let dLine = "#33333D"
        static let dLineSoft = "#26262E"
        static let dText1 = "#F5F6FA"
        static let dText2 = "#A2A2AE"
        static let dText3 = "#6E6E7A"

        // Neutrals — light (cool whites)
        static let lBg = "#F4F6FB"
        static let lSurface1 = "#FFFFFF"
        static let lSurface2 = "#FBFCFE"
        static let lCard = "#FFFFFF"
        static let lCard2 = "#F1F4FA"
        static let lLine = "#E4E8F1"
        static let lLineSoft = "#EEF1F7"
        static let lText1 = "#16204A"
        static let lText2 = "#5A6379"
        static let lText3 = "#8A92A6"
    }

    // MARK: - Navy ink ramp (public — headings/wordmark on light; brand element, not a semantic alias)

    enum Navy {
        static let ink500 = Color(hex: "#24346E")
        static let ink600 = Color(hex: "#1C2A5C")
        static let ink700 = Color(hex: "#152A5E")
        static let ink800 = Color(hex: "#101F49")
        static let ink900 = Color(hex: "#0B1533")
    }

    /// Always-light neutral fill (`--l-card-2`), theme-invariant by design —
    /// `ItemCard`'s icon badge stays light in both themes (a consistent
    /// "tag/sticker" look), unlike everything else which flips with scheme.
    static let lightChipFill = Color(hex: Ramp.lCard2)

    // MARK: - Semantic colors — surfaces

    static let bg = Color(dark: Ramp.dBg, light: Ramp.lBg)
    static let surface = Color(dark: Ramp.dSurface1, light: Ramp.lSurface1)
    static let surfaceSunk = Color(dark: Ramp.dSurface2, light: Ramp.lSurface2)
    static let surfaceCard = Color(dark: Ramp.dCard, light: Ramp.lCard)
    static let surfaceHover = Color(dark: Ramp.dCard2, light: Ramp.lCard2)
    static let border = Color(dark: Ramp.dLine, light: Ramp.lLine)
    static let borderSoft = Color(dark: Ramp.dLineSoft, light: Ramp.lLineSoft)

    // MARK: - Semantic colors — text

    static let textPrimary = Color(dark: Ramp.dText1, light: Ramp.lText1)
    static let textSecondary = Color(dark: Ramp.dText2, light: Ramp.lText2)
    static let textTertiary = Color(dark: Ramp.dText3, light: Ramp.lText3)
    /// Text/icon color drawn on top of a filled `accent` surface — same both themes.
    static let textOnAccent = Color.white

    // MARK: - Semantic colors — accent (Nexus Blue; identical both themes)

    static let accent = Color(hex: Ramp.blue500)
    static let accentHover = Color(dark: Ramp.blue400, light: Ramp.blue600)
    static let accentPress = Color(dark: Ramp.blue600, light: Ramp.blue700)
    /// Quiet accent fill (chip/secondary-button backgrounds). Dark = accent at
    /// low alpha over the canvas; light = accent mixed toward opaque white
    /// (tokens.json's light `--accent-quiet` mixes toward white, not
    /// transparent, so it reads as a clean pastel card fill rather than a
    /// wash — see `Color.mix(_:intoWhite:)`).
    static let accentQuiet = Color(
        dark: Color(hex: Ramp.blue500).opacity(0.16),
        light: Color(mix: Ramp.blue500, intoWhite: 0.10)
    )
    static let accentQuiet2 = Color(
        dark: Color(hex: Ramp.blue500).opacity(0.26),
        light: Color(mix: Ramp.blue500, intoWhite: 0.18)
    )
    /// Alias of `accent`; text/icon color drawn on it is `textOnAccent`.
    static let onAccent = Color.white

    // MARK: - Semantic colors — beacon (the one warm spark; reserve it — see COMMON.md restraint list)

    static let beacon = Color(hex: Ramp.beacon500)

    // MARK: - Semantic colors — status

    static let success = Color(dark: Ramp.green400, light: Ramp.green600)
    static let successQuiet = Color(
        dark: Color(hex: Ramp.green500).opacity(0.18),
        light: Color(hex: "#E4F7EE")
    )
    static let warning = Color(dark: Ramp.amber400, light: Ramp.amber500)
    static let warningSurface = Color(dark: "#2C2410", light: Ramp.amberCream)
    static let warningInk = Color(dark: "#F2D79A", light: Ramp.amberInk)
    static let danger = Color(dark: Ramp.red400, light: Ramp.red500)
    static let dangerQuiet = Color(
        dark: Color(hex: Ramp.red500).opacity(0.18),
        light: Color(hex: "#FBE7E8")
    )

    // MARK: - Semantic colors — chat bubbles

    /// User (self) bubble is solid `accent` on mobile (desktop uses shimmer — not us).
    static let bubbleSelf = accent
    static let bubbleSelfText = Color.white
    static let bubbleOther = Color(dark: Ramp.dCard, light: Ramp.lCard2)
    static let bubbleOtherText = textPrimary

    // MARK: - Spacing (4px grid — design/tokens/spacing.css)

    enum Spacing {
        static let sp0: CGFloat = 0
        static let sp1: CGFloat = 2
        static let sp2: CGFloat = 4
        static let sp3: CGFloat = 8
        static let sp4: CGFloat = 12
        static let sp5: CGFloat = 16
        static let sp6: CGFloat = 20
        static let sp7: CGFloat = 24
        static let sp8: CGFloat = 32
        static let sp9: CGFloat = 40
        static let sp10: CGFloat = 48
        static let sp11: CGFloat = 64
        static let sp12: CGFloat = 80
        static let sp13: CGFloat = 96
    }

    // MARK: - Radii (never sharp corners)

    enum Radius {
        static let xs: CGFloat = 8
        static let sm: CGFloat = 10
        /// Buttons, inputs.
        static let md: CGFloat = 14
        /// Cards.
        static let lg: CGFloat = 18
        /// Chat bubbles, panels.
        static let xl: CGFloat = 22
        /// Sheets, app-icon squircle. (tokens.json `--r-2xl`.)
        static let xxl: CGFloat = 28
        /// Chips / pills.
        static let pill: CGFloat = 999
    }

    // MARK: - Layout & interaction constants

    /// Minimum hit target (`--tap-min`).
    static let tapMin: CGFloat = 44
    /// Mobile design column width (`--app-max`); mostly a web/desktop cap.
    static let appMax: CGFloat = 430
    /// Press-state scale for tappable controls (COMMON.md Definition of Done).
    static let pressScale: CGFloat = 0.97
    /// Disabled-state opacity for controls.
    static let disabledOpacity: Double = 0.45
    /// Focus ring stroke width (`--focus-ring`); color is `accent` at 45%.
    static let focusRingWidth: CGFloat = 3
    static let focusRingColor = accent.opacity(0.45)

    // MARK: - Motion (design/tokens/effects.css)

    enum Motion {
        static let durFast: Double = 0.12
        static let durBase: Double = 0.22
        static let durSlow: Double = 0.38
        static let shimmerSweepDuration: Double = 2.2

        /// `cubic-bezier(.22,.61,.36,1)` — the standard, calm ease.
        static let easeStandard = Animation.timingCurve(0.22, 0.61, 0.36, 1, duration: durBase)
        /// `cubic-bezier(.34,1.32,.64,1)` — gentle overshoot for arrivals/confirmations ONLY.
        static let easeEmphasis = Animation.timingCurve(0.34, 1.32, 0.64, 1, duration: durBase)
    }
}

// MARK: - Dynamic color construction

extension Color {
    /// A color that resolves differently per current trait environment,
    /// mirroring a tokens.json dark/light semantic pair. Reactive to system
    /// appearance changes and to `.preferredColorScheme` overrides.
    init(dark: Color, light: Color) {
        self = Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
        })
    }

    init(dark darkHex: String, light lightHex: String) {
        self.init(dark: Color(hex: darkHex), light: Color(hex: lightHex))
    }

    /// `#RRGGBB` (or `#RGB`) literal — used ONLY inside the theme layer to
    /// transcribe tokens.json; feature code must never call this directly.
    init(hex: String) {
        self = Color(UIColor(hex: hex))
    }

    /// Approximates tokens.json's light-theme `color-mix(in oklab, X amount%, white)`
    /// quiet fills via an sRGB channel lerp toward white (oklab would be more
    /// perceptually even, but the difference is negligible at these low mix
    /// amounts for a sparingly-used pastel tint).
    init(mix hex: String, intoWhite amount: CGFloat) {
        self = Color(UIColor.mix(hex, intoWhite: amount))
    }
}

private extension UIColor {
    convenience init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        s.removeAll { $0 == "#" }
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        self.init(
            red: CGFloat((v >> 16) & 0xFF) / 255,
            green: CGFloat((v >> 8) & 0xFF) / 255,
            blue: CGFloat(v & 0xFF) / 255,
            alpha: 1
        )
    }

    static func mix(_ hex: String, intoWhite amount: CGFloat) -> UIColor {
        let c = UIColor(hex: hex)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        return UIColor(
            red: 1 + (r - 1) * amount,
            green: 1 + (g - 1) * amount,
            blue: 1 + (b - 1) * amount,
            alpha: 1
        )
    }
}
