//
//  ItemsViewModel.swift
//  Nexus Moves
//
//  Created on 2025-12-26.
//

import Foundation
import SwiftUI
import UIKit

@MainActor
class ItemsViewModel: ObservableObject {
    @Published var items: [Item] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let userId: UUID
    private let collectionId: Int
    private let containerId: Int?

    init(userId: UUID, collectionId: Int, containerId: Int? = nil) {
        self.userId = userId
        self.collectionId = collectionId
        self.containerId = containerId
    }

    // MARK: - Load Items
    func loadItems() async {
        isLoading = true
        errorMessage = nil

        do {
            items = try await InventoryService.shared.getItems(
                userId: userId.uuidString,
                collectionId: collectionId,
                containerId: containerId
            )
            print("✅ Loaded \(items.count) items")
        } catch {
            errorMessage = error.localizedDescription
            print("❌ Error loading items: \(error)")
        }

        isLoading = false
    }

    // MARK: - Create Item
    func createItem(
        name: String,
        description: String?,
        quantity: Int?,
        pictureUrl: String? = nil,
        estimatedValue: Double? = nil,
        fragile: Bool = false
    ) async -> Bool {
        isLoading = true
        errorMessage = nil

        let request = CreateItemRequest(
            userId: userId,
            collectionId: collectionId,
            containerId: containerId,
            name: name,
            description: description,
            quantity: quantity,
            pictureUrl: pictureUrl,
            estimatedValue: estimatedValue,
            fragile: fragile
        )

        do {
            let newItem = try await InventoryService.shared.createItem(request)
            items.insert(newItem, at: 0) // Add to beginning of list
            print("✅ Created item: \(newItem.name)")
            isLoading = false
            return true
        } catch {
            errorMessage = error.localizedDescription
            print("❌ Error creating item: \(error)")
            isLoading = false
            return false
        }
    }

    // MARK: - Refresh
    func refresh() async {
        await loadItems()
    }
}
