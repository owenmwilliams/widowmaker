//
//  CollectionsListView.swift
//  Nexus Moves
//
//  Created on 2025-12-26.
//

import SwiftUI

struct CollectionsListView: View {
    @StateObject private var viewModel: CollectionsViewModel
    @EnvironmentObject var authViewModel: AuthViewModel

    let locationName: String

    init(userId: UUID, locationId: Int, locationName: String) {
        _viewModel = StateObject(wrappedValue: CollectionsViewModel(userId: userId, locationId: locationId))
        self.locationName = locationName
    }

    var body: some View {
        ZStack {
            if viewModel.isLoading && viewModel.collections.isEmpty {
                ProgressView("Loading rooms...")
            } else if viewModel.collections.isEmpty {
                EmptyStateView(
                    icon: "square.grid.2x2.fill",
                    title: "No Rooms Yet",
                    message: "Add a room or category to organize your items"
                )
            } else {
                collectionsList
            }
        }
        .navigationTitle(locationName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: { /* TODO: Add collection */ }) {
                    Image(systemName: "plus")
                }
            }
        }
        .task {
            await viewModel.loadCollections()
        }
        .refreshable {
            await viewModel.refresh()
        }
    }

    // MARK: - Collections List
    private var collectionsList: some View {
        List(viewModel.collections) { collection in
            NavigationLink(
                destination: ItemsListView(
                    userId: authViewModel.currentUser!.id,
                    collectionId: collection.id,
                    collectionName: collection.name
                )
            ) {
                CollectionRow(collection: collection)
            }
        }
        .listStyle(.insetGrouped)
    }
}

// MARK: - Collection Row
struct CollectionRow: View {
    let collection: Collection

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                // Color indicator
                if let colorCode = collection.colorCode, !colorCode.isEmpty {
                    Circle()
                        .fill(Color(hex: colorCode) ?? .blue)
                        .frame(width: 12, height: 12)
                }

                Text(collection.name)
                    .font(.headline)

                Spacer()

                if let itemCount = collection.itemCount {
                    Text("\(itemCount)")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.blue)
                        .cornerRadius(12)
                }
            }

            if let description = collection.description, !description.isEmpty {
                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }

            Text(collection.countSummary)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Color Extension
extension Color {
    init?(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            return nil
        }

        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue:  Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

#Preview {
    NavigationView {
        CollectionsListView(userId: UUID(), locationId: 1, locationName: "Home")
            .environmentObject(AuthViewModel())
    }
}
