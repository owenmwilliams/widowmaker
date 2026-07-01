//
//  ReviewSheets.swift
//  Nexus Moves
//
//  Interactive review surfaces that replace typing back to the agent:
//   • ReviewItemsSheet — after a photo/video scan, the user edits names/quantities
//     and checks/unchecks each detected item, then adds them in one tap.
//   • DuplicateReviewSheet — resolve potential duplicates by keeping one, the other,
//     or both, per pair.
//
//  Both commit directly to the backend (no LLM re-interpretation), so a 40-item
//  scan reviews cleanly instead of scrolling walls of chat buttons.
//

import SwiftUI

// MARK: - Detected items review

struct ReviewItemsSheet: View {
    let review: DetectedItemsReview
    let onCommit: ([DetectedItem]) -> Void
    let onCancel: () -> Void

    @State private var items: [DetectedItem]

    init(review: DetectedItemsReview,
         onCommit: @escaping ([DetectedItem]) -> Void,
         onCancel: @escaping () -> Void) {
        self.review = review
        self.onCommit = onCommit
        self.onCancel = onCancel
        _items = State(initialValue: review.items)
    }

    private var keptCount: Int {
        items.filter { $0.keep && !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.count
    }

    private var headerTitle: String {
        let roomBit = review.room.map { " in the \($0)" } ?? ""
        return "\(items.count) item\(items.count == 1 ? "" : "s") found\(roomBit)"
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach($items) { $item in
                        ReviewRow(item: $item)
                    }
                } header: {
                    Text("Tap the circle to drop anything that's wrong. Edit names and quantities inline.")
                        .textCase(nil)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(headerTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onCancel() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    onCommit(items)
                } label: {
                    Text(keptCount == 0 ? "Select at least one" : "Add \(keptCount) item\(keptCount == 1 ? "" : "s")")
                }
                .buttonStyle(PrimaryButtonStyle(enabled: keptCount > 0))
                .disabled(keptCount == 0)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 10)
                .background(.regularMaterial)
            }
        }
    }
}

private struct ReviewRow: View {
    @Binding var item: DetectedItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button { item.keep.toggle() } label: {
                Image(systemName: item.keep ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(item.keep ? Theme.brand : Color.secondary)
            }
            .buttonStyle(.plain)
            .padding(.top, 2)

            thumbnail

            // Name gets the full remaining width (no more "Box of Boo…" truncation);
            // the spec sits on one line and the stepper on its own line below.
            VStack(alignment: .leading, spacing: 6) {
                TextField("Item name", text: $item.name)
                    .font(.body)
                    .lineLimit(1)
                    .textInputAutocapitalization(.words)

                HStack(spacing: 6) {
                    if let spec = item.specLine {
                        Text(spec).lineLimit(1)
                    }
                    if item.fragile {
                        Text("Fragile")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.warn)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Theme.warn.opacity(0.15))
                            .clipShape(Capsule())
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    Text("Qty").font(.caption).foregroundStyle(.secondary)
                    Text("×\(item.quantity)")
                        .font(.subheadline.weight(.semibold))
                        .monospacedDigit()
                    Stepper("", value: $item.quantity, in: 1...99)
                        .labelsHidden()
                    Spacer(minLength: 0)
                }
            }
        }
        .opacity(item.keep ? 1 : 0.4)
    }

    @ViewBuilder private var thumbnail: some View {
        Group {
            if let s = item.pictureUrl, let url = URL(string: s) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFill()
                    default: placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(Theme.brandSoft)
            .overlay(Image(systemName: "shippingbox.fill").font(.system(size: 15)).foregroundStyle(Theme.brand.opacity(0.6)))
    }
}

// MARK: - Duplicate review

struct DuplicateReviewSheet: View {
    let review: DuplicateReview
    let onApply: ([Int]) -> Void
    let onCancel: () -> Void

    enum Choice { case keepA, keepB, both }

    @State private var choices: [UUID: Choice]

    init(review: DuplicateReview,
         onApply: @escaping ([Int]) -> Void,
         onCancel: @escaping () -> Void) {
        self.review = review
        self.onApply = onApply
        self.onCancel = onCancel
        // Default to the safe choice: keep both (removes nothing) until the user decides.
        _choices = State(initialValue: Dictionary(uniqueKeysWithValues: review.pairs.map { ($0.id, Choice.both) }))
    }

    private var removeItemIds: [Int] {
        review.pairs.compactMap { pair -> Int? in
            switch choices[pair.id] ?? .both {
            case .keepA: return pair.itemB.id
            case .keepB: return pair.itemA.id
            case .both:  return nil
            }
        }.filter { $0 > 0 }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(review.pairs) { pair in
                        DuplicateRow(
                            pair: pair,
                            choice: Binding(
                                get: { choices[pair.id] ?? .both },
                                set: { choices[pair.id] = $0 }
                            )
                        )
                    }
                } header: {
                    Text("These look similar. Keep one, the other, or both.")
                        .textCase(nil)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("\(review.pairs.count) possible duplicate\(review.pairs.count == 1 ? "" : "s")")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Skip") { onCancel() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    onApply(removeItemIds)
                } label: {
                    Text(removeItemIds.isEmpty ? "Keep everything" : "Remove \(removeItemIds.count)")
                }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 10)
                .background(.regularMaterial)
            }
        }
    }
}

private struct DuplicateRow: View {
    let pair: DuplicatePair
    @Binding var choice: DuplicateReviewSheet.Choice

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let s = pair.similarity {
                Text("\(Int(s))% match")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.brand)
            }
            itemLine("A", pair.itemA)
            itemLine("B", pair.itemB)
            Picker("", selection: $choice) {
                Text("Keep A").tag(DuplicateReviewSheet.Choice.keepA)
                Text("Keep B").tag(DuplicateReviewSheet.Choice.keepB)
                Text("Keep both").tag(DuplicateReviewSheet.Choice.both)
            }
            .pickerStyle(.segmented)
        }
        .padding(.vertical, 4)
    }

    private func itemLine(_ tag: String, _ item: DuplicatePair.DupItem) -> some View {
        HStack(spacing: 8) {
            Text(tag)
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 18, height: 18)
                .background(Circle().fill(Theme.brand))
            VStack(alignment: .leading, spacing: 1) {
                Text(item.name ?? "Item").font(.subheadline.weight(.medium))
                if let room = item.room, !room.isEmpty {
                    Text(room).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if let q = item.quantity, q > 1 {
                Text("×\(q)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
        }
    }
}
