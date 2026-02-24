//
//  LocationsViewModel.swift
//  MoveTrack
//
//  Created on 2025-12-26.
//

import Foundation
import SwiftUI
import Combine

@MainActor
class LocationsViewModel: ObservableObject {
    @Published var locations: [Location] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let userId: UUID

    init(userId: UUID) {
        self.userId = userId
    }

    // MARK: - Load Locations
    func loadLocations() async {
        isLoading = true
        errorMessage = nil

        do {
            locations = try await InventoryService.shared.getLocations(userId: userId.uuidString)
            print("✅ Loaded \(locations.count) locations")
        } catch {
            errorMessage = error.localizedDescription
            print("❌ Error loading locations: \(error)")
        }

        isLoading = false
    }

    // MARK: - Refresh
    func refresh() async {
        await loadLocations()
    }
}
