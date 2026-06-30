//
//  NexusWebView.swift
//  Nexus Moves
//
//  Embeds the ReloPrep web experience (agent-first onboarding, room-video
//  capture, and mover-shareable inventory) inside the native app, authenticated
//  with the native session token. This is the "embed the agent chat first" iOS
//  MVP: it reuses the entire web flow with minimal native code, so a user can go
//  download -> guided 3-step inventory -> share, on device.
//

import SwiftUI
import WebKit

struct NexusWebView: UIViewRepresentable {
    let urlString: String
    let sessionToken: String?

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Let the embedded camera/video capture (room walkthrough) play inline
        // and start without an extra tap.
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        if let token = sessionToken, !token.isEmpty {
            // Seed the web app's auth in localStorage before any page script runs
            // so it loads straight into the authenticated agent flow. Tokens are
            // url-safe base64; strip quotes/backslashes defensively anyway.
            let safe = token
                .replacingOccurrences(of: "\\", with: "")
                .replacingOccurrences(of: "'", with: "")
            let js = "window.localStorage.setItem('session_token', '\(safe)');"
            config.userContentController.addUserScript(
                WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.bounces = false
        if let url = URL(string: urlString) {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}

/// Full-screen host for the embedded agent flow. The web app provides its own
/// in-app navigation (inventory, settings, logout) once onboarding completes.
struct NexusScreen: View {
    @EnvironmentObject var authViewModel: AuthViewModel

    var body: some View {
        NexusWebView(
            urlString: "\(Constants.webAppBaseURL)/nexus",
            sessionToken: AuthService.shared.sessionToken
        )
        .ignoresSafeArea(.container, edges: .bottom)
    }
}
