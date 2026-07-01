//
//  LoginView.swift
//  Nexus Moves
//
//  Created on 2025-12-26.
//

import SwiftUI
import UIKit

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
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Enter the 6-digit code we emailed to \(email)")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        CodeBoxesField(code: $code, onComplete: { verifyCode() })
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
            // The code field uses a number pad (no return key), so give the
            // keyboard an explicit "Done" to dismiss it.
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { hideKeyboard() }
                }
            }
        }
    }

    private func hideKeyboard() {
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil
        )
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

// MARK: - Six-digit code entry

/// Six single-digit boxes backed by one hidden field (so iOS one-time-code
/// autofill, paste, and the number pad all work). Tapping anywhere focuses it.
struct CodeBoxesField: View {
    @Binding var code: String
    var count: Int = 6
    var onComplete: () -> Void = {}

    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            HStack(spacing: 10) {
                ForEach(0..<count, id: \.self) { index in
                    box(at: index)
                }
            }
            .allowsHitTesting(false)

            // An invisible full-size field sits ON TOP of the boxes so it captures
            // taps, the number pad, one-time-code autofill, AND the long-press
            // "Paste" menu (a 1pt hidden field made paste impossible).
            TextField("", text: Binding(
                get: { code },
                set: { newValue in
                    let filtered = String(newValue.filter(\.isNumber).prefix(count))
                    code = filtered
                    if filtered.count == count { onComplete() }
                }
            ))
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .focused($focused)
            .foregroundColor(.clear)
            .tint(.clear)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .contentShape(Rectangle())
            .opacity(0.02)
        }
        .frame(height: 56)
        .onAppear { focused = true }
    }

    private func box(at index: Int) -> some View {
        let chars = Array(code)
        let hasChar = index < chars.count
        let isCurrent = focused && index == chars.count
        return Text(hasChar ? String(chars[index]) : "")
            .font(.system(size: 26, weight: .semibold, design: .rounded))
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(.systemGray6)))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(isCurrent ? Color.accentColor : Color(.systemGray4), lineWidth: isCurrent ? 2 : 1)
            )
    }
}

#Preview {
    LoginView(viewModel: AuthViewModel())
}
