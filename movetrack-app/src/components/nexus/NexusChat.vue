<script setup lang="ts">
import { ref, nextTick, watch, onMounted, type Component } from 'vue';
import { useQuasar } from 'quasar';
import { marked } from 'marked';
import {
  Sparkles,
  Hand,
  Home,
  Compass,
  Camera,
  Truck,
  Search,
  Images,
  ChevronDown,
  ChevronRight,
} from 'lucide-vue-next';
import { nexusStore, type NexusMessage, type NexusAction, type ActivityStep } from '../../stores/NexusStore';
import { hasCompletedOnboarding } from '../../utils/onboarding';

const props = defineProps<{ user: string }>();

const $q = useQuasar();
const store = nexusStore();
const inputText = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const pendingAttachments = ref<{ url: string; mimeType: string; preview: string; isVideo?: boolean }[]>([]);

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
  if (!text && pendingAttachments.value.length === 0) return;
  if (store.isLoading) return;

  const attachments = pendingAttachments.value.map(a => ({
    url: a.url,
    mimeType: a.mimeType,
  }));
  pendingAttachments.value = [];
  inputText.value = '';

  try {
    await store.sendMessage(text || 'Here\'s a photo', attachments.length > 0 ? attachments : undefined);
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

// ── Keyboard handling: Enter to send, Shift+Enter for newline ────────────────
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    send();
  }
};

// ── Photo upload ─────────────────────────────────────────────────────────────
const openPhotoUpload = () => {
  fileInput.value?.click();
};

const handleFileSelected = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const isVideo = file.type.startsWith('video/');

  try {
    const result = await store.uploadPhoto(file);
    pendingAttachments.value.push({
      url: result.url,
      mimeType: result.mimeType,
      preview: URL.createObjectURL(file),
      isVideo,
    });
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: isVideo ? 'Failed to upload video' : 'Failed to upload photo',
      position: 'bottom',
    });
  }

  target.value = '';
};

const removeAttachment = (idx: number) => {
  const att = pendingAttachments.value[idx];
  if (att.preview) URL.revokeObjectURL(att.preview);
  pendingAttachments.value.splice(idx, 1);
};

// ── Action display helpers (merged Census + Vector icons) ────────────────────
const actionIcon = (tool: string): string => {
  switch (tool) {
    case 'add_item': return 'add_circle';
    case 'add_room': return 'meeting_room';
    case 'update_item': return 'edit';
    case 'set_location': return 'location_on';
    case 'set_user_profile': return 'person';
    case 'analyze_photo': return 'photo_camera';
    case 'get_inventory_summary': return 'inventory';
    case 'get_missing_context': return 'search';
    case 'delete_item': return 'delete';
    case 'analyze_video': return 'videocam';
    case 'find_duplicates': return 'content_copy';
    case 'get_move_summary': return 'summarize';
    case 'estimate_missing_items': return 'scale';
    case 'recommend_truck_size': return 'local_shipping';
    case 'calculate_route': return 'route';
    case 'estimate_labor': return 'groups';
    case 'estimate_move_cost': return 'payments';
    case 'flag_special_items': return 'warning';
    case 'get_room_breakdown': return 'grid_view';
    case 'delegate_to_census': return 'inventory_2';
    case 'delegate_to_vector': return 'local_shipping';
    default: return 'build';
  }
};

const actionLabel = (action: NexusAction): string => {
  if (action.tool === 'add_item' && action.result?.success) {
    const qty = action.args.quantity && action.args.quantity > 1 ? `${action.args.quantity}x ` : '';
    return `${qty}${action.args.name}`;
  }
  if (action.tool === 'add_room' && action.result?.success) return `Room: ${action.args.name}`;
  if (action.tool === 'set_location' && action.result?.success) return `Location: ${action.args.name}`;
  if (action.tool === 'update_item' && action.result?.success) return 'Updated item';
  if (action.tool === 'delete_item' && action.result?.success) return `Removed: ${action.result.name || action.args.name || 'item'}`;
  if (action.tool === 'recommend_truck_size' && action.result?.recommendation?.size) return action.result.recommendation.size;
  if (action.tool === 'calculate_route' && action.result?.distanceMiles) return `${action.result.distanceMiles} mi`;
  if (action.tool === 'estimate_labor' && action.result?.totalLaborHours) return `${action.result.totalLaborHours}h labor`;
  if (action.tool === 'estimate_missing_items' && action.result?.estimated) return `Estimated ${action.result.estimated} items`;
  if (action.tool === 'flag_special_items' && action.result?.flaggedCount) return `${action.result.flaggedCount} flagged`;
  if (action.tool === 'delegate_to_census' || action.tool === 'delegate_to_vector') return '';
  return action.tool.replace(/_/g, ' ');
};

const isActionChip = (action: NexusAction): boolean => {
  if (action.tool === 'delegate_to_census' || action.tool === 'delegate_to_vector') return false;
  if (action.tool === 'get_inventory_status' || action.tool === 'get_user_profile') return false;
  return !!action.result?.success;
};

// ── Activity log helpers ─────────────────────────────────────────────────────
const activityStepLabel = (step: ActivityStep): string => {
  if (step.detail) return `${step.label}: ${step.detail}`;
  return step.label;
};

const expandedActivityLogs = ref<Set<number>>(new Set());
const liveActivityExpanded = ref(false);

const toggleActivityLog = (msgId: number) => {
  if (expandedActivityLogs.value.has(msgId)) {
    expandedActivityLogs.value.delete(msgId);
  } else {
    expandedActivityLogs.value.add(msgId);
  }
};

// ── Inline buttons parsing ───────────────────────────────────────────────────
type ButtonAction = 'send' | 'prefill' | 'camera';
const VALID_ACTIONS = new Set<ButtonAction>(['send', 'prefill', 'camera']);

interface InlineButton {
  label: string;
  message: string;
  actions: ButtonAction[];
}

const parseActions = (raw: string | undefined): ButtonAction[] => {
  if (!raw || !raw.trim()) return []; // empty = no explicit actions, will be inferred
  const parsed = raw
    .toLowerCase()
    .split(/[,\s]+/)
    .map(s => s.trim().replace(/[^a-z]/g, ''))
    .filter((s): s is ButtonAction => VALID_ACTIONS.has(s as ButtonAction));
  return parsed;
};

// Infer action from message content when model omits the action field
const inferActions = (message: string): ButtonAction[] => {
  const msg = message.toLowerCase();
  // Messages about scanning/photos/camera → open camera
  if (/\b(scan|photo|video|camera|snap|picture|image)\b/.test(msg)) return ['camera'];
  // Messages ending with colon → prefill
  if (message.trimEnd().endsWith(':')) return ['prefill'];
  return ['send'];
};

const parseButtons = (content: string): InlineButton[] => {
  // Tolerant regex: handles [BUTTONS], [Buttons], [buttons], extra whitespace
  const match = content.match(/\[buttons\]([\s\S]*?)\[\/buttons\]/i);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && line.includes('|'))
    .map(line => {
      const parts = line.split('|');
      const label = (parts[0] || '').trim();
      // If model accidentally included extra pipes in message, rejoin middle parts
      // Last part is actions ONLY if it looks like an action token (no spaces, short)
      const lastPart = (parts[parts.length - 1] || '').trim();
      const looksLikeActions = parts.length >= 3 && /^[a-z, ]+$/i.test(lastPart) && lastPart.length < 30;
      const message = looksLikeActions
        ? parts.slice(1, -1).join('|').trim()
        : parts.slice(1).join('|').trim();
      const explicit = looksLikeActions ? parseActions(lastPart) : [];
      const actions = explicit.length > 0 ? explicit : inferActions(message);
      return { label, message, actions };
    })
    .filter(btn => btn.label && btn.message);
};

// Buttons disable after the user's next message actually sends (not on click)
const lastButtonClickMsgId = ref<number | null>(null);
const disabledButtonMsgIds = ref<Set<number>>(new Set());

// Watch for new user messages — when one appears, disable the buttons that were clicked
watch(() => store.messages.length, () => {
  if (lastButtonClickMsgId.value !== null) {
    const lastMsg = store.messages[store.messages.length - 1];
    if (lastMsg?.role === 'user') {
      disabledButtonMsgIds.value = new Set([...disabledButtonMsgIds.value, lastButtonClickMsgId.value]);
      lastButtonClickMsgId.value = null;
    }
  }
});

// Prefill modal state
const prefillModal = ref(false);
const prefillPrompt = ref('');
const prefillUserInput = ref('');
const prefillSourceMsgId = ref<number | null>(null);

const submitPrefill = () => {
  const full = prefillPrompt.value.trimEnd() + ' ' + prefillUserInput.value.trim();
  prefillModal.value = false;
  prefillUserInput.value = '';
  inputText.value = full;
  send();
};

const cancelPrefill = () => {
  prefillModal.value = false;
  prefillUserInput.value = '';
  prefillSourceMsgId.value = null;
};

const handleButtonClick = (msgId: number, btn: InlineButton) => {
  const { message, actions } = btn;

  const hasSend = actions.includes('send');
  const hasPrefill = actions.includes('prefill');
  const hasCamera = actions.includes('camera');

  // Track which message's buttons should disable after send
  if (msgId >= 0) lastButtonClickMsgId.value = msgId;

  // Prefill → open modal for user to complete the message
  if (hasPrefill) {
    prefillPrompt.value = message.trimEnd();
    prefillUserInput.value = '';
    prefillSourceMsgId.value = msgId;
    prefillModal.value = true;
    return;
  }

  // Camera → pre-fill message + open picker, user sends manually
  if (hasCamera) {
    inputText.value = message.trimEnd();
    nextTick(() => fileInput.value?.click());
    return;
  }

  // Send → auto-send immediately
  if (hasSend) {
    inputText.value = message;
    send();
  }
};

// ── Message content rendering ────────────────────────────────────────────────
marked.setOptions({ breaks: true, gfm: true });

const renderMessageContent = (content: string): string => {
  let text = content.replace(/\[BUTTONS\][\s\S]*?\[\/BUTTONS\]/g, '').trim();
  text = text.replace(
    /\[IMG:(https?:\/\/[^\]]+)\]/g,
    '<img src="$1" class="msg-inline-photo" />'
  );
  return marked.parse(text) as string;
};

// ── Timestamp formatting ────────────────────────────────────────────────────
const formatTime = (dateStr: string): string => {
  try {
    return new Date(dateStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
};

// ── Welcome state ───────────────────────────────────────────────────────────
const isOnboarded = hasCompletedOnboarding();

const onboardingChips: { icon: Component; label: string; message: string; actions?: ButtonAction[] }[] = [
  { icon: Hand, label: "I'm planning a move", message: "I'm planning a move" },
  { icon: Home, label: "Help me get organized", message: "I want to catalog and organize my stuff" },
  { icon: Compass, label: "Just looking around", message: "I'm just exploring — show me what you can do" },
];

const returningCards: { icon: Component; title: string; subtitle: string; message: string; actions?: ButtonAction[] }[] = [
  { icon: Camera, title: 'Catalog a room', subtitle: 'Snap photos to add items', message: "Scanning my room", actions: ['camera'] },
  { icon: Truck, title: 'Plan my move', subtitle: 'Estimate costs and timeline', message: 'Help me plan my move' },
  { icon: Search, title: 'Search inventory', subtitle: 'Find items across locations', message: 'Search my inventory' },
  { icon: Images, title: 'Upload photos', subtitle: 'Bulk import from your gallery', message: 'I want to upload photos', actions: ['camera'] },
];

const handleCardClick = (card: { message: string; actions?: ButtonAction[] }) => {
  const actions = card.actions || ['send'];
  const btn: InlineButton = { label: '', message: card.message, actions };
  handleButtonClick(-1, btn);
};

// ── Auto-resume on mount ─────────────────────────────────────────────────────
onMounted(async () => {
  const guidance = await store.loadActiveSession();
  if (guidance?.isStale && store.session) {
    await store.requestGuidance();
  }
});

const confirmClear = () => {
  $q.dialog({
    title: 'Start fresh?',
    message: 'This will archive your current conversation and start a new one. Your inventory is not affected.',
    cancel: true,
    persistent: false,
  }).onOk(() => {
    store.clearConversation();
  });
};
</script>

<template>
  <div class="nexus-chat">
    <!-- Messages -->
    <div ref="messagesContainer" class="chat-messages">
      <!-- Welcome state -->
      <!-- Welcome state: New user (not onboarded) -->
      <div v-if="store.messages.length === 0 && !store.isLoading && !isOnboarded" class="welcome-state">
        <div class="welcome-avatar" aria-hidden="true">
          <span class="shimmer-sweep"></span>
          <Sparkles :size="30" fill="currentColor" />
        </div>
        <h3 class="welcome-title">Welcome to Nexus</h3>
        <p class="welcome-sub">
          I'm your AI moving assistant. I'll help you catalog everything you own, plan your move, and keep track of it all. Let's start by getting to know you.
        </p>
        <div class="onboarding-chips">
          <button
            v-for="chip in onboardingChips"
            :key="chip.label"
            type="button"
            class="onboarding-chip"
            @click="handleCardClick(chip)"
          >
            <component :is="chip.icon" :size="20" class="chip-icon" />
            <span>{{ chip.label }}</span>
          </button>
        </div>
      </div>

      <!-- Welcome state: Returning user (onboarded) -->
      <div v-if="store.messages.length === 0 && !store.isLoading && isOnboarded" class="welcome-state">
        <div class="welcome-avatar" aria-hidden="true">
          <span class="shimmer-sweep"></span>
          <Sparkles :size="30" fill="currentColor" />
        </div>
        <h3 class="welcome-title">How can I help with your move?</h3>
        <p class="welcome-sub">
          I can catalog your belongings, plan your move, and answer questions about your inventory.
        </p>
        <div class="suggestion-grid">
          <button
            v-for="card in returningCards"
            :key="card.title"
            type="button"
            class="suggestion-card"
            @click="handleCardClick(card)"
          >
            <component :is="card.icon" :size="22" class="card-icon" />
            <div class="suggestion-text">
              <div class="suggestion-title">{{ card.title }}</div>
              <div class="suggestion-subtitle">{{ card.subtitle }}</div>
            </div>
          </button>
        </div>
      </div>

      <!-- Message list -->
      <div
        v-for="msg in store.messages"
        :key="msg.id"
        :class="['message-row', msg.role]"
      >
        <!-- Model avatar -->
        <div v-if="msg.role === 'model'" class="model-avatar" aria-hidden="true">
          <span class="shimmer-sweep"></span>
          <Sparkles :size="14" fill="currentColor" />
        </div>

        <div class="message-content-wrap">
          <div :class="['message-bubble', msg.role]">
            <!-- Photo attachments -->
            <div v-if="msg.attachments && msg.attachments.length > 0" class="msg-attachments">
              <img
                v-for="(att, i) in msg.attachments"
                :key="i"
                :src="att.url"
                class="msg-photo"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
            </div>

            <!-- Text -->
            <div v-if="msg.content && msg.role === 'model'"
                 class="msg-text" v-html="renderMessageContent(msg.content)"></div>
            <div v-else-if="msg.content" class="msg-text">{{ msg.content }}</div>

            <!-- Action chips (on model messages) -->
            <div v-if="msg.actions && msg.actions.filter(isActionChip).length > 0" class="msg-actions">
              <q-chip
                v-for="(action, i) in msg.actions.filter(isActionChip)"
                :key="i"
                :icon="actionIcon(action.tool)"
                size="sm"
                class="action-chip"
                :class="{ 'action-chip--delete': action.tool === 'delete_item' }"
              >{{ actionLabel(action) }}</q-chip>
            </div>

            <!-- Activity log (on completed model messages) -->
            <div v-if="msg.activitySteps && msg.activitySteps.length >= 2"
                 class="activity-log-section">
              <button type="button" class="activity-log-toggle"
                      @click="toggleActivityLog(msg.id)">
                <component :is="expandedActivityLogs.has(msg.id) ? ChevronDown : ChevronRight" :size="13" class="activity-arrow" />
                {{ msg.activitySteps.length }} steps
              </button>
              <div v-if="expandedActivityLogs.has(msg.id)" class="activity-log">
                <div v-for="(step, i) in msg.activitySteps" :key="i" class="activity-step">
                  <q-icon :name="actionIcon(step.tool)" size="12px"
                          :class="{ 'step-done': step.status === 'done', 'step-failed': step.status === 'failed' }" />
                  <span class="step-label">{{ activityStepLabel(step) }}</span>
                  <q-icon v-if="step.status === 'done'" name="check_circle" size="12px" class="step-check" />
                  <q-icon v-else name="error" size="12px" class="step-error" />
                </div>
              </div>
            </div>

            <!-- Inline quick-reply buttons -->
            <div v-if="msg.role === 'model' && parseButtons(msg.content).length > 0"
                 class="msg-inline-buttons">
              <q-btn
                v-for="(btn, i) in parseButtons(msg.content)"
                :key="i"
                outline rounded no-caps
                class="inline-btn"
                :disable="store.isLoading || disabledButtonMsgIds.has(msg.id)"
                @click="handleButtonClick(msg.id, btn)"
              >{{ btn.label }}</q-btn>
            </div>
          </div>

          <!-- Timestamp -->
          <div v-if="msg.created_at" :class="['msg-timestamp', msg.role]">
            {{ formatTime(msg.created_at) }}
          </div>
        </div>
      </div>

      <!-- Typing / status indicator -->
      <div v-if="store.isLoading" class="message-row model">
        <div class="model-avatar" aria-hidden="true">
          <span class="shimmer-sweep"></span>
          <Sparkles :size="14" fill="currentColor" />
        </div>
        <div class="message-content-wrap">
          <div class="message-bubble model typing">
            <div class="bounce-dots">
              <span class="dot"></span>
              <span class="dot"></span>
              <span class="dot"></span>
            </div>
            <!-- Two-tier status -->
            <div v-if="store.phaseText" class="status-phase">{{ store.phaseText }}</div>
            <div v-if="store.detailText" class="status-detail" :key="store.detailText">
              {{ store.detailText }}
            </div>
            <!-- Live activity log (collapsed) -->
            <button v-if="store.activitySteps.filter(s => s.status !== 'running').length >= 2"
                    type="button"
                    class="activity-log-toggle"
                    @click="liveActivityExpanded = !liveActivityExpanded">
              <component :is="liveActivityExpanded ? ChevronDown : ChevronRight" :size="13" class="activity-arrow" />
              {{ store.activitySteps.filter(s => s.status === 'done').length }} steps completed
            </button>
            <div v-if="liveActivityExpanded && store.activitySteps.length >= 2" class="activity-log">
              <div v-for="(step, i) in store.activitySteps" :key="i" class="activity-step">
                <q-icon :name="actionIcon(step.tool)" size="12px"
                        :class="{ 'step-done': step.status === 'done', 'step-running': step.status === 'running', 'step-failed': step.status === 'failed' }" />
                <span class="step-label">{{ activityStepLabel(step) }}</span>
                <q-icon v-if="step.status === 'done'" name="check_circle" size="12px" class="step-check" />
                <q-icon v-else-if="step.status === 'running'" name="pending" size="12px" class="step-spinner" />
                <q-icon v-else name="error" size="12px" class="step-error" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Attachment preview -->
    <div v-if="pendingAttachments.length > 0" class="attachment-preview">
      <div v-for="(att, i) in pendingAttachments" :key="i" class="att-thumb-wrap">
        <div v-if="att.isVideo" class="att-thumb att-video-thumb">
          <q-icon name="videocam" size="24px" color="white" />
        </div>
        <img v-else :src="att.preview" class="att-thumb" />
        <q-btn
          round flat dense size="xs" icon="close" aria-label="Remove attachment"
          class="att-remove" @click="removeAttachment(i)"
        />
      </div>
    </div>

    <!-- Input area -->
    <div class="chat-input-area">
      <div class="input-container">
        <q-input
          v-model="inputText"
          placeholder="Message Nexus…"
          type="textarea"
          autogrow
          borderless
          dense
          class="chat-text-input"
          input-class="chat-textarea"
          @keydown="handleKeydown"
          :disable="store.isLoading"
        />
        <div class="input-toolbar">
          <div class="toolbar-left-btns">
            <q-btn round flat dense icon="photo_camera" aria-label="Add photo" class="tool-btn"
                   @click="openPhotoUpload" :loading="store.isUploading" />
            <q-btn round flat dense icon="attach_file" aria-label="Attach file" class="tool-btn"
                   @click="openPhotoUpload" />
            <q-btn v-if="store.messages.length > 0" round flat dense icon="refresh" aria-label="Start fresh" class="tool-btn"
                   @click="confirmClear">
              <q-tooltip>Start fresh</q-tooltip>
            </q-btn>
          </div>
          <q-btn
            round dense unelevated icon="arrow_upward" aria-label="Send"
            class="send-btn"
            :class="{ 'send-btn-visible': inputText.trim() || pendingAttachments.length > 0 }"
            :loading="store.isLoading"
            :disable="!inputText.trim() && pendingAttachments.length === 0"
            @click="send"
          />
        </div>
      </div>
    </div>

    <!-- Hidden file input -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*,video/mp4,video/quicktime,video/webm"
      style="display: none"
      @change="handleFileSelected"
    />

    <!-- Prefill modal -->
    <q-dialog v-model="prefillModal" persistent>
      <q-card class="prefill-card">
        <q-card-section class="prefill-header">
          <div class="prefill-title">Add your details</div>
          <div class="prefill-subtitle">{{ prefillPrompt }}</div>
        </q-card-section>
        <q-card-section class="prefill-body">
          <q-input
            v-model="prefillUserInput"
            type="textarea"
            autogrow
            autofocus
            placeholder="Type here…"
            class="prefill-input"
            input-class="prefill-textarea"
            borderless
            @keydown.enter.exact.prevent="prefillUserInput.trim() && submitPrefill()"
          />
        </q-card-section>
        <q-card-actions align="right" class="prefill-actions">
          <q-btn flat no-caps label="Cancel" class="prefill-cancel" @click="cancelPrefill" />
          <q-btn
            unelevated no-caps
            label="Send"
            class="prefill-send"
            :disable="!prefillUserInput.trim()"
            @click="submitPrefill"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<style scoped>
.nexus-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 100dvh;
  background: var(--bg);
  font-family: var(--font-ui);
}

/* ── Messages ────────────────────────────────────────────────────────────────── */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.chat-messages::-webkit-scrollbar {
  display: none;
}

/* ── Shimmer sweep (assistant avatar + self bubble only) ─────────────────────── */
.shimmer-sweep {
  position: absolute;
  inset: 0;
  width: 50%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
  animation: nx-shimmer-sweep var(--shimmer-sweep) var(--ease-standard) infinite;
  pointer-events: none;
}

/* ── Welcome state ───────────────────────────────────────────────────────────── */
.welcome-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
  flex: 1;
}
.welcome-avatar {
  width: 64px;
  height: 64px;
  border-radius: var(--r-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--shimmer);
  color: #fff;
  box-shadow: var(--glow-shimmer);
  position: relative;
  overflow: hidden;
  margin-bottom: 16px;
}
.welcome-avatar svg {
  position: relative;
}
.welcome-title {
  font-family: var(--font-display);
  font-size: var(--fs-title-m);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-title);
  line-height: var(--lh-snug);
  margin: 0 0 8px;
  color: var(--text-primary);
}
.welcome-sub {
  font-size: var(--fs-body);
  color: var(--text-secondary);
  line-height: var(--lh-body);
  margin: 0 0 24px;
  max-width: 400px;
}

.suggestion-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  max-width: 440px;
  width: 100%;
  margin-bottom: 16px;
}
@media (max-width: 480px) {
  .suggestion-grid {
    grid-template-columns: 1fr;
  }
}
.suggestion-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  min-height: var(--tap-min);
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  font-family: var(--font-ui);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    border-color var(--dur-base) var(--ease-standard),
    background var(--dur-base) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard);
}
.suggestion-card:hover {
  border-color: var(--accent);
  background: var(--surface-hover);
}
.suggestion-card:active {
  transform: scale(0.97);
}
.suggestion-card:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.card-icon {
  color: var(--accent);
  flex: none;
  margin-top: 1px;
}
.suggestion-text {
  text-align: left;
}
.suggestion-title {
  font-size: var(--fs-body);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
  color: var(--text-primary);
  margin-bottom: 2px;
}
.suggestion-subtitle {
  font-size: var(--fs-label);
  color: var(--text-tertiary);
}

.onboarding-chips {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 340px;
  margin: 0 auto;
}
.onboarding-chip {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: var(--tap-min);
  padding: 14px 18px;
  border: none;
  border-radius: var(--r-lg);
  background: var(--accent-quiet);
  color: var(--accent);
  font-family: var(--font-ui);
  font-size: var(--fs-body-l);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background var(--dur-base) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard);
}
.onboarding-chip:hover {
  background: var(--accent-quiet-2);
}
.onboarding-chip:active {
  transform: scale(0.985);
}
.onboarding-chip:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.chip-icon {
  flex: none;
}

/* ── Messages ────────────────────────────────────────────────────────────────── */
.message-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.message-row.user {
  justify-content: flex-end;
}
.message-row.model {
  justify-content: flex-start;
}

.model-avatar {
  width: 28px;
  height: 28px;
  border-radius: var(--r-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--shimmer);
  color: #fff;
  box-shadow: var(--glow-shimmer);
  margin-top: 2px;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}
.model-avatar svg {
  position: relative;
}

.message-content-wrap {
  max-width: 85%;
  display: flex;
  flex-direction: column;
}
@media (min-width: 768px) {
  .message-content-wrap {
    max-width: 680px;
  }
}

.message-bubble {
  padding: 13px 17px;
  border-radius: var(--r-xl);
  word-wrap: break-word;
}
.message-bubble.user {
  white-space: pre-wrap;
  position: relative;
  overflow: hidden;
  background: var(--shimmer);
  color: var(--bubble-self-text);
  font-weight: var(--fw-semibold);
  border-bottom-right-radius: 7px;
}
.message-bubble.user::after {
  content: "";
  position: absolute;
  inset: 0;
  width: 45%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.32), transparent);
  animation: nx-shimmer-sweep var(--shimmer-sweep) var(--ease-standard) infinite;
  pointer-events: none;
}
.message-bubble.model {
  background: var(--surface-card);
  color: var(--bubble-other-text);
  border: 1px solid var(--border);
  border-bottom-left-radius: 7px;
  box-shadow: var(--shadow-sm);
}

@media (prefers-reduced-motion: reduce) {
  .shimmer-sweep,
  .message-bubble.user::after {
    animation: none;
    display: none;
  }
}

.msg-timestamp {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 5px;
  padding: 0 4px;
}
.msg-timestamp.user {
  text-align: right;
}

.msg-text {
  font-size: var(--fs-body-l);
  line-height: var(--lh-body);
}
.msg-text :deep(p) {
  margin: 0 0 8px;
}
.msg-text :deep(p:last-child) {
  margin-bottom: 0;
}
.msg-text :deep(ul),
.msg-text :deep(ol) {
  margin: 4px 0 8px;
  padding-left: 20px;
}
.msg-text :deep(li) {
  margin-bottom: 2px;
}
.msg-text :deep(strong) {
  font-weight: var(--fw-semibold);
}
.msg-text :deep(code) {
  background: var(--surface-hover);
  padding: 1px 4px;
  border-radius: var(--r-xs);
  font-family: var(--font-mono);
  font-size: var(--fs-label);
}
.msg-text :deep(h1),
.msg-text :deep(h2),
.msg-text :deep(h3) {
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
  margin: 8px 0 4px;
}
.msg-text :deep(h1:first-child),
.msg-text :deep(h2:first-child),
.msg-text :deep(h3:first-child) {
  margin-top: 0;
}
.msg-text :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: var(--fs-label);
}
.msg-text :deep(th),
.msg-text :deep(td) {
  border: 1px solid var(--border);
  padding: 4px 8px;
}
.msg-text :deep(th) {
  background: var(--surface-hover);
  font-weight: var(--fw-semibold);
}

.msg-attachments {
  margin-bottom: 8px;
}
.msg-photo {
  max-width: 200px;
  max-height: 200px;
  border-radius: var(--r-sm);
  object-fit: cover;
}

.msg-text :deep(.msg-inline-photo) {
  display: block;
  max-width: 100%;
  max-height: 240px;
  border-radius: var(--r-sm);
  object-fit: cover;
  margin: 8px 0;
}

.msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.action-chip {
  border: 1px solid var(--border-soft) !important;
  background: var(--surface-hover) !important;
  color: var(--text-secondary) !important;
  padding: 5px 12px;
  font-size: var(--fs-label);
}
.action-chip :deep(.q-icon) {
  color: var(--text-tertiary) !important;
  font-size: 14px !important;
}
.action-chip--delete {
  background: var(--danger-quiet) !important;
  border-color: transparent !important;
  color: var(--danger) !important;
}
.action-chip--delete :deep(.q-icon) {
  color: var(--danger) !important;
}

/* Inline quick-reply buttons — SuggestionButton, outline pill (desktop) */
.msg-inline-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.inline-btn {
  min-height: var(--tap-min);
  padding: 4px 18px;
  font-size: var(--fs-body);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
  border-radius: var(--r-pill) !important;
  color: var(--accent) !important;
  background: transparent !important;
  transition:
    background var(--dur-base) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard);
}
.inline-btn:before {
  border: 1.5px solid var(--border);
}
.inline-btn:hover {
  background: var(--accent-quiet) !important;
}
.inline-btn:active {
  transform: scale(0.985);
}

/* ── Loading / Thinking ──────────────────────────────────────────────────────── */
.message-bubble.typing {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bounce-dots {
  display: flex;
  gap: 4px;
  align-items: center;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: var(--r-pill);
  background: var(--accent);
  animation: dotBounce 1.4s var(--ease-standard) infinite;
}
.dot:nth-child(2) {
  animation-delay: 0.2s;
}
.dot:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes dotBounce {
  0%, 80%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  40% {
    transform: translateY(-8px);
    opacity: 1;
  }
}
/* ── Phase-aware status ──────────────────────────────────────────────── */
.status-phase {
  font-size: var(--fs-label);
  color: var(--text-secondary);
  font-weight: var(--fw-medium);
}
.status-detail {
  font-size: var(--fs-micro);
  color: var(--text-tertiary);
  animation: detailFadeIn var(--dur-slow) var(--ease-standard);
}
@keyframes detailFadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Activity log ────────────────────────────────────────────────────── */
.activity-log-section {
  margin-top: 6px;
}
.activity-log-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  font-family: var(--font-ui);
  font-size: var(--fs-micro);
  color: var(--text-tertiary);
  cursor: pointer;
  user-select: none;
  padding: 6px 0;
  -webkit-tap-highlight-color: transparent;
  transition: color var(--dur-base) var(--ease-standard);
}
.activity-log-toggle:hover {
  color: var(--text-secondary);
}
.activity-log-toggle:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--r-xs);
}
.activity-arrow {
  flex: none;
}
.activity-log {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px 0 2px 4px;
  border-left: 1px solid var(--border-soft);
  margin-left: 5px;
  animation: logSlideDown var(--dur-base) var(--ease-standard);
}
@keyframes logSlideDown {
  from { opacity: 0; max-height: 0; }
  to   { opacity: 1; max-height: 500px; }
}
.activity-step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-micro);
  color: var(--text-tertiary);
}
.step-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.step-done {
  color: var(--text-tertiary);
}
.step-running {
  color: var(--accent);
  animation: stepPulse 1.2s var(--ease-standard) infinite;
}
.step-failed {
  color: var(--danger);
}
@keyframes stepPulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
.step-check {
  color: var(--success);
}
.step-spinner {
  color: var(--accent);
  animation: stepPulse 1.2s var(--ease-standard) infinite;
}
.step-error {
  color: var(--danger);
}

/* ── Attachment preview ──────────────────────────────────────────────────────── */
.attachment-preview {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.att-thumb-wrap {
  position: relative;
}
.att-thumb {
  width: 60px;
  height: 60px;
  border-radius: var(--r-sm);
  object-fit: cover;
}
.att-video-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--text-primary);
}
.att-remove {
  position: absolute;
  top: -4px;
  right: -4px;
  background: color-mix(in oklab, var(--navy-900) 72%, transparent);
  color: #fff;
}

/* ── Input area — Input "composer" variant ───────────────────────────────────── */
.chat-input-area {
  padding: 12px 16px;
  background: var(--bg);
  flex-shrink: 0;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}

.input-container {
  background: var(--surface-card);
  border-radius: var(--r-2xl);
  padding: 10px 16px;
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--dur-base) var(--ease-standard);
  max-width: 680px;
  margin: 0 auto;
}
.input-container:focus-within {
  box-shadow: var(--shadow-sm), var(--focus-ring);
}

.chat-text-input {
  width: 100%;
}
.chat-text-input :deep(.q-field__control) {
  padding: 0;
}
.chat-text-input :deep(.chat-textarea) {
  color: var(--text-primary);
  max-height: 150px;
  overflow-y: auto;
  font-size: var(--fs-body-l);
  line-height: var(--lh-body);
}
.chat-text-input :deep(.q-field__native::placeholder) {
  color: var(--text-tertiary);
}

.input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}
.toolbar-left-btns {
  display: flex;
  gap: 4px;
}
.tool-btn {
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  color: var(--text-secondary);
  transition: color var(--dur-base) var(--ease-standard);
}
.tool-btn:hover {
  color: var(--accent);
}

/* ── Send button ───────────────────────────────────────────────────────────── */
.send-btn {
  width: var(--tap-min);
  height: var(--tap-min);
  min-width: var(--tap-min);
  background: var(--accent);
  color: var(--text-on-accent);
  opacity: 0;
  transform: scale(0.8);
  transition:
    opacity var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard);
}
.send-btn:hover {
  background: var(--accent-hover);
}
.send-btn-visible {
  opacity: 1;
  transform: scale(1);
}

/* ── Prefill modal ──────────────────────────────────────────────────────────── */
.prefill-card {
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  min-width: 340px;
  max-width: 480px;
  width: 90vw;
}
.prefill-header {
  padding: 20px 24px 8px;
}
.prefill-title {
  font-family: var(--font-display);
  font-size: var(--fs-title-s);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-title);
  color: var(--text-primary);
  margin-bottom: 6px;
}
.prefill-subtitle {
  font-size: var(--fs-body);
  color: var(--text-secondary);
  line-height: var(--lh-body);
}
.prefill-body {
  padding: 4px 24px 8px;
}
.prefill-input {
  background: var(--surface-sunk);
  border: 1.5px solid var(--border);
  border-radius: var(--r-md);
  padding: 4px 12px;
  transition:
    border-color var(--dur-base) var(--ease-standard),
    box-shadow var(--dur-base) var(--ease-standard);
}
.prefill-input:focus-within {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}
.prefill-input .prefill-textarea {
  color: var(--text-primary) !important;
  min-height: 60px;
  max-height: 150px;
  font-size: var(--fs-body);
}
.prefill-input :deep(.q-field__control) {
  color: var(--text-primary);
}
.prefill-input :deep(.q-placeholder) {
  color: var(--text-tertiary) !important;
}
.prefill-actions {
  padding: 8px 20px 16px;
}
.prefill-cancel {
  min-height: var(--tap-min);
  color: var(--text-secondary);
  font-size: var(--fs-body);
}
.prefill-send {
  min-height: var(--tap-min);
  background: var(--accent);
  color: var(--text-on-accent);
  border-radius: var(--r-md);
  padding: 4px 20px;
  font-size: var(--fs-body);
  font-weight: var(--fw-bold);
}
.prefill-send:hover {
  background: var(--accent-hover);
}
.prefill-send[disabled] {
  opacity: 0.45;
}
</style>
