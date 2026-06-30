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
    @State private var code = ""
    @State private var codeSent = false

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
                        .disabled(codeSent)
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(12)
                }
                .padding(.horizontal)

                if !codeSent {
                    // Step 1: request a code
                    Button(action: sendCode) {
                        HStack {
                            if viewModel.isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            } else {
                                Text("Email me a code")
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
                } else {
                    // Step 2: enter the 6-digit code
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Enter the 6-digit code we emailed to \(email)")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        TextField("123456", text: $code)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.numberPad)
                            .padding()
                            .background(Color(.systemGray6))
                            .cornerRadius(12)
                    }
                    .padding(.horizontal)

                    Button(action: verifyCode) {
                        HStack {
                            if viewModel.isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            } else {
                                Text("Log In")
                                    .fontWeight(.semibold)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(code.count < 6 || viewModel.isLoading ? Color.gray : Color.green)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(code.count < 6 || viewModel.isLoading)
                    .padding(.horizontal)

                    Button("Use a different email / resend code") {
                        resetToEmail()
                    }
                    .font(.caption)
                    .padding(.top, 4)
                }

                // Error Message
                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundColor(.red)
                        .padding(.horizontal)
                }

                Spacer()

                // Info Text
                Text("We'll email you a 6-digit code to log in.\nNo password needed!")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                    .padding(.bottom, 40)
            }
            .navigationTitle("")
            .navigationBarHidden(true)
        }
    }

    // MARK: - Actions
    private func sendCode() {
        Task {
            await viewModel.requestCode(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
            if viewModel.errorMessage == nil {
                codeSent = true
            }
        }
    }

    private func verifyCode() {
        Task {
            await viewModel.verifyCode(
                email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                code: code.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }
    }

    private func resetToEmail() {
        codeSent = false
        code = ""
        viewModel.errorMessage = nil
    }
}

#Preview {
    LoginView(viewModel: AuthViewModel())
}
