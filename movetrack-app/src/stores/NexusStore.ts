import axios from "axios";
import { defineStore } from "pinia";
import { ref } from "vue";
import { inventoryStore } from "./InventoryStore";

export interface NexusAction {
  tool: string;
  args: Record<string, any>;
  result?: Record<string, any>;
}

export interface NexusMessage {
  id: number;
  role: "user" | "model";
  content: string;
  attachments?: { url: string; mimeType: string }[];
  actions?: NexusAction[];
  created_at: string;
}

export interface NexusSession {
  id: string;
  title: string | null;
  session_type: string;
  items_added: number;
  rooms_added: number;
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
  const sessions = ref<NexusSession[]>([]);
  const isLoading = ref(false);
  const isUploading = ref(false);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function sendMessage(text: string, attachments?: { url: string; mimeType: string }[]) {
    // Optimistic push of user message
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

    try {
      const headers = getHeaders();
      const res = await axios.post(
        core_url + "/nexus/message",
        {
          sessionId: sessionId.value,
          message: text,
          attachments: attachments || [],
        },
        { headers, timeout: 120000 } // 2 min timeout for LLM calls
      );

      sessionId.value = res.data.sessionId;

      // Push model reply
      const modelMsg: NexusMessage = {
        id: tempId + 1,
        role: "model",
        content: res.data.reply,
        actions: res.data.actions || [],
        created_at: new Date().toISOString(),
      };
      messages.value.push(modelMsg);

      // If items were added, refresh inventory in background
      const itemsAdded = (res.data.actions || []).filter(
        (a: NexusAction) => a.tool === "add_item" && a.result?.success
      );
      if (itemsAdded.length > 0) {
        const inv = inventoryStore();
        const userId = localStorage.getItem("user_id");
        if (userId) {
          inv.loadInventory(userId).catch(() => {});
        }
      }

      return res.data;
    } catch (err: any) {
      // Remove optimistic message on error
      messages.value = messages.value.filter((m) => m.id !== tempId);
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  async function uploadPhoto(file: File): Promise<{ url: string; mimeType: string }> {
    isUploading.value = true;
    try {
      const formData = new FormData();
      formData.append("file", file);

      const headers = {
        ...getHeaders(),
        "Content-Type": "multipart/form-data",
      };

      const res = await axios.post(core_url + "/nexus/upload", formData, {
        headers,
        timeout: 30000,
      });

      return { url: res.data.url, mimeType: res.data.mimeType };
    } finally {
      isUploading.value = false;
    }
  }

  async function loadSessions() {
    try {
      const headers = getHeaders();
      const res = await axios.get(core_url + "/nexus/sessions", { headers });
      sessions.value = res.data.sessions || [];
    } catch (err) {
      console.error("[NexusStore] loadSessions failed:", err);
    }
  }

  async function loadSession(id: string) {
    try {
      const headers = getHeaders();
      const res = await axios.get(core_url + `/nexus/sessions/${id}`, { headers });
      sessionId.value = id;
      messages.value = (res.data.messages || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachments: m.attachments || [],
        actions: m.actions || [],
        created_at: m.created_at,
      }));
    } catch (err) {
      console.error("[NexusStore] loadSession failed:", err);
    }
  }

  function startNewSession() {
    sessionId.value = null;
    messages.value = [];
  }

  async function deleteSession(id: string) {
    try {
      const headers = getHeaders();
      await axios.delete(core_url + `/nexus/sessions/${id}`, { headers });
      sessions.value = sessions.value.filter((s) => s.id !== id);
      if (sessionId.value === id) {
        startNewSession();
      }
    } catch (err) {
      console.error("[NexusStore] deleteSession failed:", err);
    }
  }

  return {
    messages,
    sessionId,
    sessions,
    isLoading,
    isUploading,
    sendMessage,
    uploadPhoto,
    loadSessions,
    loadSession,
    startNewSession,
    deleteSession,
  };
});
