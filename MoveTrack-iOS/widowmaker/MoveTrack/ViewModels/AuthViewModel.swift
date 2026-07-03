//
//  AuthViewModel.swift
//  Nexus Moves
//
//  Created on 2025-12-26.
//

import Foundation
import SwiftUI
import Combine

@MainActor
class AuthViewModel: ObservableObject {
    @Published var isAuthenticated = false
    @Published var currentUser: User?
    @Published var isLoading = false
    @Published var errorMessage: String?
    // Launch gate: while a stored session is being validated the UI shows the
    // splash, never the login screen — a valid session must not be able to
    // start a second login flow, and a network blip must not read as
    // "logged out".
    @Published var isCheckingAuth: Bool
    @Published var authCheckFailed = false

    init() {
        isCheckingAuth = AuthService.shared.isLoggedIn
        checkAuthStatus()
    }

    // MARK: - Check Auth Status
    func checkAuthStatus() {
        guard AuthService.shared.isLoggedIn else {
            isAuthenticated = false
            isCheckingAuth = false
            return
        }
        isCheckingAuth = true
        authCheckFailed = false
        Task {
            await loadCurrentUser()
        }
    }

    // MARK: - Retry after an unreachable-server launch
    func retryAuthCheck() {
        checkAuthStatus()
    }

    // MARK: - Request Magic Link
    func requestMagicLink(email: String) async {
        print("🎬 [AuthViewModel] Starting magic link request for: \(email)")
        isLoading = true
        errorMessage = nil

        do {
            let response = try await AuthService.shared.requestMagicLink(email: email)

            if response.success {
                print("✅ [AuthViewModel] Magic link sent to \(email)")
            } else {
                errorMessage = response.error ?? "Failed to send magic link"
                print("⚠️ [AuthViewModel] Magic link response success=false: \(response.error ?? "unknown")")
            }
        } catch {
            let apiError = error as? APIError
            errorMessage = apiError?.localizedDescription ?? error.localizedDescription
            print("❌ [AuthViewModel] Error requesting magic link: \(error)")
        }

        isLoading = false
        print("🏁 [AuthViewModel] Magic link request finished")
    }

    // MARK: - Verify Magic Link
    func verifyMagicLink(token: String) async {
        print("🎬 [AuthViewModel] Starting magic link verification")
        print("🔑 [AuthViewModel] Token length: \(token.count) characters")
        isLoading = true
        errorMessage = nil

        do {
            let response = try await AuthService.shared.verifyMagicLink(token: token)

            if response.success, let user = response.user {
                currentUser = user
                isAuthenticated = true
                print("✅ [AuthViewModel] User authenticated: \(user.email)")
            } else {
                errorMessage = response.error ?? "Failed to verify magic link"
                print("⚠️ [AuthViewModel] Verification response success=false: \(response.error ?? "unknown")")
            }
        } catch {
            let apiError = error as? APIError
            errorMessage = apiError?.localizedDescription ?? error.localizedDescription
            print("❌ [AuthViewModel] Error verifying magic link: \(error)")
        }

        isLoading = false
        print("🏁 [AuthViewModel] Magic link verification finished")
    }

    // MARK: - Request OTP Code
    func requestCode(email: String) async {
        isLoading = true
        errorMessage = nil
        do {
            let response = try await AuthService.shared.requestCode(email: email)
            if !response.success {
                errorMessage = response.error ?? "Failed to send code"
            }
        } catch {
            let apiError = error as? APIError
            errorMessage = apiError?.localizedDescription ?? error.localizedDescription
        }
        isLoading = false
    }

    // MARK: - Verify OTP Code
    func verifyCode(email: String, code: String) async {
        isLoading = true
        errorMessage = nil
        do {
            let response = try await AuthService.shared.verifyCode(email: email, code: code)
            if response.success, let user = response.user {
                currentUser = user
                isAuthenticated = true
            } else {
                errorMessage = response.error ?? "Invalid or expired code"
            }
        } catch {
            let apiError = error as? APIError
            errorMessage = apiError?.localizedDescription ?? error.localizedDescription
        }
        isLoading = false
    }

    // MARK: - Load Current User
    func loadCurrentUser() async {
        do {
            currentUser = try await AuthService.shared.getCurrentUser()
            isAuthenticated = true
            authCheckFailed = false
        } catch let error as APIError {
            print("❌ Error loading current user: \(error)")
            if case .unauthorized = error {
                // Real 401 — the server rejected the token (APIClient already
                // cleared it from the keychain). This is the ONLY case that
                // ends the session.
                currentUser = nil
                isAuthenticated = false
            } else {
                // Timeout, offline, 5xx: the session is still good — keep the
                // token and let the splash offer a retry instead of dumping
                // the user to the login screen.
                authCheckFailed = true
            }
        } catch {
            print("❌ Error loading current user: \(error)")
            authCheckFailed = true
        }
        isCheckingAuth = false
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
        isCheckingAuth = false
        authCheckFailed = false
    }
}
