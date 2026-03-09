//
//  InventoryService.swift
//  Nexus Moves
//
//  Created on 2025-12-26.
//

import Foundation

class InventoryService {
    static let shared = InventoryService()

    private init() {}

    // MARK: - Locations
    func getLocations(userId: String) async throws -> [Location] {
        let queryItems = [URLQueryItem(name: "user", value: userId)]
        return try await APIClient.shared.get(Constants.Endpoints.locations, queryItems: queryItems)
    }

    func getLocation(userId: String, locationId: Int) async throws -> Location {
        let queryItems = [
            URLQueryItem(name: "user", value: userId),
            URLQueryItem(name: "location", value: String(locationId))
        ]
        let endpoint = "\(Constants.Endpoints.locations)/single"
        return try await APIClient.shared.get(endpoint, queryItems: queryItems)
    }

    // MARK: - Collections
    func getCollections(userId: String, locationId: Int) async throws -> [Collection] {
        let queryItems = [
            URLQueryItem(name: "user", value: userId),
            URLQueryItem(name: "location", value: String(locationId))
        ]
        return try await APIClient.shared.get(Constants.Endpoints.collections, queryItems: queryItems)
    }

    func getCollection(userId: String, collectionId: Int) async throws -> Collection {
        let queryItems = [
            URLQueryItem(name: "user", value: userId),
            URLQueryItem(name: "collection", value: String(collectionId))
        ]
        let endpoint = "\(Constants.Endpoints.collections)/single"
        return try await APIClient.shared.get(endpoint, queryItems: queryItems)
    }

    // MARK: - Containers
    func getContainers(userId: String, collectionId: Int) async throws -> [Container] {
        let queryItems = [
            URLQueryItem(name: "user", value: userId),
            URLQueryItem(name: "collection", value: String(collectionId))
        ]
        return try await APIClient.shared.get(Constants.Endpoints.containers, queryItems: queryItems)
    }

    func getContainer(userId: String, containerId: Int) async throws -> Container {
        let queryItems = [
            URLQueryItem(name: "user", value: userId),
            URLQueryItem(name: "container", value: String(containerId))
        ]
        let endpoint = "\(Constants.Endpoints.containers)/single"
        return try await APIClient.shared.get(endpoint, queryItems: queryItems)
    }

    // MARK: - Items
    func getItems(userId: String, collectionId: Int, containerId: Int? = nil) async throws -> [Item] {
        var queryItems = [
            URLQueryItem(name: "user", value: userId),
            URLQueryItem(name: "collection", value: String(collectionId))
        ]

        if let containerId = containerId {
            queryItems.append(URLQueryItem(name: "container", value: String(containerId)))
        }

        return try await APIClient.shared.get(Constants.Endpoints.items, queryItems: queryItems)
    }

    func getItem(userId: String, itemId: Int) async throws -> Item {
        let queryItems = [
            URLQueryItem(name: "user", value: userId),
            URLQueryItem(name: "item", value: String(itemId))
        ]
        let endpoint = "\(Constants.Endpoints.items)/single"

        struct ItemResponse: Codable {
            let item: Item
        }

        let response: ItemResponse = try await APIClient.shared.get(endpoint, queryItems: queryItems)
        return response.item
    }

    // MARK: - Create Item
    func createItem(_ item: CreateItemRequest) async throws -> Item {
        struct CreateResponse: Codable {
            let success: Bool
            let item: Item?
            let error: String?
        }

        let response: CreateResponse = try await APIClient.shared.post(
            "\(Constants.Endpoints.items)/post",
            body: item
        )

        guard response.success, let newItem = response.item else {
            throw APIError.serverError(response.error ?? "Failed to create item")
        }

        return newItem
    }

    // MARK: - Update Item
    func updateItem(itemId: Int, _ item: UpdateItemRequest) async throws -> Item {
        let queryItems = [URLQueryItem(name: "item_id", value: String(itemId))]

        struct UpdateResponse: Codable {
            let success: Bool
            let item: Item?
            let error: String?
        }

        let response: UpdateResponse = try await APIClient.shared.put(
            "\(Constants.Endpoints.items)/update",
            body: item,
            queryItems: queryItems
        )

        guard response.success, let updatedItem = response.item else {
            throw APIError.serverError(response.error ?? "Failed to update item")
        }

        return updatedItem
    }

    // MARK: - Get All Inventory (for offline sync)
    func getAllInventory(userId: String) async throws -> InventoryData {
        let queryItems = [URLQueryItem(name: "user", value: userId)]
        return try await APIClient.shared.get(Constants.Endpoints.lists, queryItems: queryItems)
    }
}

// MARK: - Request Models
struct CreateItemRequest: Encodable {
    let userId: UUID
    let collectionId: Int
    let containerId: Int?
    let name: String
    let description: String?
    let quantity: Int?
    let pictureUrl: String?
    let estimatedValue: Double?
    let fragile: Bool?
}

struct UpdateItemRequest: Encodable {
    let name: String?
    let description: String?
    let quantity: Int?
    let pictureUrl: String?
    let estimatedValue: Double?
    let fragile: Bool?
}

struct InventoryData: Codable {
    let locations: [Location]?
    let collections: [Collection]?
    let containers: [Container]?
    let items: [Item]?
}
