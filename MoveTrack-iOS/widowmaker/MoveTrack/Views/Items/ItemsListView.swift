//
//  ItemsListView.swift
//  MoveTrack
//
//  Created on 2025-12-26.
//

import SwiftUI

struct ItemsListView: View {
    @StateObject private var viewModel: ItemsViewModel
    @State private var showAddItem = false

    let collectionName: String

    init(userId: UUID, collectionId: Int, collectionName: String, containerId: Int? = nil) {
        _viewModel = StateObject(wrappedValue: ItemsViewModel(
            userId: userId,
            collectionId: collectionId,
            containerId: containerId
        ))
        self.collectionName = collectionName
    }

    var body: some View {
        ZStack {
            if viewModel.isLoading && viewModel.items.isEmpty {
                ProgressView("Loading items...")
            } else if viewModel.items.isEmpty {
                EmptyStateView(
                    icon: "shippingbox.fill",
                    title: "No Items Yet",
                    message: "Add an item to start building your inventory"
                )
            } else {
                itemsList
            }
        }
        .navigationTitle(collectionName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: { showAddItem = true }) {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showAddItem) {
            AddItemView(viewModel: viewModel)
        }
        .task {
            await viewModel.loadItems()
        }
        .refreshable {
            await viewModel.refresh()
        }
    }

    // MARK: - Items List
    private var itemsList: some View {
        List(viewModel.items) { item in
            NavigationLink(destination: ItemDetailView(item: item)) {
                ItemRow(item: item)
            }
        }
        .listStyle(.insetGrouped)
    }
}

// MARK: - Item Row
struct ItemRow: View {
    let item: Item

    var body: some View {
        HStack(spacing: 12) {
            // Thumbnail
            if let pictureUrl = item.pictureUrl {
                AsyncImage(url: URL(string: pictureUrl)) { phase in
                    switch phase {
                    case .empty:
                        ProgressView()
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    case .failure:
                        Image(systemName: "photo")
                            .foregroundColor(.gray)
                    @unknown default:
                        EmptyView()
                    }
                }
                .frame(width: Constants.thumbnailSize, height: Constants.thumbnailSize)
                .background(Color(.systemGray6))
                .cornerRadius(8)
            } else {
                Image(systemName: "shippingbox.fill")
                    .font(.title2)
                    .foregroundColor(.gray)
                    .frame(width: Constants.thumbnailSize, height: Constants.thumbnailSize)
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
            }

            // Item Details
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    if !item.quantityDisplay.isEmpty {
                        Text(item.quantityDisplay)
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(.blue)
                    }

                    Text(item.name)
                        .font(.headline)
                        .lineLimit(1)

                    Spacer()

                    if item.isFragile {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }

                if let description = item.description, !description.isEmpty {
                    Text(description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }

                if let value = item.valueDisplay {
                    Text(value)
                        .font(.caption)
                        .foregroundColor(.green)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    NavigationView {
        ItemsListView(userId: UUID(), collectionId: 1, collectionName: "Living Room")
    }
}
