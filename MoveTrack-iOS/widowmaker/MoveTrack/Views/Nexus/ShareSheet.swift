//
//  ShareSheet.swift
//  Nexus Moves
//
//  Thin wrapper around UIActivityViewController so the agent's mover-shareable
//  inventory link can be shared with the native share sheet (Messages, Mail, …).
//

import SwiftUI
import UIKit

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
