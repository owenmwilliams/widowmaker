<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { vectorStore, type VectorAction } from '../../stores/VectorStore';

const props = defineProps<{ user: string }>();

const router = useRouter();
const $q = useQuasar();
const store = vectorStore();
const inputText = ref('');
const messagesContainer = ref<HTMLElement | null>(null);

// ── Auto-scroll to bottom on new messages ────────────────────────────────────
watch(() => store.messages.length, () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
});

// ── Send message ─────────────────────────────────────────────────────────────
const send = async () => {
  const text = inputText.value.trim();
  if (!text) return;
  if (store.isLoading) return;

  inputText.value = '';

  try {
    await store.sendMessage(text);
  } catch (err: any) {
    $q.notify({
      type: 'negative',
      message: err.response?.status === 401
        ? 'Session expired. Please log in again.'
        : 'Failed to send message. Please try again.',
      position: 'bottom',
    });
  }
};

// ── Action display helpers ───────────────────────────────────────────────────
const actionIcon = (tool: string): string => {
  switch (tool) {
    case 'get_move_summary': return 'summarize';
    case 'estimate_missing_items': return 'scale';
    case 'recommend_truck_size': return 'local_shipping';
    case 'calculate_route': return 'route';
    case 'estimate_labor': return 'groups';
    case 'estimate_move_cost': return 'payments';
    case 'flag_special_items': return 'warning';
    case 'get_room_breakdown': return 'grid_view';
    default: return 'build';
  }
};

const actionLabel = (action: VectorAction): string => {
  switch (action.tool) {
    case 'get_move_summary': return 'Move summary';
    case 'estimate_missing_items':
      return action.result?.estimated ? `Estimated ${action.result.estimated} items` : 'Estimating items';
    case 'recommend_truck_size':
      return action.result?.recommendation?.size || 'Truck recommendation';
    case 'calculate_route':
      return action.result?.distanceMiles ? `${action.result.distanceMiles} mi` : 'Route calculation';
    case 'estimate_labor':
      return action.result?.totalLaborHours ? `${action.result.totalLaborHours}h labor` : 'Labor estimate';
    case 'estimate_move_cost': return 'Cost estimate';
    case 'flag_special_items':
      return action.result?.flaggedCount ? `${action.result.flaggedCount} flagged` : 'Special items check';
    case 'get_room_breakdown': return 'Room breakdown';
    default: return action.tool.replace(/_/g, ' ');
  }
};

const isActionChip = (action: VectorAction): boolean => {
  return !!action.result?.success;
};

// ── Inline buttons parsing ───────────────────────────────────────────────────
interface InlineButton {
  label: string;
  message: string;
}

const parseButtons = (content: string): InlineButton[] => {
  const match = content.match(/\[BUTTONS\]([\s\S]*?)\[\/BUTTONS\]/);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && line.includes('|'))
    .map(line => {
      const [label, ...rest] = line.split('|');
      return { label: label.trim(), message: rest.join('|').trim() };
    });
};

const usedButtonMsgIds = ref<Set<number>>(new Set());

const handleButtonClick = (msgId: number, message: string) => {
  usedButtonMsgIds.value = new Set([...usedButtonMsgIds.value, msgId]);
  inputText.value = message;
  send();
};

// ── Message content rendering ────────────────────────────────────────────────
const renderMessageContent = (content: string): string => {
  const stripped = content.replace(/\[BUTTONS\][\s\S]*?\[\/BUTTONS\]/g, '').trim();
  const escaped = stripped
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped;
};

// ── Auto-resume on mount ─────────────────────────────────────────────────────
onMounted(async () => {
  await store.loadActiveSession();
});

const confirmClear = () => {
  $q.dialog({
    title: 'Start fresh?',
    message: 'This will archive your current conversation and start a new one.',
    cancel: true,
    persistent: false,
  }).onOk(() => {
    store.clearConversation();
  });
};

const quickStarts = [
  { label: "How big is my move?", message: "How big is my move? Give me a summary." },
  { label: "What truck do I need?", message: "What size truck do I need for my move?" },
  { label: "Estimate my costs", message: "Can you estimate the cost of my move?" },
];
</script>

<template>
  <div class="vector-chat">
    <!-- Header -->
    <div class="chat-header">
      <div class="header-left">
        <q-btn flat dense round icon="arrow_back" @click="router.back()" />
        <q-icon name="straighten" size="24px" color="deep-purple" />
        <span class="header-title">Vector</span>
      </div>
      <div class="header-right">
        <q-btn flat dense round icon="more_vert">
          <q-menu>
            <q-list style="min-width: 180px">
              <q-item clickable v-close-popup @click="confirmClear">
                <q-item-section avatar><q-icon name="refresh" /></q-item-section>
                <q-item-section>Start fresh</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </div>
    </div>

    <!-- Messages -->
    <div ref="messagesContainer" class="chat-messages">
      <!-- Welcome state -->
      <div v-if="store.messages.length === 0 && !store.isLoading" class="welcome-state">
        <q-icon name="straighten" size="48px" color="deep-purple" class="q-mb-md" />
        <h3 class="welcome-title">Hi! I'm Vector</h3>
        <p class="welcome-sub">
          I analyze your inventory to help you plan your move — truck size, costs, labor, and logistics.
        </p>
        <div class="quick-starts">
          <q-chip
            v-for="chip in quickStarts"
            :key="chip.label"
            clickable outline color="deep-purple"
            @click="inputText = chip.message; send()"
          >{{ chip.label }}</q-chip>
        </div>
      </div>

      <!-- Message list -->
      <div
        v-for="msg in store.messages"
        :key="msg.id"
        :class="['message-row', msg.role]"
      >
        <div :class="['message-bubble', msg.role]">
          <!-- Text -->
          <div v-if="msg.content && msg.role === 'model'"
               class="msg-text" v-html="renderMessageContent(msg.content)"></div>
          <div v-else-if="msg.content" class="msg-text">{{ msg.content }}</div>

          <!-- Action chips (on model messages) -->
          <div v-if="msg.actions && msg.actions.length > 0" class="msg-actions">
            <q-chip
              v-for="(action, i) in msg.actions.filter(isActionChip)"
              :key="i"
              :icon="actionIcon(action.tool)"
              size="sm"
              color="deep-purple"
              text-color="white"
              dense
            >{{ actionLabel(action) }}</q-chip>
          </div>

          <!-- Inline quick-reply buttons -->
          <div v-if="msg.role === 'model' && parseButtons(msg.content).length > 0"
               class="msg-inline-buttons">
            <q-btn
              v-for="(btn, i) in parseButtons(msg.content)"
              :key="i"
              outline rounded no-caps
              color="deep-purple"
              size="sm"
              class="inline-btn"
              :disable="store.isLoading || usedButtonMsgIds.has(msg.id)"
              @click="handleButtonClick(msg.id, btn.message)"
            >{{ btn.label }}</q-btn>
          </div>
        </div>
      </div>

      <!-- Typing indicator -->
      <div v-if="store.isLoading" class="message-row model">
        <div class="message-bubble model typing">
          <div class="typing-dots">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    </div>

    <!-- Input area -->
    <div class="chat-input-area">
      <q-input
        v-model="inputText"
        placeholder="Ask about your move..."
        outlined rounded dense
        class="chat-text-input"
        @keyup.enter="send"
        :disable="store.isLoading"
      />
      <q-btn round color="deep-purple" icon="send"
             :loading="store.isLoading"
             :disable="!inputText.trim()"
             @click="send" />
    </div>
  </div>
</template>

<style scoped>
.vector-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 100dvh;
  background: #f8f9fa;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: white;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.header-title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}
.header-right {
  display: flex;
  gap: 4px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Welcome state */
.welcome-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
  flex: 1;
}
.welcome-title {
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 8px;
  color: #1a1a1a;
}
.welcome-sub {
  font-size: 14px;
  color: #666;
  margin: 0 0 24px;
  max-width: 300px;
}
.quick-starts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

/* Messages */
.message-row {
  display: flex;
}
.message-row.user {
  justify-content: flex-end;
}
.message-row.model {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 16px;
  word-wrap: break-word;
  white-space: pre-wrap;
}
.message-bubble.user {
  background: #7c4dff;
  color: white;
  border-bottom-right-radius: 4px;
}
.message-bubble.model {
  background: white;
  color: #1a1a1a;
  border-bottom-left-radius: 4px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.08);
}

.msg-text {
  font-size: 14px;
  line-height: 1.5;
}

.msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

/* Inline quick-reply buttons */
.msg-inline-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.inline-btn {
  font-size: 13px;
  padding: 2px 12px;
}

/* Typing indicator */
.message-bubble.typing {
  padding: 12px 20px;
}
.typing-dots {
  display: flex;
  gap: 4px;
}
.typing-dots span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #bbb;
  animation: typingBounce 1.4s infinite ease-in-out;
}
.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes typingBounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

/* Input area */
.chat-input-area {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: white;
  border-top: 1px solid #e0e0e0;
  flex-shrink: 0;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}
.chat-text-input {
  flex: 1;
}
</style>
