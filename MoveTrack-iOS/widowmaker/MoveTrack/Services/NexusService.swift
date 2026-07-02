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

    /// Upload media DIRECTLY to storage via a signed URL, bypassing the API's
    /// ~32MB request cap (used for videos). Returns the public URL to attach to a
    /// message. 1) ask the API for a signed upload URL, 2) PUT the bytes to GCS.
    /// Both network legs get one retry — this flow runs over cellular for large
    /// video files, where a single transient blip shouldn't force a re-record.
    func uploadMediaDirect(data: Data, mimeType: String, filename: String) async throws -> UploadResponse {
        // 1. Request a signed upload URL.
        var urlReq = URLRequest(url: url(for: "/api/agents/nexus/upload-url"))
        urlReq.httpMethod = "POST"
        urlReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&urlReq)
        struct Body: Encodable { let mimeType: String; let filename: String; let byteLength: Int }
        urlReq.httpBody = try encoder.encode(Body(mimeType: mimeType, filename: filename, byteLength: data.count))

        let (metaData, metaResp) = try await withOneRetry { try await session.data(for: urlReq) }
        try validate(metaResp, data: metaData)

        struct SignedUpload: Decodable { let uploadUrl: String; let url: String }
        let info = try decoder.decode(SignedUpload.self, from: metaData)
        guard let putURL = URL(string: info.uploadUrl) else {
            throw NexusError.network("Invalid upload URL from server")
        }

        // 2. PUT the bytes straight to GCS. No auth header; Content-Type MUST match
        //    what the signed URL was minted for.
        var put = URLRequest(url: putURL)
        put.httpMethod = "PUT"
        put.setValue(mimeType, forHTTPHeaderField: "Content-Type")
        let (putData, putResp) = try await withOneRetry { try await session.upload(for: put, from: data) }
        guard let http = putResp as? HTTPURLResponse else {
            throw NexusError.network("No response from storage")
        }
        guard (200...299).contains(http.statusCode) else {
            throw NexusError.server(errorMessage(from: putData) ?? "Upload failed (\(http.statusCode))")
        }
        return UploadResponse(url: info.url, mimeType: mimeType)
    }

    /// Runs `operation` once more if it throws. A signed upload URL is valid for
    /// 15 minutes, so a single retry on the same URL is safe for both legs of
    /// `uploadMediaDirect` (the mint request and the PUT).
    private func withOneRetry<T>(_ operation: () async throws -> T) async throws -> T {
        do {
            return try await operation()
        } catch is CancellationError {
            // The task (or its owning screen) was cancelled — e.g. the user
            // backgrounded the app or navigated away mid-upload. Retrying
            // would just race a second attempt against a caller that's gone.
            throw CancellationError()
        } catch {
            return try await operation()
        }
    }

    // MARK: - Scan jobs (durable async scans)

    /// Register uploaded media as a durable scan job. Idempotent per key: if the
    /// request is retried (or the app re-sends the same media after a drop or
    /// relaunch), the server returns the existing unconsumed job instead of
    /// scanning twice.
    func createScanJob(
        mediaUrl: String,
        mimeType: String,
        caption: String?,
        idempotencyKey: String,
        sessionId: String?,
        roomHint: String?
    ) async throws -> ScanJobDTO {
        var request = URLRequest(url: url(for: "/api/agents/nexus/scan-jobs"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&request)
        struct Body: Encodable {
            let mediaUrl: String
            let mimeType: String
            let caption: String?
            let idempotencyKey: String
            let sessionId: String?
            let roomHint: String?
        }
        request.httpBody = try encoder.encode(Body(
            mediaUrl: mediaUrl, mimeType: mimeType, caption: caption,
            idempotencyKey: idempotencyKey, sessionId: sessionId, roomHint: roomHint
        ))
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        return try decoder.decode(ScanJobDTO.self, from: data)
    }

    func scanJob(id: String) async throws -> ScanJobDTO {
        var request = URLRequest(url: url(for: "/api/agents/nexus/scan-jobs/\(id)"))
        addAuth(&request)
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        return try decoder.decode(ScanJobDTO.self, from: data)
    }

    /// Finished jobs the client hasn't shown yet — the reconnect/relaunch path.
    func unconsumedScanJobs() async throws -> [ScanJobDTO] {
        var request = URLRequest(url: url(for: "/api/agents/nexus/scan-jobs"))
        addAuth(&request)
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        return try decoder.decode(ScanJobListResponse.self, from: data).jobs
    }

    /// Tell the server this job's outcome reached the user (stop resurfacing it).
    func consumeScanJob(id: String) async throws {
        var request = URLRequest(url: url(for: "/api/agents/nexus/scan-jobs/\(id)/consume"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&request)
        request.httpBody = Data("{}".utf8)
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
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

    /// Outcome of a review-card commit. `skipped` is non-zero only when the exact
    /// same card was already committed (idempotency) — never a silent name-based drop.
    struct CommitOutcome { let added: Int; let skipped: Int; let failed: Int; let alreadyCommitted: Bool }

    /// Commit the items the user kept/edited in the review sheet. Sends the scan's
    /// opaque `scanId` so re-submitting the same card is idempotent (issue #43),
    /// and surfaces added/skipped/failed rather than silently dropping anything.
    func commitReviewedItems(_ items: [ReviewedItemPayload], room: String?, scanId: String?) async throws -> CommitOutcome {
        var request = URLRequest(url: url(for: "/api/agents/nexus/inventory/commit"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&request)
        struct Body: Encodable { let items: [ReviewedItemPayload]; let room: String?; let scanId: String? }
        request.httpBody = try encoder.encode(Body(items: items, room: room, scanId: scanId))
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        struct Resp: Decodable { let addedCount: Int?; let skippedCount: Int?; let failedCount: Int?; let alreadyCommitted: Bool? }
        let resp = try? decoder.decode(Resp.self, from: data)
        return CommitOutcome(
            added: resp?.addedCount ?? items.count,
            skipped: resp?.skippedCount ?? 0,
            failed: resp?.failedCount ?? 0,
            alreadyCommitted: resp?.alreadyCommitted ?? false
        )
    }

    /// Deterministically re-run vision analysis on an already-uploaded photo/video.
    /// Hits POST /rescan, which ALWAYS invokes the scan (unlike the chat path, where
    /// the agent could decline to re-analyze), and returns a fresh review card
    /// (with a new `scanId`, so its corrected items land on commit).
    func rescan(url mediaURL: String, mimeType: String, room: String?) async throws -> DetectedItemsReview {
        var request = URLRequest(url: url(for: "/api/agents/nexus/rescan"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&request)
        struct Body: Encodable { let url: String; let mimeType: String; let room: String? }
        request.httpBody = try encoder.encode(Body(url: mediaURL, mimeType: mimeType, room: room))
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        struct Resp: Decodable { let items: [DetectedItem]?; let mediaKind: String?; let room: String?; let scanId: String? }
        let resp = try decoder.decode(Resp.self, from: data)
        return DetectedItemsReview(
            mediaKind: resp.mediaKind ?? (mimeType.hasPrefix("video") ? "video" : "photo"),
            room: resp.room ?? room,
            items: resp.items ?? [],
            scanId: resp.scanId
        )
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
