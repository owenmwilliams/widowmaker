//
//  NexusInput.swift
//  Nexus Moves
//
//  Native port of design/components/forms/Input.{jsx,d.ts,prompt.md} — two
//  shapes: a labeled form field, and the rounded chat composer bar.
//

import SwiftUI

enum NexusInputVariant {
    /// Labeled form field.
    case field
    /// The rounded chat message bar.
    case composer
}

struct NexusInput: View {
    var variant: NexusInputVariant = .field
    var label: String? = nil
    var placeholder: String = ""
    @Binding var text: String
    /// Composer grows within this line range (matches the current composer's
    /// `axis: .vertical` + `1...5` behavior); nil keeps a single line.
    var lineLimit: ClosedRange<Int>? = nil
    var disabled: Bool = false
    /// e.g. a search glyph. Type-erased since callers occasionally need a
    /// real control here (the trailing send `NexusIconButton`), not just an Image.
    var leading: AnyView? = nil
    var trailing: AnyView? = nil

    @FocusState private var focused: Bool
    private var isComposer: Bool { variant == .composer }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let label {
                Text(label)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            HStack(spacing: 10) {
                leading?.foregroundStyle(Theme.textTertiary).frame(width: 20, height: 20)
                field
                    .focused($focused)
                    .font(isComposer ? Theme.Typography.chatBody() : Theme.Typography.body())
                    .foregroundStyle(Theme.textPrimary)
                    .disabled(disabled)
                trailing
            }
            .padding(.horizontal, isComposer ? 18 : 14)
            .frame(minHeight: isComposer ? 52 : 48)
            .background(isComposer ? Theme.surfaceCard : Theme.surface)
            .clipShape(shape)
            .overlay {
                if !isComposer {
                    shape.stroke(focused ? Theme.accent : Theme.border, lineWidth: 1.5)
                }
            }
            .opacity(disabled ? 0.5 : 1)
        }
    }

    @ViewBuilder private var field: some View {
        if let lineLimit {
            TextField(placeholder, text: $text, axis: .vertical).lineLimit(lineLimit)
        } else {
            TextField(placeholder, text: $text)
        }
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: isComposer ? Theme.Radius.pill : Theme.Radius.md, style: .continuous)
    }
}
