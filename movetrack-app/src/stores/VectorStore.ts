import axios from "axios";
import { defineStore } from "pinia";
import { ref } from "vue";

export interface VectorAction {
  tool: string;
  args: Record<string, any>;
  result?: Record<string, any>;
}

export interface VectorMessage {
  id: number;
  role: "user" | "model";
  content: string;
  actions?: VectorAction[];
  created_at: string;
}

export interface VectorSession {
  id: string;
  title: string | null;
  session_type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const vectorStore = defineStore("vector", () => {
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

  const messages = ref<VectorMessage[]>([]);
  const sessionId = ref<string | null>(null);
  const session = ref<VectorSession | null>(null);
  const isLoading = ref(false);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function loadActiveSession() {
    try {
      const headers = getHeaders();
      const res = await axios.get(core_url + "/vector/active-session", {
        headers,
      });
      if (res.data.session) {
        session.value = res.data.session;
        sessionId.value = res.data.session.id;
        messages.value = (res.data.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          actions: m.actions || [],
          created_at: m.created_at,
        }));
      } else {
        session.value = null;
        sessionId.value = null;
        messages.value = [];
      }
    } catch (err) {
      console.error("[VectorStore] loadActiveSession failed:", err);
    }
  }

  async function sendMessage(text: string) {
    const tempId = Date.now();
    const userMsg: VectorMessage = {
      id: tempId,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    messages.value.push(userMsg);
    isLoading.value = true;

    try {
      const headers = getHeaders();
      const res = await axios.post(
        core_url + "/vector/message",
        { message: text },
        { headers, timeout: 180000 },
      );

      sessionId.value = res.data.sessionId;

      const modelMsg: VectorMessage = {
        id: tempId + 1,
        role: "model",
        content: res.data.reply,
        actions: res.data.actions || [],
        created_at: new Date().toISOString(),
      };
      messages.value.push(modelMsg);

      return res.data;
    } catch (err: any) {
      messages.value = messages.value.filter((m) => m.id !== tempId);
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  async function clearConversation() {
    if (!sessionId.value) return;
    try {
      const headers = getHeaders();
      await axios.delete(core_url + `/vector/sessions/${sessionId.value}`, {
        headers,
      });
      session.value = null;
      sessionId.value = null;
      messages.value = [];
    } catch (err) {
      console.error("[VectorStore] clearConversation failed:", err);
    }
  }

  return {
    messages,
    sessionId,
    session,
    isLoading,
    sendMessage,
    loadActiveSession,
    clearConversation,
  };
});
