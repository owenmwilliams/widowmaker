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

#Preview {
    ContentView()
        .environmentObject(AuthViewModel())
}
