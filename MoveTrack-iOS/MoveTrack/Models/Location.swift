//
//  Location.swift
//  Nexus Moves
//
//  Created on 2025-12-26.
//

import Foundation

struct Location: Codable, Identifiable {
    let id: Int
    let userId: UUID
    let name: String
    let locationType: String
    let address: String?
    let city: String?
    let state: String?
    let zip: String?
    let latitude: Double?
    let longitude: Double?
    let itemCount: Int?
    let collectionCount: Int?
    let containerCount: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case name
        case locationType = "location_type"
        case address
        case city
        case state
        case zip
        case latitude = "lat"
        case longitude = "lng"
        case itemCount = "item_count"
        case collectionCount = "collection_count"
        case containerCount = "container_count"
    }

    var fullAddress: String {
        var components: [String] = []
        if let address = address { components.append(address) }
        if let city = city { components.append(city) }
        if let state = state { components.append(state) }
        if let zip = zip { components.append(zip) }
        return components.joined(separator: ", ")
    }

    var locationTypeDisplay: String {
        switch locationType {
        case "residence":
            return "Residence"
        case "primary_residence":
            return "Primary Residence"
        case "storage_unit":
            return "Storage Unit"
        case "warehouse":
            return "Warehouse"
        case "truck":
            return "Truck"
        default:
            return locationType.capitalized
        }
    }

    var countSummary: String {
        let items = itemCount ?? 0
        let collections = collectionCount ?? 0
        return "\(items) items in \(collections) rooms"
    }
}
