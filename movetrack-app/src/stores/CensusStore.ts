import axios from "axios";
import { defineStore } from "pinia";
import { ref } from "vue";
import { inventoryStore } from "./InventoryStore";

export interface CensusAction {
  tool: string;
  args: Record<string, any>;
  result?: Record<string, any>;
}

export interface CensusMessage {
  id: number;
  role: "user" | "model";
  content: string;
  attachments?: { url: string; mimeType: string }[];
  actions?: CensusAction[];
  created_at: string;
}

export interface QuickStartChip {
  label: string;
  message: string;
}

export interface CensusSession {
  id: string;
  title: string | null;
  session_type: string;
  items_added: number;
  rooms_added: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const censusStore = defineStore("census", () => {
  const core_url =
    import.meta.env.MODE == "development"
      ? "http://localhost:3050"
      : "https://movetrack-api-7hwn7ggbiq-uc.a.run.app";

  function getHeaders(): Record<string, string> {
    const sessionToken = localStorage.getItem("session_token");
    if (sessionToken) {
      return { Authorization: "Bearer " + sessionToken };
    }
    return {};
  }

  // ── State ──────────────────────────────────────────────────────────────────

  const messages = ref<CensusMessage[]>([]);
  const sessionId = ref<string | null>(null);
  const session = ref<CensusSession | null>(null);
  const isLoading = ref(false);
  const isUploading = ref(false);
  const quickStartChips = ref<QuickStartChip[]>([]);
  const statusText = ref("");
  const shouldAutoGreet = ref(false);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function loadActiveSession() {
    try {
      const headers = getHeaders();
      const res = await axios.get(core_url + "/api/agents/census/active-session", {
        headers,
      });
      if (res.data.session) {
        session.value = res.data.session;
        sessionId.value = res.data.session.id;
        messages.value = (res.data.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          attachments: m.attachments || [],
          actions: m.actions || [],
          created_at: m.created_at,
        }));
      } else {
        session.value = null;
        sessionId.value = null;
        messages.value = [];
      }
      quickStartChips.value = res.data.quickStartChips || [];
      shouldAutoGreet.value = !!res.data.shouldAutoGreet;
    } catch (err) {
      console.error("[CensusStore] loadActiveSession failed:", err);
    }
  }

  async function sendMessage(
    text: string,
    attachments?: { url: string; mimeType: string }[],
  ) {
    // Optimistic push of user message
    const tempId = Date.now();
    const clientRequestStart = Date.now();
    let ttfeClientMs: number | null = null;
    const userMsg: CensusMessage = {
      id: tempId,
      role: "user",
      content: text,
      attachments: attachments || [],
      created_at: new Date().toISOString(),
    };
    messages.value.push(userMsg);
    isLoading.value = true;
    statusText.value = "Thinking…";

    try {
      const headers = getHeaders();
      const response = await fetch(core_url + "/api/agents/census/message", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message: text,
          attachments: attachments || [],
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const err: any = new Error(errBody.error || "Request failed");
        err.response = { status: response.status };
        throw err;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            // Capture time to first SSE event
            if (ttfeClientMs === null) {
              ttfeClientMs = Date.now() - clientRequestStart;
              console.log(`[perf] TTFE (client): ${ttfeClientMs}ms`);
            }

            switch (event.type) {
              case "thinking":
                statusText.value = "Thinking…";
                break;
              case "tool_call":
                statusText.value = event.label || event.tool || "Working…";
                break;
              case "tool_result":
                // Brief flash — next event will update
                break;
              case "done":
                result = event;
                console.log(
                  `[perf] Round-trip: ${Date.now() - clientRequestStart}ms`,
                );
                break;
              case "error":
                throw new Error(event.error);
            }
          } catch (parseErr: any) {
            if (parseErr.message && !parseErr.message.includes("JSON"))
              throw parseErr;
          }
        }
      }

      if (!result) throw new Error("Stream ended without result");

      sessionId.value = result.sessionId;

      const modelMsg: CensusMessage = {
        id: tempId + 1,
        role: "model",
        content: result.reply,
        actions: result.actions || [],
        created_at: new Date().toISOString(),
      };
      messages.value.push(modelMsg);

      // If items were added/deleted, refresh inventory in background
      const inventoryChanged = (result.actions || []).some(
        (a: CensusAction) =>
          (a.tool === "add_item" || a.tool === "delete_item") &&
          a.result?.success,
      );
      if (inventoryChanged) {
        const inv = inventoryStore();
        const userId = localStorage.getItem("user_id");
        if (userId) {
          inv.loadInventory(userId).catch(() => {});
        }
      }

      return result;
    } catch (err: any) {
      // Remove optimistic message on error
      messages.value = messages.value.filter((m) => m.id !== tempId);
      throw err;
    } finally {
      isLoading.value = false;
      statusText.value = "";
    }
  }

  async function uploadPhoto(
    file: File,
  ): Promise<{ url: string; mimeType: string }> {
    isUploading.value = true;
    try {
      const formData = new FormData();
      formData.append("file", file);

      const headers = {
        ...getHeaders(),
        "Content-Type": "multipart/form-data",
      };

      const res = await axios.post(core_url + "/api/agents/census/upload", formData, {
        headers,
        timeout: 120000, // 2 min for large video uploads
      });

      return { url: res.data.url, mimeType: res.data.mimeType };
    } finally {
      isUploading.value = false;
    }
  }

  async function clearConversation() {
    if (!sessionId.value) return;
    try {
      const headers = getHeaders();
      await axios.delete(core_url + `/api/agents/census/sessions/${sessionId.value}`, {
        headers,
      });
      // Reset to welcome state — next message creates a fresh session
      session.value = null;
      sessionId.value = null;
      messages.value = [];
    } catch (err) {
      console.error("[CensusStore] clearConversation failed:", err);
    }
  }

  return {
    messages,
    sessionId,
    session,
    isLoading,
    isUploading,
    quickStartChips,
    statusText,
    shouldAutoGreet,
    sendMessage,
    uploadPhoto,
    loadActiveSession,
    clearConversation,
  };
});
