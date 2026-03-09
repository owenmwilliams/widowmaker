//
//  Collection.swift
//  Nexus Moves
//
//  Created on 2025-12-26.
//

import Foundation

struct Collection: Codable, Identifiable {
    let id: Int
    let userId: UUID
    let locationId: Int
    let name: String
    let description: String?
    let colorCode: String?
    let icon: String?
    let itemCount: Int?
    let containerCount: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case locationId = "location_id"
        case name
        case description
        case colorCode = "color_code"
        case icon
        case itemCount = "item_count"
        case containerCount = "container_count"
    }

    var countSummary: String {
        let items = itemCount ?? 0
        let containers = containerCount ?? 0
        if containers > 0 {
            return "\(items) items in \(containers) boxes"
        } else {
            return "\(items) items"
        }
    }
}
