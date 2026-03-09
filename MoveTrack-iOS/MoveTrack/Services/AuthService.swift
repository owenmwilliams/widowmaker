//
//  AuthService.swift
//  Nexus Moves
//
//  Created on 2025-12-26.
//

import Foundation

class AuthService {
    static let shared = AuthService()

    private init() {}

    // MARK: - Request Magic Link
    func requestMagicLink(email: String) async throws -> MagicLinkResponse {
        struct RequestBody: Encodable {
            let email: String
        }

        let response: MagicLinkResponse = try await APIClient.shared.post(
            Constants.Endpoints.requestMagicLink,
            body: RequestBody(email: email),
            requiresAuth: false
        )

        return response
    }

    // MARK: - Verify Magic Link
    func verifyMagicLink(token: String) async throws -> AuthResponse {
        let queryItems = [URLQueryItem(name: "token", value: token)]

        let response: AuthResponse = try await APIClient.shared.get(
            Constants.Endpoints.verifyMagicLink,
            queryItems: queryItems,
            requiresAuth: false
        )

        // If successful, save session token
        if response.success, let sessionToken = response.sessionToken {
            _ = KeychainService.shared.save(sessionToken, forKey: Constants.sessionTokenKey)
        }

        return response
    }

    // MARK: - Get Current User
    func getCurrentUser() async throws -> User {
        struct MeResponse: Codable {
            let success: Bool
            let user: User?
            let error: String?
        }

        let response: MeResponse = try await APIClient.shared.get(Constants.Endpoints.me)

        guard response.success, let user = response.user else {
            throw APIError.serverError(response.error ?? "Failed to get user")
        }

        return user
    }

    // MARK: - Logout
    func logout() async throws {
        struct LogoutResponse: Codable {
            let success: Bool
            let error: String?
        }

        do {
            let _: LogoutResponse = try await APIClient.shared.post(Constants.Endpoints.logout)
        } catch {
            // Continue with logout even if API call fails
            print("Logout API call failed: \(error.localizedDescription)")
        }

        // Clear session token
        _ = KeychainService.shared.delete(forKey: Constants.sessionTokenKey)
    }

    // MARK: - Check if Logged In
    var isLoggedIn: Bool {
        return KeychainService.shared.load(forKey: Constants.sessionTokenKey) != nil
    }

    // MARK: - Get Stored Session Token
    var sessionToken: String? {
        return KeychainService.shared.load(forKey: Constants.sessionTokenKey)
    }
}
