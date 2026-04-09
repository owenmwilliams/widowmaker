import axios from "axios";
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { inventoryStore } from "./InventoryStore";

export interface NexusAction {
  tool: string;
  args: Record<string, any>;
  result?: Record<string, any>;
}

export interface ActivityStep {
  tool: string;
  label: string;
  detail: string;
  source: string; // 'orchestrator' | 'census' | 'vector'
  status: "running" | "done" | "failed";
  resultSummary?: Record<string, any>;
  timestamp: number;
}

export interface NexusMessage {
  id: number;
  role: "user" | "model";
  content: string;
  attachments?: { url: string; mimeType: string }[];
  actions?: NexusAction[];
  activitySteps?: ActivityStep[];
  created_at: string;
}

export interface QuickStartChip {
  label: string;
  message: string;
}

export interface NexusSession {
  id: string;
  title: string | null;
  session_type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const nexusStore = defineStore("nexus", () => {
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

  const messages = ref<NexusMessage[]>([]);
  const sessionId = ref<string | null>(null);
  const session = ref<NexusSession | null>(null);
  const isLoading = ref(false);
  const isUploading = ref(false);
  const quickStartChips = ref<QuickStartChip[]>([]);
  const guidanceRequestedThisSession = ref(false);

  // Phase-aware status (replaces old single statusText)
  const phaseText = ref("");
  const detailText = ref("");
  const activitySteps = ref<ActivityStep[]>([]);

  // Backward-compatible alias
  const statusText = computed(() => phaseText.value);

  // ── Detail Queue (minimum display time) ─────────────────────────────────

  const DETAIL_MIN_MS = 800;
  const _detailQueue: string[] = [];
  let _detailTimer: ReturnType<typeof setTimeout> | null = null;
  let _detailShownAt = 0;

  function pushDetail(text: string) {
    if (!text) return;
    const now = Date.now();
    const elapsed = now - _detailShownAt;

    if (elapsed >= DETAIL_MIN_MS || !detailText.value) {
      detailText.value = text;
      _detailShownAt = now;
    } else {
      _detailQueue.push(text);
      if (!_detailTimer) {
        _detailTimer = setTimeout(drainDetailQueue, DETAIL_MIN_MS - elapsed);
      }
    }
  }

  function drainDetailQueue() {
    _detailTimer = null;
    if (_detailQueue.length > 0) {
      detailText.value = _detailQueue.shift()!;
      _detailShownAt = Date.now();
      if (_detailQueue.length > 0) {
        _detailTimer = setTimeout(drainDetailQueue, DETAIL_MIN_MS);
      }
    }
  }

  function resetStatus() {
    phaseText.value = "";
    detailText.value = "";
    activitySteps.value = [];
    _detailQueue.length = 0;
    if (_detailTimer) {
      clearTimeout(_detailTimer);
      _detailTimer = null;
    }
  }

  // ── SSE Event Handler ───────────────────────────────────────────────────

  function handleSSEEvent(event: any, defaultPhase: string) {
    switch (event.type) {
      case "thinking": {
        const phase = event.phase || "initial";
        if (phase === "finalizing") {
          phaseText.value = "Putting it together\u2026";
        } else if (!phaseText.value || phase === "initial") {
          phaseText.value = defaultPhase;
        }
        // Don't reset phaseText mid-delegation — this prevents flashing
        break;
      }
      case "tool_call": {
        // Update phase line only for orchestrator-level delegation events
        if (event.source === "orchestrator" && event.phase === "delegation") {
          const target = event.delegationTarget;
          if (target === "census" && event.hasAttachments) {
            phaseText.value = "Scanning your photo\u2026";
          } else if (target === "census") {
            phaseText.value = "Working on your inventory\u2026";
          } else if (target === "vector") {
            phaseText.value = "Planning your move\u2026";
          } else {
            phaseText.value = event.label || "Working\u2026";
          }
        } else if (event.source === "orchestrator") {
          // Non-delegation orchestrator tool (set_location, etc.)
          phaseText.value = event.label || "Working\u2026";
        }

        // Update detail line for specialist tool calls (not orchestrator-level)
        if (event.source !== "orchestrator") {
          const detailStr = event.detail
            ? `${event.label}: ${event.detail}`
            : event.label || event.tool;
          pushDetail(detailStr);
        }

        // Backward compat: if no source field, update phase directly
        if (!event.source) {
          phaseText.value = event.label || event.tool || "Working\u2026";
        }

        // Add to activity log
        activitySteps.value.push({
          tool: event.tool,
          label: event.label || event.tool.replace(/_/g, " "),
          detail: event.detail || "",
          source: event.source || "unknown",
          status: "running",
          timestamp: Date.now(),
        });
        break;
      }
      case "tool_result": {
        // Mark the matching step as done/failed
        const step = [...activitySteps.value]
          .reverse()
          .find((s) => s.tool === event.tool && s.status === "running");
        if (step) {
          step.status = event.success ? "done" : "failed";
          if (event.resultSummary) step.resultSummary = event.resultSummary;
        }

        // Surface interesting result info in the detail line
        if (event.resultSummary?.itemCount) {
          pushDetail(`Found ${event.resultSummary.itemCount} items`);
        }
        break;
      }
      case "partial_reply": {
        const partialMsg: NexusMessage = {
          id: Date.now(),
          role: "model",
          content: event.text,
          actions: [],
          created_at: new Date().toISOString(),
        };
        messages.value.push(partialMsg);
        break;
      }
      case "error":
        throw new Error(event.error);
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function loadActiveSession() {
    try {
      const headers = getHeaders();
      const res = await axios.get(core_url + "/api/agents/nexus/active-session", {
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
      return res.data.guidance || null;
    } catch (err) {
      console.error("[NexusStore] loadActiveSession failed:", err);
      return null;
    }
  }

  async function requestGuidance() {
    if (guidanceRequestedThisSession.value) return;
    guidanceRequestedThisSession.value = true;

    isLoading.value = true;
    phaseText.value = "Catching up\u2026";

    try {
      const headers = getHeaders();
      const response = await fetch(core_url + "/api/agents/nexus/guidance", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || "Guidance request failed");
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
            if (event.type === "done") {
              result = event;
            } else {
              handleSSEEvent(event, "Catching up\u2026");
            }
          } catch (parseErr: any) {
            if (parseErr.message && !parseErr.message.includes("JSON"))
              throw parseErr;
          }
        }
      }

      if (!result) throw new Error("Stream ended without result");

      sessionId.value = result.sessionId;

      const modelMsg: NexusMessage = {
        id: Date.now(),
        role: "model",
        content: result.reply,
        actions: result.actions || [],
        activitySteps: activitySteps.value.length >= 2
          ? [...activitySteps.value]
          : undefined,
        created_at: new Date().toISOString(),
      };
      messages.value.push(modelMsg);

      if (result.quickStartChips) {
        quickStartChips.value = result.quickStartChips;
      }
    } catch (err: any) {
      console.error("[NexusStore] requestGuidance failed:", err);
    } finally {
      isLoading.value = false;
      resetStatus();
    }
  }

  async function sendMessage(
    text: string,
    attachments?: { url: string; mimeType: string }[],
  ) {
    const tempId = Date.now();
    const userMsg: NexusMessage = {
      id: tempId,
      role: "user",
      content: text,
      attachments: attachments || [],
      created_at: new Date().toISOString(),
    };
    messages.value.push(userMsg);
    isLoading.value = true;
    phaseText.value = "Thinking\u2026";

    try {
      const headers = getHeaders();
      const response = await fetch(core_url + "/api/agents/nexus/message", {
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
            if (event.type === "done") {
              result = event;
            } else {
              handleSSEEvent(event, "Thinking\u2026");
            }
          } catch (parseErr: any) {
            if (parseErr.message && !parseErr.message.includes("JSON"))
              throw parseErr;
          }
        }
      }

      if (!result) throw new Error("Stream ended without result");

      sessionId.value = result.sessionId;

      const modelMsg: NexusMessage = {
        id: tempId + 1,
        role: "model",
        content: result.reply,
        actions: result.actions || [],
        activitySteps: activitySteps.value.length >= 2
          ? [...activitySteps.value]
          : undefined,
        created_at: new Date().toISOString(),
      };
      messages.value.push(modelMsg);

      // If items were added/deleted (via Census delegation), refresh inventory
      const inventoryChanged = (result.actions || []).some(
        (a: NexusAction) =>
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
      messages.value = messages.value.filter((m) => m.id !== tempId);
      throw err;
    } finally {
      isLoading.value = false;
      resetStatus();
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

      const res = await axios.post(core_url + "/api/agents/nexus/upload", formData, {
        headers,
        timeout: 120000,
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
      await axios.delete(core_url + `/api/agents/nexus/sessions/${sessionId.value}`, {
        headers,
      });
      session.value = null;
      sessionId.value = null;
      messages.value = [];
      guidanceRequestedThisSession.value = false;
    } catch (err) {
      console.error("[NexusStore] clearConversation failed:", err);
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
    phaseText,
    detailText,
    activitySteps,
    sendMessage,
    uploadPhoto,
    loadActiveSession,
    requestGuidance,
    clearConversation,
  };
});
