//
//  Nexus MovesApp.swift
//  Nexus Moves
//
//  Created on 2025-12-26.
//

import SwiftUI

@main
struct MoveTrackApp: App {
    @StateObject private var authViewModel = AuthViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authViewModel)
                .onOpenURL { url in
                    handleDeepLink(url)
                }
        }
        // Flush queued client events before the app is suspended — otherwise a
        // batch sitting in the 10s timer window is lost every time the user
        // backgrounds mid-scan (a common moment for exactly the failures this
        // log exists to catch).
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .background {
                Task { await ClientEventLogger.shared.flush() }
            }
        }
    }

    // MARK: - Deep Link Handler
    private func handleDeepLink(_ url: URL) {
        print("📱 Received deep link: \(url.absoluteString)")

        // Handle magic link: movetrack://login?token=...
        guard url.scheme == Constants.urlScheme else {
            print("❌ Invalid URL scheme: \(url.scheme ?? "none")")
            return
        }

        guard url.host == "login" else {
            print("❌ Invalid URL host: \(url.host ?? "none")")
            return
        }

        // Extract token from query parameters
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems,
              let token = queryItems.first(where: { $0.name == "token" })?.value else {
            print("❌ No token found in URL")
            return
        }

        print("✅ Extracted token: \(token.prefix(16))...")

        // Verify the magic link token
        Task {
            await authViewModel.verifyMagicLink(token: token)
        }
    }
}
