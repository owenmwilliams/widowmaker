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
            if authViewModel.isAuthenticated, let user = authViewModel.currentUser {
                // Show main app
                LocationsListView(userId: user.id)
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
