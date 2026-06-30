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
            if authViewModel.isAuthenticated, authViewModel.currentUser != nil {
                // Embed the agent-first web flow (onboarding → room-video capture
                // → mover-shareable inventory). The native list screens remain in
                // the codebase but the agent flow is the primary experience.
                NexusScreen()
                    .environmentObject(authViewModel)
            } else {
                // Show login
                LoginView(viewModel: authViewModel)
            }
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthViewModel())
}
