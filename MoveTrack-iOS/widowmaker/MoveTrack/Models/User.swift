//
//  User.swift
//  MoveTrack
//
//  Created on 2025-12-26.
//

import Foundation

struct User: Codable, Identifiable {
    let id: UUID
    let email: String
    let firstName: String?
    let lastName: String?
    let onboardingCompleted: Bool
    let emailVerified: Bool
    let plan: String
    let isAdmin: Bool

    enum CodingKeys: String, CodingKey {
        case id = "userId"
        case email
        case firstName
        case lastName
        case onboardingCompleted
        case emailVerified
        case plan
        case isAdmin
    }

    var displayName: String {
        if let first = firstName, let last = lastName {
            return "\(first) \(last)"
        } else if let first = firstName {
            return first
        } else {
            return email
        }
    }

    var isPro: Bool {
        return plan == "pro"
    }
}

struct AuthResponse: Codable {
    let success: Bool
    let sessionToken: String?
    let user: User?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case success
        case sessionToken
        case user
        case error
    }
}

struct MagicLinkResponse: Codable {
    let success: Bool
    let message: String?
    let error: String?
}
