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
struct OutgoingAttachment: Codable {
    let url: String
    let mimeType: String
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

    enum CodingKeys: String, CodingKey { case role, content, attachments }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        role = (try? c.decode(String.self, forKey: .role)) ?? "model"
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        attachments = try? c.decode([NexusAttachment].self, forKey: .attachments)
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

    let overall: Int?
    let status: String?          // ready | almost_ready | in_progress | early | not_started
    let summary: String?
    let nextSteps: [String]?
    let reasonableness: Reasonableness?

    enum CodingKeys: String, CodingKey { case overall, status, summary, nextSteps, reasonableness }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        overall = try? c.decode(Int.self, forKey: .overall)
        status = try? c.decode(String.self, forKey: .status)
        summary = try? c.decode(String.self, forKey: .summary)
        nextSteps = try? c.decode([String].self, forKey: .nextSteps)
        reasonableness = try? c.decode(Reasonableness.self, forKey: .reasonableness)
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

    enum CodingKeys: String, CodingKey {
        case type, phase, source, delegationTarget, hasAttachments
        case label, detail, tool, success, text, reply, sessionId, error, actions
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
    }
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
    let id: UUID
    let role: Role
    let text: String
    let attachments: [NexusAttachment]

    init(role: Role, text: String, attachments: [NexusAttachment] = []) {
        self.id = UUID()
        self.role = role
        self.text = text
        self.attachments = attachments
    }

    init(from dto: NexusMessageDTO) {
        self.id = UUID()
        self.role = (dto.role == "user") ? .user : .model
        self.text = dto.content
        self.attachments = dto.attachments ?? []
    }
}
