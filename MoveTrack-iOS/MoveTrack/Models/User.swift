//
//  User.swift
//  Nexus Moves
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
        case onboardingCompleted = "onboarding_completed"
        case emailVerified
        case plan
        case isAdmin = "is_admin"
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
}

struct MagicLinkResponse: Codable {
    let success: Bool
    let message: String?
    let error: String?
}
