//
//  ClientEventLogger.swift
//  Nexus Moves
//
//  Lightweight batched client-event log for the scan/chat pipeline. Before
//  this, a client-side failure (an aborted upload, an SSE timeout, a review
//  card discarded on error) left no trace anywhere — see
//  docs/notes/beta-scan-reliability-investigation.md Section 5.3 #10.
//
//  This is NOT a crash reporter. It intentionally does not capture stack
//  traces, device identifiers beyond OS/app version, or arbitrary PII, and it
//  does not retry failed sends — it's a best-effort lifecycle log, not a
//  delivery guarantee. Full crash/error reporting (Sentry, Crashlytics, or
//  similar) is a real gap this doesn't close; that's a vendor decision left
//  for Owen to make deliberately rather than picked implicitly here.
//

import Foundation
#if canImport(UIKit)
import UIKit
#endif

enum ClientEventType: String, Encodable {
    case uploadStarted = "upload_started"
    case uploadSucceeded = "upload_succeeded"
    case uploadFailed = "upload_failed"
    case sseTimeout = "sse_timeout"
    case turnFailed = "turn_failed"
    case reviewCardShown = "review_card_shown"
    case reviewCardCommitted = "review_card_committed"
}

/// An `actor` — not a plain class — because `log()` is called from many
/// contexts at once (including synchronous, non-async call sites like
/// `NexusViewModel.handle(_:)`) while `flush()` runs on a timer. A plain class
/// let `log()`'s buffer append (implicitly MainActor, since all callers today
/// are on MainActor) race against `flush()`'s unstructured `Task {}`, which
/// does NOT inherit MainActor isolation — lost/duplicated events, and it
/// wouldn't compile under Swift 6 strict concurrency at all.
actor ClientEventLogger {
    static let shared = ClientEventLogger()

    private struct Event: Encodable {
        let type: String
        let sessionId: String?
        let clientAt: String
        let metadata: [String: String]?
    }

    private struct Batch: Encodable {
        let events: [Event]
        let appVersion: String?
        let osVersion: String?
    }

    private let encoder = JSONEncoder()
    private var buffer: [Event] = []
    private var flushTask: Task<Void, Never>?

    private let maxBufferSize = 20
    private let flushDelayNanoseconds: UInt64 = 10_000_000_000 // 10s

    private init() {}

    /// Queue an event for the next batch. `nonisolated` so every existing call
    /// site keeps working unawaited from any context (sync or async); the
    /// actual buffer mutation hops onto the actor via `Task`, so it's still
    /// race-free — just not synchronous with the call.
    nonisolated func log(_ type: ClientEventType, sessionId: String? = nil, metadata: [String: String]? = nil) {
        let event = Event(
            type: type.rawValue,
            sessionId: sessionId,
            clientAt: ISO8601DateFormatter().string(from: Date()),
            metadata: metadata
        )
        Task { await self.enqueue(event) }
    }

    private func enqueue(_ event: Event) {
        buffer.append(event)
        if buffer.count >= maxBufferSize {
            flushTask?.cancel()
            flushTask = Task { await flush() }
        } else {
            scheduleFlush()
        }
    }

    private func scheduleFlush() {
        guard flushTask == nil else { return }
        flushTask = Task { [weak self, flushDelayNanoseconds] in
            try? await Task.sleep(nanoseconds: flushDelayNanoseconds)
            await self?.flush()
        }
    }

    /// Best-effort, fire-and-forget — a failed send drops the batch rather than
    /// retrying or blocking the caller. Call directly (e.g. on scene
    /// backgrounding) to flush without waiting for the timer.
    @discardableResult
    func flush() async -> Bool {
        flushTask = nil
        guard !buffer.isEmpty else { return true }
        guard let token = AuthService.shared.sessionToken,
              let url = URL(string: Constants.apiBaseURL + "/api/client-events") else {
            buffer.removeAll()
            return false
        }

        let toSend = buffer
        buffer = []

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        #if canImport(UIKit)
        let osVersion: String? = UIDevice.current.systemVersion
        #else
        let osVersion: String? = nil
        #endif

        do {
            request.httpBody = try encoder.encode(Batch(events: toSend, appVersion: appVersion, osVersion: osVersion))
            _ = try await URLSession.shared.data(for: request)
            return true
        } catch {
            return false
        }
    }
}
