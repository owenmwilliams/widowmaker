/**
 * Thin MCP client for the per-vendor agent server (W1a, issue #111) —
 * client #1 is the hero chat widget (issue #112).
 *
 * Contract (movetrack-api/docs/vendor-agent-mcp.md):
 *   - POST {API_BASE}/api/agent/{companyToken}/mcp
 *   - Stateless streamable-HTTP in JSON-response mode: every POST is
 *     self-contained, no session id, responses are plain JSON. A bare
 *     `tools/call` is allowed (initialize is optional), so this client
 *     never sends one — one round trip per tool.
 *   - Headers: Content-Type: application/json AND the double Accept —
 *     the transport negotiates content type and wants both.
 *   - Tool payloads ride in result.content[0].text as a JSON string;
 *     result.isError=true means the SAME slot carries an honest,
 *     user-showable error (code + error message).
 */
import { API_BASE_URL } from '../config/api'

/** A tool failure the vendor server worded for the customer (isError=true). */
export class McpToolError extends Error {
  code: string
  /** Copy safe to render in a chat bubble as-is. */
  userMessage: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'McpToolError'
    this.code = code
    this.userMessage = message
  }
}

/** Transport/protocol trouble — network down, 429, JSON-RPC error. Retryable. */
export class McpTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpTransportError'
  }
}

export type McpToolName =
  | 'get_company_info'
  | 'get_intake_questions'
  | 'price_quote'
  | 'reserve_booking'

let rpcId = 0

/**
 * Call one tool on a company's MCP server and return its parsed payload.
 *
 * Throws:
 *   - McpToolError      when result.isError is set (show `userMessage`);
 *   - McpTransportError for network failures / protocol errors (offer retry).
 */
export async function callTool<T = any>(
  companyToken: string,
  name: McpToolName,
  args: Record<string, unknown> = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/api/agent/${encodeURIComponent(companyToken)}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The transport negotiates content type — send BOTH accepts.
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
  } catch {
    throw new McpTransportError('Could not reach the server. Check your connection and try again.')
  }

  let rpc: any
  try {
    rpc = await res.json()
  } catch {
    throw new McpTransportError('The server sent back something unexpected. Please try again.')
  }

  if (rpc?.error) {
    // Protocol-level: unknown/inactive token (-32001), rate limit (-32000)…
    throw new McpTransportError(
      typeof rpc.error.message === 'string' && rpc.error.message
        ? rpc.error.message
        : 'Something went wrong talking to the server. Please try again.',
    )
  }

  const text = rpc?.result?.content?.[0]?.text
  if (typeof text !== 'string') {
    throw new McpTransportError('The server sent back something unexpected. Please try again.')
  }

  let payload: any
  try {
    payload = JSON.parse(text)
  } catch {
    throw new McpTransportError('The server sent back something unexpected. Please try again.')
  }

  if (rpc.result.isError) {
    // Honest, user-showable copy from the vendor server (#108 invariants).
    throw new McpToolError(
      typeof payload?.code === 'string' ? payload.code : 'tool_error',
      typeof payload?.error === 'string' && payload.error
        ? payload.error
        : 'That did not work. Please try again.',
    )
  }

  return payload as T
}
