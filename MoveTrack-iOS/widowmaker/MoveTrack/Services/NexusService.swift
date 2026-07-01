//
//  NexusService.swift
//  Nexus Moves
//
//  Native networking for the Nexus agent. Mirrors the web app's NexusStore but
//  consumes Server-Sent Events with URLSession.AsyncBytes so the whole flow is
//  native (no WKWebView). All requests carry the Keychain session token as a
//  Bearer header.
//

import Foundation

final class NexusService {
    static let shared = NexusService()

    private let decoder = JSONDecoder()           // wire is camelCase — no key strategy
    private let encoder = JSONEncoder()           // keep mimeType as-is for the backend

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        // The orchestrator can think/delegate for a while between SSE chunks, and
        // video uploads are large — generous timeouts.
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 600
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()

    private init() {}

    // MARK: - Request helpers

    private func url(for path: String) -> URL {
        URL(string: Constants.apiBaseURL + path)!
    }

    private func addAuth(_ request: inout URLRequest) {
        if let token = AuthService.shared.sessionToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    private func validate(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw NexusError.network("No response from server")
        }
        if http.statusCode == 401 {
            KeychainService.shared.delete(forKey: Constants.sessionTokenKey)
            throw NexusError.unauthorized
        }
        guard (200...299).contains(http.statusCode) else {
            throw NexusError.server(errorMessage(from: data) ?? "Request failed (\(http.statusCode))")
        }
    }

    private func errorMessage(from data: Data) -> String? {
        (try? decoder.decode([String: String].self, from: data))?["error"]
    }

    // MARK: - Active session + history

    func loadActiveSession() async throws -> ActiveSessionResponse {
        var request = URLRequest(url: url(for: "/api/agents/nexus/active-session"))
        addAuth(&request)
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        return try decoder.decode(ActiveSessionResponse.self, from: data)
    }

    // MARK: - Send message (SSE)

    /// Sends a message and streams progress via `onEvent` (delivered on the main
    /// actor). Returns the terminal `done` event (with `reply`, `actions`, …).
    func sendMessage(
        text: String,
        attachments: [OutgoingAttachment],
        onEvent: @escaping @MainActor (SSEEvent) -> Void
    ) async throws -> SSEEvent {
        var request = URLRequest(url: url(for: "/api/agents/nexus/message"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        addAuth(&request)

        struct Body: Encodable { let message: String; let attachments: [OutgoingAttachment] }
        request.httpBody = try encoder.encode(Body(message: text, attachments: attachments))

        return try await streamSSE(request: request, onEvent: onEvent)
    }

    /// Requests proactive guidance (called when reopening a stale conversation).
    func requestGuidance(onEvent: @escaping @MainActor (SSEEvent) -> Void) async throws -> SSEEvent {
        var request = URLRequest(url: url(for: "/api/agents/nexus/guidance"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        addAuth(&request)
        request.httpBody = Data("{}".utf8)
        return try await streamSSE(request: request, onEvent: onEvent)
    }

    private func streamSSE(
        request: URLRequest,
        onEvent: @escaping @MainActor (SSEEvent) -> Void
    ) async throws -> SSEEvent {
        let (bytes, response) = try await session.bytes(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw NexusError.network("No response from server")
        }
        if http.statusCode == 401 {
            KeychainService.shared.delete(forKey: Constants.sessionTokenKey)
            throw NexusError.unauthorized
        }
        guard (200...299).contains(http.statusCode) else {
            // Error responses before the stream begins arrive as a JSON body.
            var data = Data()
            for try await byte in bytes { data.append(byte) }
            throw NexusError.server(errorMessage(from: data) ?? "Request failed (\(http.statusCode))")
        }

        var done: SSEEvent?
        for try await line in bytes.lines {
            guard line.hasPrefix("data:") else { continue }
            // Tolerate "data: {json}" and "data:{json}".
            let payload = line.hasPrefix("data: ") ? String(line.dropFirst(6)) : String(line.dropFirst(5))
            guard let data = payload.data(using: .utf8),
                  let event = try? decoder.decode(SSEEvent.self, from: data) else { continue }

            switch event.type {
            case "error":
                throw NexusError.server(event.error ?? "The assistant hit an error.")
            case "done":
                done = event
            default:
                await MainActor.run { onEvent(event) }
            }
        }

        guard let result = done else {
            throw NexusError.server("The assistant stopped responding. Please try again.")
        }
        return result
    }

    // MARK: - Upload (multipart)

    func uploadMedia(data: Data, mimeType: String, filename: String) async throws -> UploadResponse {
        var request = URLRequest(url: url(for: "/api/agents/nexus/upload"))
        request.httpMethod = "POST"
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        addAuth(&request)

        var body = Data()
        body.appendString("--\(boundary)\r\n")
        body.appendString("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n")
        body.appendString("Content-Type: \(mimeType)\r\n\r\n")
        body.append(data)
        body.appendString("\r\n--\(boundary)--\r\n")
        request.httpBody = body

        let (respData, response) = try await session.data(for: request)
        try validate(response, data: respData)
        return try decoder.decode(UploadResponse.self, from: respData)
    }

    // MARK: - Share links

    /// Lists the user's existing share links.
    func listShares() async throws -> [ShareDTO] {
        var request = URLRequest(url: url(for: "/shares"))
        addAuth(&request)
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        return try decoder.decode([ShareDTO].self, from: data)
    }

    /// Creates a new public share link for the user's whole inventory.
    func createShare() async throws -> ShareDTO {
        var request = URLRequest(url: url(for: "/shares"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&request)
        request.httpBody = Data("{}".utf8)
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        return try decoder.decode(ShareDTO.self, from: data)
    }

    /// Share-readiness + reasonableness check (used to warn before sharing).
    func shareReadiness() async throws -> ShareReadinessDTO {
        var request = URLRequest(url: url(for: "/shares/readiness"))
        addAuth(&request)
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        return try decoder.decode(ShareReadinessDTO.self, from: data)
    }

    // MARK: - Inventory review (native review cards)

    /// Commit the items the user kept/edited in the review sheet. Returns how many were added.
    func commitReviewedItems(_ items: [ReviewedItemPayload], room: String?) async throws -> Int {
        var request = URLRequest(url: url(for: "/api/agents/nexus/inventory/commit"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&request)
        struct Body: Encodable { let items: [ReviewedItemPayload]; let room: String? }
        request.httpBody = try encoder.encode(Body(items: items, room: room))
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        struct Resp: Decodable { let addedCount: Int? }
        return (try? decoder.decode(Resp.self, from: data))?.addedCount ?? items.count
    }

    /// Remove the item ids the user chose in the duplicate-review sheet. Returns how many were removed.
    func resolveDuplicates(removeItemIds ids: [Int]) async throws -> Int {
        var request = URLRequest(url: url(for: "/api/agents/nexus/inventory/resolve-duplicates"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&request)
        struct Body: Encodable { let removeItemIds: [Int] }
        request.httpBody = try encoder.encode(Body(removeItemIds: ids))
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        struct Resp: Decodable { let removedCount: Int? }
        return (try? decoder.decode(Resp.self, from: data))?.removedCount ?? ids.count
    }

    // MARK: - Clear / archive session

    func clearSession(id: String) async throws {
        var request = URLRequest(url: url(for: "/api/agents/nexus/sessions/\(id)"))
        request.httpMethod = "DELETE"
        addAuth(&request)
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
    }
}

private extension Data {
    mutating func appendString(_ string: String) {
        append(Data(string.utf8))
    }
}
