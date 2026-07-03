//
//  ContentView.swift
//  Nexus Moves
//
//  Created on 2025-12-26.
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authViewModel: AuthViewModel

    var body: some View {
        Group {
            if authViewModel.isCheckingAuth || authViewModel.authCheckFailed {
                // A stored session is being validated (or the server was
                // unreachable). Never show the login screen here — the user
                // may well be logged in, and offering a second login invites
                // duplicate sessions and racing auth flows.
                LaunchSplashView(
                    failed: authViewModel.authCheckFailed,
                    retry: { authViewModel.retryAuthCheck() }
                )
            } else if authViewModel.isAuthenticated, authViewModel.currentUser != nil {
                // The entire post-login experience is the native Nexus agent chat:
                // describe your home, drop in room videos/photos, and share a
                // mover-ready inventory. No dashboards — just the agent.
                NexusChatView()
                    .environmentObject(authViewModel)
            } else {
                // Show login
                LoginView(viewModel: authViewModel)
            }
        }
    }
}

// MARK: - Launch splash

/// Shown while the stored session is validated against the server, and as the
/// retry surface when the server can't be reached at launch. Mirrors the
/// LoginView branding so launch feels like one continuous screen.
private struct LaunchSplashView: View {
    let failed: Bool
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 10) {
                Image("AppLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 88, height: 88)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .shadow(color: .black.opacity(0.12), radius: 8, y: 3)

                Text("Nexus Moves")
                    .font(.largeTitle)
                    .fontWeight(.bold)
            }

            if failed {
                VStack(spacing: 16) {
                    Text("Can't reach the server right now.\nYou're still signed in.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)

                    Button(action: retry) {
                        Text("Try Again")
                            .fontWeight(.semibold)
                            .frame(maxWidth: 220)
                            .padding()
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                    }
                }
                .padding(.top, 8)
            } else {
                ProgressView()
                    .padding(.top, 8)
            }

            Spacer()
            Spacer()
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthViewModel())
}
