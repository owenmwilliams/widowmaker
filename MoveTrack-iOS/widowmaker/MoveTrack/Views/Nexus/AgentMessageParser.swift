//
//  AgentMessageParser.swift
//  Nexus Moves
//
//  Parses the agent's inline `[BUTTONS]…[/BUTTONS]` blocks into tappable buttons
//  and strips them (plus [IMG:…] tokens) from the displayed prose. Mirrors the
//  web contract in movetrack-app/src/components/nexus/NexusChat.vue:
//
//    [BUTTONS]
//    Label|message to send|actions
//    [/BUTTONS]
//
//  actions ∈ {send, prefill, camera} (optional; inferred when omitted).
//

import Foundation

enum AgentButtonAction {
    case send     // send `message` as a user message immediately
    case prefill  // drop `message` into the input for the user to complete
    case camera   // open the camera, using `message` as the caption
}

struct AgentButton: Identifiable {
    let id = UUID()
    let label: String
    let message: String
    let actions: [AgentButtonAction]

    /// The single action we act on (priority: prefill > camera > send), matching
    /// the web's handleButtonClick precedence.
    var primaryAction: AgentButtonAction {
        if actions.contains(where: { if case .prefill = $0 { return true }; return false }) { return .prefill }
        if actions.contains(where: { if case .camera = $0 { return true }; return false }) { return .camera }
        return .send
    }
}

struct ParsedAgentMessage {
    let prose: String
    let buttons: [AgentButton]
}

enum AgentMessageParser {
    static func parse(_ content: String) -> ParsedAgentMessage {
        ParsedAgentMessage(prose: prose(content), buttons: buttons(content))
    }

    // MARK: - Buttons

    static func buttons(_ content: String) -> [AgentButton] {
        guard let inner = firstGroup(pattern: "\\[buttons\\]([\\s\\S]*?)\\[/buttons\\]", in: content) else {
            return []
        }
        return inner.split(separator: "\n").compactMap { rawLine -> AgentButton? in
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            guard line.contains("|") else { return nil }
            let parts = line.components(separatedBy: "|")
            let label = parts[0].trimmingCharacters(in: .whitespaces)
            let lastPart = (parts.last ?? "").trimmingCharacters(in: .whitespaces)
            let looksLikeActions = parts.count >= 3
                && lastPart.count < 30
                && lastPart.range(of: "^[a-z, ]+$", options: [.regularExpression, .caseInsensitive]) != nil

            let messageParts = looksLikeActions ? Array(parts[1..<(parts.count - 1)]) : Array(parts[1...])
            let message = messageParts.joined(separator: "|").trimmingCharacters(in: .whitespaces)
            let explicit = looksLikeActions ? parseActions(lastPart) : []
            let actions = explicit.isEmpty ? inferActions(message) : explicit

            guard !label.isEmpty, !message.isEmpty else { return nil }
            return AgentButton(label: label, message: message, actions: actions)
        }
    }

    private static func parseActions(_ raw: String) -> [AgentButtonAction] {
        raw.lowercased().split(whereSeparator: { $0 == "," || $0 == " " }).compactMap { token in
            switch token.replacingOccurrences(of: "[^a-z]", with: "", options: .regularExpression) {
            case "send": return .send
            case "prefill": return .prefill
            case "camera": return .camera
            default: return nil
            }
        }
    }

    private static func inferActions(_ message: String) -> [AgentButtonAction] {
        let lower = message.lowercased()
        if lower.range(of: "\\b(scan|photo|video|camera|snap|picture|image)\\b", options: .regularExpression) != nil {
            return [.camera]
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix(":") {
            return [.prefill]
        }
        return [.send]
    }

    // MARK: - Prose

    static func prose(_ content: String) -> String {
        var s = content
        s = replacing("\\[buttons\\][\\s\\S]*?\\[/buttons\\]", in: s, with: "")
        s = replacing("\\[img:[^\\]]+\\]", in: s, with: "")
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Regex helpers

    private static func firstGroup(pattern: String, in s: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let ns = s as NSString
        guard let m = re.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)), m.numberOfRanges >= 2 else {
            return nil
        }
        return ns.substring(with: m.range(at: 1))
    }

    private static func replacing(_ pattern: String, in s: String, with t: String) -> String {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return s }
        let ns = s as NSString
        return re.stringByReplacingMatches(in: s, range: NSRange(location: 0, length: ns.length), withTemplate: t)
    }
}
