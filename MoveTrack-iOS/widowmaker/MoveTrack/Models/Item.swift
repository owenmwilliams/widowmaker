//
//  Item.swift
//  MoveTrack
//
//  Created on 2025-12-26.
//

import Foundation

struct Item: Codable, Identifiable {
    let id: Int
    let userId: UUID
    let collectionId: Int
    let containerId: Int?
    let name: String
    let description: String?
    let quantity: Int?
    let pictureUrl: String?
    let estimatedValue: Double?
    let fragile: Bool?
    let tags: [String]?
    let material: String?
    let primaryColor: String?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case collectionId = "collection_id"
        case containerId = "container_id"
        case name
        case description
        case quantity
        case pictureUrl = "picture_url"
        case estimatedValue = "estimated_value"
        case fragile
        case tags
        case material
        case primaryColor = "primary_color"
    }

    var quantityDisplay: String {
        guard let qty = quantity, qty > 1 else {
            return ""
        }
        return "\(qty)x"
    }

    var isFragile: Bool {
        return fragile ?? false
    }

    var valueDisplay: String? {
        guard let value = estimatedValue else { return nil }
        return "$\(String(format: "%.2f", value))"
    }

    var hasPhoto: Bool {
        return pictureUrl != nil
    }
}

struct ItemDetailResponse: Codable {
    let success: Bool
    let item: Item?
    let error: String?
}

struct ItemsResponse: Codable {
    let success: Bool
    let items: [Item]?
    let error: String?
}
