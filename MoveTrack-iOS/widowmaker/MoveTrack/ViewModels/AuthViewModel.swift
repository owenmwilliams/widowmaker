//
//  AuthViewModel.swift
//  MoveTrack
//
//  Created on 2025-12-26.
//

import Foundation
import SwiftUI

@MainActor
class AuthViewModel: ObservableObject {
    @Published var isAuthenticated = false
    @Published var currentUser: User?
    @Published var isLoading = false
    @Published var errorMessage: String?

    init() {
        checkAuthStatus()
    }

    // MARK: - Check Auth Status
    func checkAuthStatus() {
        isAuthenticated = AuthService.shared.isLoggedIn

        if isAuthenticated {
            Task {
                await loadCurrentUser()
            }
        }
    }

    // MARK: - Request Magic Link
    func requestMagicLink(email: String) async {
        isLoading = true
        errorMessage = nil

        do {
            let response = try await AuthService.shared.requestMagicLink(email: email)

            if response.success {
                print("✅ Magic link sent to \(email)")
            } else {
                errorMessage = response.error ?? "Failed to send magic link"
            }
        } catch {
            errorMessage = error.localizedDescription
            print("❌ Error requesting magic link: \(error)")
        }

        isLoading = false
    }

    // MARK: - Verify Magic Link
    func verifyMagicLink(token: String) async {
        isLoading = true
        errorMessage = nil

        do {
            let response = try await AuthService.shared.verifyMagicLink(token: token)

            if response.success, let user = response.user {
                currentUser = user
                isAuthenticated = true
                print("✅ User authenticated: \(user.email)")
            } else {
                errorMessage = response.error ?? "Failed to verify magic link"
            }
        } catch {
            errorMessage = error.localizedDescription
            print("❌ Error verifying magic link: \(error)")
        }

        isLoading = false
    }

    // MARK: - Load Current User
    func loadCurrentUser() async {
        do {
            currentUser = try await AuthService.shared.getCurrentUser()
            isAuthenticated = true
        } catch {
            print("❌ Error loading current user: \(error)")
            // If we can't load the user, clear auth
            await logout()
        }
    }

    // MARK: - Logout
    func logout() async {
        isLoading = true

        do {
            try await AuthService.shared.logout()
        } catch {
            print("❌ Error during logout: \(error)")
        }

        currentUser = nil
        isAuthenticated = false
        isLoading = false
    }
}
