//
//  MagicLinkSentView.swift
//  MoveTrack
//
//  Created on 2025-12-26.
//

import SwiftUI

struct MagicLinkSentView: View {
    @Environment(\.dismiss) var dismiss
    let email: String

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                Spacer()

                // Success Icon
                Image(systemName: "envelope.circle.fill")
                    .font(.system(size: 80))
                    .foregroundColor(.green)

                // Title
                Text("Check Your Email")
                    .font(.title)
                    .fontWeight(.bold)

                // Message
                Text("We sent a magic link to:")
                    .font(.body)
                    .foregroundColor(.secondary)

                Text(email)
                    .font(.body)
                    .fontWeight(.semibold)
                    .foregroundColor(.blue)

                Divider()
                    .padding(.vertical)

                // Instructions
                VStack(alignment: .leading, spacing: 12) {
                    InstructionRow(
                        number: "1",
                        text: "Open your email app"
                    )

                    InstructionRow(
                        number: "2",
                        text: "Find the email from MoveTrack"
                    )

                    InstructionRow(
                        number: "3",
                        text: "Click the magic link to log in"
                    )
                }
                .padding(.horizontal)

                Spacer()

                // Close Button
                Button(action: { dismiss() }) {
                    Text("OK")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                }
                .padding(.horizontal)
                .padding(.bottom, 40)
            }
            .navigationTitle("Magic Link Sent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}

struct InstructionRow: View {
    let number: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(number)
                .font(.headline)
                .fontWeight(.bold)
                .frame(width: 28, height: 28)
                .background(Color.blue)
                .foregroundColor(.white)
                .clipShape(Circle())

            Text(text)
                .font(.body)
                .foregroundColor(.primary)

            Spacer()
        }
    }
}

#Preview {
    MagicLinkSentView(email: "user@example.com")
}
