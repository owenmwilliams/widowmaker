<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { marked } from 'marked';
import { censusStore, type CensusMessage, type CensusAction } from '../../stores/CensusStore';

const props = defineProps<{ user: string }>();

const router = useRouter();
const $q = useQuasar();
const store = censusStore();
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

  // Reset input so same file can be re-selected
  target.value = '';
};

const removeAttachment = (idx: number) => {
  const att = pendingAttachments.value[idx];
  if (att.preview) URL.revokeObjectURL(att.preview);
  pendingAttachments.value.splice(idx, 1);
};

// ── Action display helpers ───────────────────────────────────────────────────
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
    default: return 'build';
  }
};

const actionLabel = (action: CensusAction): string => {
  if (action.tool === 'add_item' && action.result?.success) {
    const qty = action.args.quantity && action.args.quantity > 1 ? `${action.args.quantity}x ` : '';
    return `${qty}${action.args.name}`;
  }
  if (action.tool === 'add_room' && action.result?.success) {
    return `Room: ${action.args.name}`;
  }
  if (action.tool === 'set_location' && action.result?.success) {
    return `Location: ${action.args.name}`;
  }
  if (action.tool === 'update_item' && action.result?.success) {
    return 'Updated item';
  }
  if (action.tool === 'delete_item' && action.result?.success) {
    return `Removed: ${action.result.name || action.args.name || 'item'}`;
  }
  return action.tool.replace(/_/g, ' ');
};

const isActionChip = (action: CensusAction): boolean => {
  return ['add_item', 'add_room', 'set_location', 'delete_item'].includes(action.tool) && !!action.result?.success;
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

// Track which messages have had their buttons used
const usedButtonMsgIds = ref<Set<number>>(new Set());

const handleButtonClick = (msgId: number, message: string) => {
  usedButtonMsgIds.value = new Set([...usedButtonMsgIds.value, msgId]);
  inputText.value = message;
  send();
};

// ── Message content rendering ────────────────────────────────────────────────
marked.setOptions({
  breaks: true,
  gfm: true,
});

const renderMessageContent = (content: string): string => {
  let text = content.replace(/\[BUTTONS\][\s\S]*?\[\/BUTTONS\]/g, '').trim();
  text = text.replace(
    /\[IMG:(https?:\/\/[^\]]+)\]/g,
    '<img src="$1" class="msg-inline-photo" />'
  );
  return marked.parse(text) as string;
};

// ── Auto-resume on mount ─────────────────────────────────────────────────────
onMounted(async () => {
  await store.loadActiveSession();
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
  <div class="census-chat">
    <!-- Header -->
    <div class="chat-header">
      <div class="header-left">
        <q-btn flat dense round icon="arrow_back" @click="router.back()" />
        <q-icon name="auto_awesome" size="24px" color="primary" />
        <span class="header-title">Nexus</span>
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
        <q-icon name="auto_awesome" size="48px" color="primary" class="q-mb-md" />
        <h3 class="welcome-title">Hi! I'm Nexus</h3>
        <p class="welcome-sub">
          I can help you catalog your belongings, room by room.
          Just tell me what you have, or snap a photo!
        </p>
        <div class="quick-starts">
          <q-chip
            v-for="chip in store.quickStartChips"
            :key="chip.label"
            clickable outline color="primary"
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
          <div v-if="msg.actions && msg.actions.length > 0" class="msg-actions">
            <q-chip
              v-for="(action, i) in msg.actions.filter(isActionChip)"
              :key="i"
              :icon="actionIcon(action.tool)"
              size="sm"
              :color="action.tool === 'delete_item' ? 'negative' : 'positive'"
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
              color="primary"
              size="sm"
              class="inline-btn"
              :disable="store.isLoading || usedButtonMsgIds.has(msg.id)"
              @click="handleButtonClick(msg.id, btn.message)"
            >{{ btn.label }}</q-btn>
          </div>
        </div>
      </div>

      <!-- Typing / status indicator -->
      <div v-if="store.isLoading" class="message-row model">
        <div class="message-bubble model typing">
          <div class="status-indicator">
            <q-spinner-dots size="18px" color="primary" />
            <span v-if="store.statusText" class="status-label">{{ store.statusText }}</span>
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
          round flat dense size="xs" icon="close"
          class="att-remove" @click="removeAttachment(i)"
        />
      </div>
    </div>

    <!-- Input area -->
    <div class="chat-input-area">
      <q-btn round flat icon="attach_file" color="grey-7"
             @click="openPhotoUpload" :loading="store.isUploading" />
      <q-input
        v-model="inputText"
        placeholder="Tell me about your stuff..."
        outlined rounded dense
        class="chat-text-input"
        @keyup.enter="send"
        :disable="store.isLoading"
      />
      <q-btn round color="primary" icon="send"
             :loading="store.isLoading"
             :disable="!inputText.trim() && pendingAttachments.length === 0"
             @click="send" />
    </div>

    <!-- Hidden file input -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*,video/mp4,video/quicktime,video/webm"
      style="display: none"
      @change="handleFileSelected"
    />
  </div>
</template>

<style scoped>
.census-chat {
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
}
.message-bubble.user {
  white-space: pre-wrap;
  background: #1976d2;
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
  font-weight: 600;
}
.msg-text :deep(code) {
  background: rgba(0,0,0,0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 13px;
}
.msg-text :deep(h1),
.msg-text :deep(h2),
.msg-text :deep(h3) {
  font-size: 15px;
  font-weight: 600;
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
  font-size: 13px;
}
.msg-text :deep(th),
.msg-text :deep(td) {
  border: 1px solid #ddd;
  padding: 4px 8px;
}
.msg-text :deep(th) {
  background: rgba(0,0,0,0.04);
  font-weight: 600;
}

.msg-attachments {
  margin-bottom: 8px;
}
.msg-photo {
  max-width: 200px;
  max-height: 200px;
  border-radius: 8px;
  object-fit: cover;
}

.msg-text :deep(.msg-inline-photo) {
  display: block;
  max-width: 100%;
  max-height: 240px;
  border-radius: 8px;
  object-fit: cover;
  margin: 8px 0;
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

/* Status indicator */
.message-bubble.typing {
  padding: 10px 16px;
}
.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.status-label {
  font-size: 13px;
  color: #666;
  animation: statusFade 1.5s ease-in-out infinite;
}
@keyframes statusFade {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

/* Attachment preview */
.attachment-preview {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  background: white;
  border-top: 1px solid #eee;
  flex-shrink: 0;
}
.att-thumb-wrap {
  position: relative;
}
.att-thumb {
  width: 60px;
  height: 60px;
  border-radius: 8px;
  object-fit: cover;
}
.att-video-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #333;
}
.att-remove {
  position: absolute;
  top: -4px;
  right: -4px;
  background: rgba(0,0,0,0.6);
  color: white;
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
