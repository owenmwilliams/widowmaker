//
//  CollectionsViewModel.swift
//  MoveTrack
//
//  Created on 2025-12-26.
//

import Foundation
import SwiftUI

@MainActor
class CollectionsViewModel: ObservableObject {
    @Published var collections: [Collection] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let userId: UUID
    private let locationId: Int

    init(userId: UUID, locationId: Int) {
        self.userId = userId
        self.locationId = locationId
    }

    // MARK: - Load Collections
    func loadCollections() async {
        isLoading = true
        errorMessage = nil

        do {
            collections = try await InventoryService.shared.getCollections(
                userId: userId.uuidString,
                locationId: locationId
            )
            print("✅ Loaded \(collections.count) collections")
        } catch {
            errorMessage = error.localizedDescription
            print("❌ Error loading collections: \(error)")
        }

        isLoading = false
    }

    // MARK: - Refresh
    func refresh() async {
        await loadCollections()
    }
}
