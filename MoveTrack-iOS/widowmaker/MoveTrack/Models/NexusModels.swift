//
//  NexusModels.swift
//  Nexus Moves
//
//  Wire models for the native Nexus agent client. These mirror the contract the
//  web app uses (movetrack-app/src/stores/NexusStore.ts) so the native app talks
//  to the exact same endpoints:
//    GET    /api/agents/nexus/active-session
//    POST   /api/agents/nexus/message    (SSE)
//    POST   /api/agents/nexus/guidance   (SSE)
//    POST   /api/agents/nexus/upload     (multipart "file")
//    DELETE /api/agents/nexus/sessions/:id
//
//  All keys are already camelCase on the wire (url, mimeType, sessionId, …), so a
//  plain JSONDecoder is used — no snake_case conversion. Decoders are written
//  defensively (try? per field) so a server-side shape change can't wipe history
//  or drop the terminal "done" event.
//

import Foundation

// MARK: - Attachments

/// An attachment as stored/returned by the server (lenient: fields optional).
struct NexusAttachment: Codable, Hashable {
    let url: String?
    let mimeType: String?

    var isVideo: Bool { (mimeType ?? "").hasPrefix("video") }
    var displayLabel: String { isVideo ? "🎥 Video" : "📷 Photo" }
}

/// An attachment we send up with a message (both fields required).
///
/// `byteLength` is the size the client measured locally before upload — the
/// server compares it against what it actually downloads back out of GCS so a
/// truncated upload (client crash mid-PUT, dropped connection) fails loudly
/// instead of silently analyzing a partial file. See movetrack-api's
/// mediaDownloadService.downloadBuffer(`expectedBytes`).
struct OutgoingAttachment: Codable {
    let url: String
    let mimeType: String
    let byteLength: Int
}

// MARK: - Quick-start chips

struct QuickStartChip: Codable, Hashable, Identifiable {
    let label: String
    let message: String
    var id: String { label + "|" + message }
}

// MARK: - Session + history

struct NexusSessionDTO: Decodable {
    let id: String
}

/// One persisted message from the server. Decoded defensively.
struct NexusMessageDTO: Decodable {
    let role: String
    let content: String
    let attachments: [NexusAttachment]?
    /// Server-tagged rendering hint: "scan_review" marks the scan-completion
    /// marker row, rendered as a compact pill instead of a chat bubble.
    let kind: String?
    let scanCount: Int?

    enum CodingKeys: String, CodingKey { case role, content, attachments, kind, scanCount }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        role = (try? c.decode(String.self, forKey: .role)) ?? "model"
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        attachments = try? c.decode([NexusAttachment].self, forKey: .attachments)
        kind = try? c.decode(String.self, forKey: .kind)
        scanCount = try? c.decode(Int.self, forKey: .scanCount)
    }
}

struct ActiveSessionResponse: Decodable {
    let session: NexusSessionDTO?
    let messages: [NexusMessageDTO]
    let quickStartChips: [QuickStartChip]

    enum CodingKeys: String, CodingKey { case session, messages, quickStartChips }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        session = try? c.decode(NexusSessionDTO.self, forKey: .session)
        messages = (try? c.decode([NexusMessageDTO].self, forKey: .messages)) ?? []
        quickStartChips = (try? c.decode([QuickStartChip].self, forKey: .quickStartChips)) ?? []
    }
}

// MARK: - Upload

struct UploadResponse: Decodable {
    let url: String
    let mimeType: String
}

// MARK: - Share links

/// A share link as returned by POST/GET /shares (publicShare shape).
struct ShareDTO: Decodable {
    let token: String?
    let url: String?
    let revokedAt: String?
    let expiresAt: String?

    enum CodingKeys: String, CodingKey { case token, url, revokedAt, expiresAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        token = try? c.decode(String.self, forKey: .token)
        url = try? c.decode(String.self, forKey: .url)
        revokedAt = try? c.decode(String.self, forKey: .revokedAt)
        expiresAt = try? c.decode(String.self, forKey: .expiresAt)
    }

    /// We never set an expiry from the app, so "active" == not revoked.
    var isActive: Bool { revokedAt == nil && url != nil }
}

// MARK: - Share readiness (reasonableness check)

/// Returned by GET /shares/readiness. We only decode the reasonableness verdict
/// the app needs to warn before sharing an implausible inventory.
struct ShareReadinessDTO: Decodable {
    struct Reasonableness: Decodable {
        let hasBenchmark: Bool?
        let status: String?    // too_low | low | ok | high | too_high | unknown
        let severity: String?  // none | low | medium | high
        let message: String?

        enum CodingKeys: String, CodingKey { case hasBenchmark, status, severity, message }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            hasBenchmark = try? c.decode(Bool.self, forKey: .hasBenchmark)
            status = try? c.decode(String.self, forKey: .status)
            severity = try? c.decode(String.self, forKey: .severity)
            message = try? c.decode(String.self, forKey: .message)
        }
    }

    /// Which rooms still lack a walkthrough video and which large items lack a
    /// photo — powers the "see what's left" media checklist.
    struct MediaGaps: Decodable {
        struct RoomGap: Decodable {
            let room: String?
            let itemCount: Int?
            enum CodingKeys: String, CodingKey { case room, itemCount }
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                room = try? c.decode(String.self, forKey: .room)
                itemCount = try? c.decode(Int.self, forKey: .itemCount)
            }
        }
        struct ItemGap: Decodable {
            let room: String?
            let items: [String]?
            enum CodingKeys: String, CodingKey { case room, items }
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                room = try? c.decode(String.self, forKey: .room)
                items = try? c.decode([String].self, forKey: .items)
            }
        }
        let roomsMissingVideo: [RoomGap]?
        let largeItemsMissingPhoto: [ItemGap]?
        enum CodingKeys: String, CodingKey { case roomsMissingVideo, largeItemsMissingPhoto }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            roomsMissingVideo = try? c.decode([RoomGap].self, forKey: .roomsMissingVideo)
            largeItemsMissingPhoto = try? c.decode([ItemGap].self, forKey: .largeItemsMissingPhoto)
        }
    }

    let overall: Int?
    let status: String?          // ready | almost_ready | in_progress | early | not_started
    let summary: String?
    let nextSteps: [String]?
    let reasonableness: Reasonableness?
    let mediaGaps: MediaGaps?

    enum CodingKeys: String, CodingKey { case overall, status, summary, nextSteps, reasonableness, mediaGaps }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        overall = try? c.decode(Int.self, forKey: .overall)
        status = try? c.decode(String.self, forKey: .status)
        summary = try? c.decode(String.self, forKey: .summary)
        nextSteps = try? c.decode([String].self, forKey: .nextSteps)
        reasonableness = try? c.decode(Reasonableness.self, forKey: .reasonableness)
        mediaGaps = try? c.decode(MediaGaps.self, forKey: .mediaGaps)
    }

    /// A message to warn the user with before sharing, or nil if it looks fine.
    /// Warn-but-allow: we only surface high-severity issues.
    var shareWarning: String? {
        guard let r = reasonableness, r.hasBenchmark == true, r.severity == "high" else { return nil }
        return r.message
    }

    var progress: Double { Double(max(0, min(100, overall ?? 0))) / 100.0 }

    var statusLabel: String {
        switch status {
        case "ready": return "Ready to share"
        case "almost_ready": return "Almost ready"
        case "in_progress": return "In progress"
        case "early": return "Just getting started"
        default: return "Let's get started"
        }
    }
}

// MARK: - SSE stream events

/// The result of a tool the orchestrator ran (we only care about share URLs).
struct NexusActionResult: Decodable {
    let url: String?
    let success: Bool?

    enum CodingKeys: String, CodingKey { case url, success }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        url = try? c.decode(String.self, forKey: .url)
        success = try? c.decode(Bool.self, forKey: .success)
    }
}

struct NexusActionDTO: Decodable {
    let tool: String?
    let result: NexusActionResult?

    enum CodingKeys: String, CodingKey { case tool, result }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tool = try? c.decode(String.self, forKey: .tool)
        result = try? c.decode(NexusActionResult.self, forKey: .result)
    }
}

/// A single Server-Sent Event from /message or /guidance. Every field is decoded
/// with `try?` so a malformed intermediate event (or an unexpected `actions`
/// payload on the terminal `done` event) can never break the stream.
struct SSEEvent: Decodable {
    let type: String?
    let phase: String?
    let source: String?
    let delegationTarget: String?
    let hasAttachments: Bool?
    let label: String?
    let detail: String?
    let tool: String?
    let success: Bool?
    let text: String?       // partial_reply
    let reply: String?      // done
    let sessionId: String?  // done
    let error: String?      // error
    let actions: [NexusActionDTO]?
    let detectedItems: [DetectedItem]?    // detected_items ("items")
    let mediaKind: String?                // detected_items ("video"|"photo")
    let room: String?                     // detected_items
    let scanId: String?                   // detected_items (opaque per-scan id)
    let duplicatePairs: [DuplicatePair]?  // duplicate_pairs ("pairs")

    enum CodingKeys: String, CodingKey {
        case type, phase, source, delegationTarget, hasAttachments
        case label, detail, tool, success, text, reply, sessionId, error, actions
        case detectedItems = "items", mediaKind, room, scanId, duplicatePairs = "pairs"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func str(_ k: CodingKeys) -> String? { try? c.decode(String.self, forKey: k) }
        func bool(_ k: CodingKeys) -> Bool? { try? c.decode(Bool.self, forKey: k) }
        type = str(.type)
        phase = str(.phase)
        source = str(.source)
        delegationTarget = str(.delegationTarget)
        hasAttachments = bool(.hasAttachments)
        label = str(.label)
        detail = str(.detail)
        tool = str(.tool)
        success = bool(.success)
        text = str(.text)
        reply = str(.reply)
        sessionId = str(.sessionId)
        error = str(.error)
        actions = try? c.decode([NexusActionDTO].self, forKey: .actions)
        detectedItems = try? c.decode([DetectedItem].self, forKey: .detectedItems)
        mediaKind = str(.mediaKind)
        room = str(.room)
        scanId = str(.scanId)
        duplicatePairs = try? c.decode([DuplicatePair].self, forKey: .duplicatePairs)
    }
}

// MARK: - Review cards (detected items + duplicates)

/// One item detected by a photo/video scan, surfaced for interactive review.
/// Fields are mutable so the review sheet can edit name/quantity/keep in place.
struct DetectedItem: Decodable, Identifiable, Equatable {
    var id = UUID()
    var name: String
    var quantity: Int
    var room: String?
    var pictureUrl: String?
    var weightLbs: Double?
    var lengthIn: Double?
    var widthIn: Double?
    var heightIn: Double?
    var material: String?
    var fragile: Bool
    var confidence: Double?
    var keep: Bool = true    // review state — not from the wire

    enum CodingKeys: String, CodingKey {
        case name, quantity, room, pictureUrl, weightLbs, lengthIn, widthIn, heightIn, material, fragile, confidence
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = (try? c.decode(String.self, forKey: .name)) ?? "Item"
        quantity = (try? c.decode(Int.self, forKey: .quantity)) ?? 1
        room = try? c.decode(String.self, forKey: .room)
        pictureUrl = try? c.decode(String.self, forKey: .pictureUrl)
        weightLbs = try? c.decode(Double.self, forKey: .weightLbs)
        lengthIn = try? c.decode(Double.self, forKey: .lengthIn)
        widthIn = try? c.decode(Double.self, forKey: .widthIn)
        heightIn = try? c.decode(Double.self, forKey: .heightIn)
        material = try? c.decode(String.self, forKey: .material)
        fragile = (try? c.decode(Bool.self, forKey: .fragile)) ?? false
        confidence = try? c.decode(Double.self, forKey: .confidence)
    }

    /// A short "84×36×34 in · 150 lb" style spec line, or nil if we know nothing.
    var specLine: String? {
        // Treat 0 as unknown: a "0\u{00D7}0\u{00D7}0 in \u{00B7} 0 lb" row reads as data, and
        // wrong-but-confident costs more trust than absent.
        var parts: [String] = []
        if let l = lengthIn, let w = widthIn, let h = heightIn, l > 0, w > 0, h > 0 {
            parts.append("\(Int(l))\u{00D7}\(Int(w))\u{00D7}\(Int(h)) in")
        }
        if let wt = weightLbs, wt > 0 { parts.append("\(Int(wt)) lb") }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }
}

/// The shape POST /api/agents/nexus/inventory/commit expects for a reviewed item.
struct ReviewedItemPayload: Encodable {
    let name: String
    let quantity: Int
    let room: String?
    let pictureUrl: String?
    let weightLbs: Double?
    let lengthIn: Double?
    let widthIn: Double?
    let heightIn: Double?
    let material: String?
    let fragile: Bool
    let confidence: Double?

    init(from item: DetectedItem, fallbackRoom: String?) {
        name = item.name.trimmingCharacters(in: .whitespacesAndNewlines)
        quantity = max(1, item.quantity)
        let itemRoom = item.room?.trimmingCharacters(in: .whitespacesAndNewlines)
        room = (itemRoom?.isEmpty == false) ? itemRoom : fallbackRoom
        pictureUrl = item.pictureUrl
        weightLbs = item.weightLbs
        lengthIn = item.lengthIn
        widthIn = item.widthIn
        heightIn = item.heightIn
        material = item.material
        fragile = item.fragile
        confidence = item.confidence
    }
}

/// A potential duplicate pair from find_duplicates, for interactive review.
struct DuplicatePair: Decodable, Identifiable, Equatable {
    var id = UUID()
    let itemA: DupItem
    let itemB: DupItem
    let similarity: Double?

    struct DupItem: Decodable, Equatable {
        let id: Int
        let name: String?
        let room: String?
        let quantity: Int?

        enum CodingKeys: String, CodingKey { case id, name, room, quantity }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = (try? c.decode(Int.self, forKey: .id)) ?? -1
            name = try? c.decode(String.self, forKey: .name)
            room = try? c.decode(String.self, forKey: .room)
            quantity = try? c.decode(Int.self, forKey: .quantity)
        }
    }

    enum CodingKeys: String, CodingKey { case itemA, itemB, similarity }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        itemA = try c.decode(DupItem.self, forKey: .itemA)
        itemB = try c.decode(DupItem.self, forKey: .itemB)
        similarity = try? c.decode(Double.self, forKey: .similarity)
    }
}

/// Drives the native review sheet after a scan (Identifiable for `.sheet(item:)`).
struct DetectedItemsReview: Identifiable {
    let id = UUID()
    let mediaKind: String   // "video" | "photo"
    let room: String?
    var items: [DetectedItem]
    /// Opaque per-scan id from the server; sent back on commit so re-submitting
    /// the same card is idempotent while a rescan's corrected items still land.
    var scanId: String? = nil
    /// Backing scan job, when this card came from the durable job flow. The
    /// job is consumed when the user closes the card (commit or dismiss) —
    /// never merely for displaying it.
    var jobId: String? = nil
    /// The chat pill representing this scan; flipped to reviewed/dismissed
    /// when the card closes.
    var pillId: UUID? = nil
}

/// Drives the native duplicate-review sheet (Identifiable for `.sheet(item:)`).
struct DuplicateReview: Identifiable {
    let id = UUID()
    var pairs: [DuplicatePair]
}

// MARK: - Scan jobs (durable async scans)

/// A durable scan job (`/api/agents/nexus/scan-jobs`). The scan runs server-side
/// off the request path; the client polls this record and materializes the
/// review card from `result`, so a scan survives connection drops, app
/// backgrounding, and even an app relaunch.
struct ScanJobDTO: Decodable {
    let id: String
    let status: String        // "queued" | "processing" | "completed" | "failed"
    let stage: String?
    let mediaKind: String?    // "photo" | "video"
    let mediaUrl: String?
    let roomHint: String?
    let caption: String?
    let result: ScanJobResult?
    let error: String?

    var isTerminal: Bool { status == "completed" || status == "failed" }
}

/// The `result` payload of a completed scan job — the same shape as the
/// `detected_items` SSE event, so it decodes into the same review card.
struct ScanJobResult: Decodable {
    let mediaKind: String?
    let room: String?
    let items: [DetectedItem]?
}

struct ScanJobListResponse: Decodable {
    let jobs: [ScanJobDTO]
}

// MARK: - Errors

enum NexusError: Error {
    case unauthorized
    case server(String)
    case network(String)

    var userMessage: String {
        switch self {
        case .unauthorized: return "Your session expired. Please log in again."
        case .server(let m): return m
        case .network(let m): return m
        }
    }
}

// MARK: - UI message model

/// What the chat view renders. Distinct from the wire DTO so we can hold
/// optimistic (not-yet-persisted) messages and locally-created replies.
struct ChatMessage: Identifiable, Equatable {
    enum Role { case user, model }

    /// The review modal IS the response to a scan; the chat keeps a compact
    /// pill artifact of it instead of a prose bubble.
    enum ScanReviewState: Equatable {
        case pending(count: Int)                 // card is up, undecided
        case reviewed(added: Int, skipped: Int)  // committed from the card
        case dismissed(count: Int)               // closed without adding
        case record(count: Int)                  // reloaded from the transcript
    }
    enum Kind: Equatable {
        case text
        case scanReview(ScanReviewState)
    }

    let id: UUID
    let role: Role
    let text: String
    let attachments: [NexusAttachment]
    var kind: Kind = .text

    init(role: Role, text: String, attachments: [NexusAttachment] = [], kind: Kind = .text) {
        self.id = UUID()
        self.role = role
        self.text = text
        self.attachments = attachments
        self.kind = kind
    }

    init(from dto: NexusMessageDTO) {
        self.id = UUID()
        self.role = (dto.role == "user") ? .user : .model
        self.text = dto.content
        self.attachments = dto.attachments ?? []
        self.kind = (dto.kind == "scan_review")
            ? .scanReview(.record(count: dto.scanCount ?? 0))
            : .text
    }
}
