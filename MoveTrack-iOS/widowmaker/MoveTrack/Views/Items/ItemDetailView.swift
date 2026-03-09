//
//  ItemDetailView.swift
//  Nexus Moves
//
//  Created on 2025-12-26.
//

import SwiftUI

struct ItemDetailView: View {
    let item: Item

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Photo
                if let pictureUrl = item.pictureUrl {
                    AsyncImage(url: URL(string: pictureUrl)) { phase in
                        switch phase {
                        case .empty:
                            ProgressView()
                                .frame(height: 300)
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                        case .failure:
                            Image(systemName: "photo")
                                .font(.largeTitle)
                                .foregroundColor(.gray)
                                .frame(height: 300)
                        @unknown default:
                            EmptyView()
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                }

                // Item Name
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(item.name)
                            .font(.title2)
                            .fontWeight(.bold)

                        Spacer()

                        if item.isFragile {
                            HStack {
                                Image(systemName: "exclamationmark.triangle.fill")
                                Text("Fragile")
                                    .font(.caption)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Color.orange.opacity(0.2))
                            .foregroundColor(.orange)
                            .cornerRadius(8)
                        }
                    }

                    if let quantity = item.quantity, quantity > 1 {
                        Text("Quantity: \(quantity)")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }

                // Description
                if let description = item.description, !description.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Description")
                            .font(.headline)

                        Text(description)
                            .font(.body)
                            .foregroundColor(.secondary)
                    }
                }

                // Details Grid
                VStack(alignment: .leading, spacing: 12) {
                    Text("Details")
                        .font(.headline)

                    if let value = item.estimatedValue {
                        DetailRow(label: "Estimated Value", value: String(format: "$%.2f", value))
                    }

                    if let material = item.material {
                        DetailRow(label: "Material", value: material)
                    }

                    if let color = item.primaryColor {
                        DetailRow(label: "Color", value: color)
                    }

                    if let tags = item.tags, !tags.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Tags")
                                .font(.subheadline)
                                .foregroundColor(.secondary)

                            FlowLayout(spacing: 8) {
                                ForEach(tags, id: \.self) { tag in
                                    Text(tag)
                                        .font(.caption)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                        .background(Color.blue.opacity(0.1))
                                        .foregroundColor(.blue)
                                        .cornerRadius(8)
                                }
                            }
                        }
                    }
                }
            }
            .padding()
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Detail Row
struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)

            Spacer()

            Text(value)
                .font(.body)
        }
    }
}

// MARK: - Flow Layout (Tags)
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(
            in: proposal.replacingUnspecifiedDimensions().width,
            subviews: subviews,
            spacing: spacing
        )
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(
            in: bounds.width,
            subviews: subviews,
            spacing: spacing
        )
        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + result.frames[index].minX,
                                     y: bounds.minY + result.frames[index].minY),
                         proposal: .unspecified)
        }
    }

    struct FlowResult {
        var size: CGSize = .zero
        var frames: [CGRect] = []

        init(in maxWidth: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var currentX: CGFloat = 0
            var currentY: CGFloat = 0
            var lineHeight: CGFloat = 0

            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)

                if currentX + size.width > maxWidth && currentX > 0 {
                    currentX = 0
                    currentY += lineHeight + spacing
                    lineHeight = 0
                }

                frames.append(CGRect(x: currentX, y: currentY, width: size.width, height: size.height))
                currentX += size.width + spacing
                lineHeight = max(lineHeight, size.height)
            }

            self.size = CGSize(width: maxWidth, height: currentY + lineHeight)
        }
    }
}

#Preview {
    NavigationView {
        ItemDetailView(item: Item(
            id: 1,
            userId: UUID(),
            collectionId: 1,
            containerId: nil,
            name: "Coffee Table",
            description: "Modern glass coffee table with metal legs",
            quantity: 1,
            pictureUrl: nil,
            estimatedValue: 250.00,
            fragile: true,
            tags: ["furniture", "living room", "glass"],
            material: "Glass and Metal",
            primaryColor: "Clear"
        ))
    }
}
