//
//  LoginView.swift
//  Nexus Moves
//
//  Created on 2025-12-26.
//

import SwiftUI

struct LoginView: View {
    @StateObject private var viewModel: AuthViewModel
    @State private var email = ""
    @State private var token = ""
    @State private var showMagicLinkSent = false
    @State private var showTokenInput = false

    init(viewModel: AuthViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                Spacer()

                // Logo/Title
                VStack(spacing: 8) {
                    Image(systemName: "shippingbox.fill")
                        .font(.system(size: 80))
                        .foregroundColor(.blue)

                    Text("Nexus Moves")
                        .font(.largeTitle)
                        .fontWeight(.bold)

                    Text("Smart Inventory for Your Move")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .padding(.bottom, 40)

                // Email Input
                VStack(alignment: .leading, spacing: 8) {
                    Text("Email Address")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    TextField("you@example.com", text: $email)
                        .textContentType(.emailAddress)
                        .autocapitalization(.none)
                        .keyboardType(.emailAddress)
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(12)
                }
                .padding(.horizontal)

                // Login Button
                Button(action: sendMagicLink) {
                    HStack {
                        if viewModel.isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        } else {
                            Text("Send Magic Link")
                                .fontWeight(.semibold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(email.isEmpty || viewModel.isLoading ? Color.gray : Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .disabled(email.isEmpty || viewModel.isLoading)
                .padding(.horizontal)

                // Error Message
                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundColor(.red)
                        .padding(.horizontal)
                }

                // Divider
                HStack {
                    Rectangle()
                        .fill(Color.secondary.opacity(0.3))
                        .frame(height: 1)
                    Text("OR")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Rectangle()
                        .fill(Color.secondary.opacity(0.3))
                        .frame(height: 1)
                }
                .padding(.horizontal)
                .padding(.vertical, 8)

                // Token Input (Copy/Paste Code)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Have a code?")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    TextField("Paste your login code here", text: $token)
                        .textContentType(.oneTimeCode)
                        .autocapitalization(.none)
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(12)
                }
                .padding(.horizontal)

                // Verify Token Button
                Button(action: verifyToken) {
                    HStack {
                        if viewModel.isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        } else {
                            Text("Log In with Code")
                                .fontWeight(.semibold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(token.isEmpty || viewModel.isLoading ? Color.gray : Color.green)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .disabled(token.isEmpty || viewModel.isLoading)
                .padding(.horizontal)

                Spacer()

                // Info Text
                Text("We'll send you a magic link to log in.\nNo password needed!")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                    .padding(.bottom, 40)
            }
            .navigationTitle("")
            .navigationBarHidden(true)
        }
        .sheet(isPresented: $showMagicLinkSent) {
            MagicLinkSentView(email: email)
        }
    }

    // MARK: - Actions
    private func sendMagicLink() {
        Task {
            await viewModel.requestMagicLink(email: email)
            if viewModel.errorMessage == nil {
                showMagicLinkSent = true
            }
        }
    }

    private func verifyToken() {
        Task {
            await viewModel.verifyMagicLink(token: token.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }
}

#Preview {
    LoginView(viewModel: AuthViewModel())
}
