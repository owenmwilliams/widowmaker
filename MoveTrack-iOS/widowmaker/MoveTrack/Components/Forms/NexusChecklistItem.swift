//
//  NexusChecklistItem.swift
//  Nexus Moves
//
//  Native port of design/components/forms/ChecklistItem.{jsx,d.ts,prompt.md} —
//  a "Next steps" row with an accent ring / filled check. `checked` is a
//  controlled prop and `onToggle` is just "what happens when you tap this
//  row" — callers that need tap-to-act instead of tap-to-toggle (e.g.
//  ReadinessSheet's Next Steps, which dismiss-and-send rather than check
//  anything off) can pass `checked: false` always and their own action.
//

import SwiftUI

struct NexusChecklistItem: View {
    let label: String
    var checked: Bool = false
    var onToggle: (() -> Void)? = nil

    var body: some View {
        Button {
            onToggle?()
        } label: {
            HStack(alignment: .top, spacing: 14) {
                ring
                Text(label)
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(checked ? Theme.textTertiary : Theme.textPrimary)
                    .strikethrough(checked)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var ring: some View {
        ZStack {
            Circle().fill(checked ? Theme.accent : Color.clear)
            Circle().stroke(checked ? Color.clear : Theme.accent, lineWidth: 2)
            if checked {
                Image(systemName: "checkmark")
                    .resizable().scaledToFit()
                    .fontWeight(.heavy)
                    .foregroundStyle(.white)
                    .frame(width: 10, height: 10)
            }
        }
        .frame(width: 24, height: 24)
        .padding(.top, 1)
    }
}
