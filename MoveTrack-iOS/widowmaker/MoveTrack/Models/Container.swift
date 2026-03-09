//
//  Container.swift
//  Nexus Moves
//
//  Created on 2025-12-26.
//

import Foundation

struct Container: Codable, Identifiable {
    let id: Int
    let userId: UUID
    let collectionId: Int
    let name: String
    let description: String?
    let boxNumber: String?
    let qrCode: String?
    let sealed: Bool?
    let itemCount: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case collectionId = "collection_id"
        case name
        case description
        case boxNumber = "box_number"
        case qrCode = "qr_code"
        case sealed
        case itemCount = "item_count"
    }

    var displayName: String {
        if let boxNumber = boxNumber {
            return "Box #\(boxNumber)"
        }
        return name
    }

    var countSummary: String {
        let items = itemCount ?? 0
        return "\(items) item\(items == 1 ? "" : "s")"
    }

    var isSealed: Bool {
        return sealed ?? false
    }
}

struct QRCodeResponse: Codable {
    let success: Bool
    let token: String
    let url: String
}
