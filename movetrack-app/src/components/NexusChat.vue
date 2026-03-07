<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { nexusStore, type NexusMessage, type NexusAction } from '../stores/NexusStore';

const props = defineProps<{ user: string }>();

const router = useRouter();
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
    default: return 'build';
  }
};

const actionLabel = (action: NexusAction): string => {
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
  return action.tool.replace(/_/g, ' ');
};

const isAddAction = (action: NexusAction): boolean => {
  return ['add_item', 'add_room', 'set_location'].includes(action.tool) && !!action.result?.success;
};

// ── Session management ───────────────────────────────────────────────────────
const showSessionPicker = ref(false);

const loadSessionList = async () => {
  await store.loadSessions();
  showSessionPicker.value = true;
};

const resumeSession = (id: string) => {
  store.loadSession(id);
  showSessionPicker.value = false;
};

const newSession = () => {
  store.startNewSession();
  showSessionPicker.value = false;
};
</script>

<template>
  <div class="nexus-chat">
    <!-- Header -->
    <div class="chat-header">
      <div class="header-left">
        <q-btn flat dense round icon="arrow_back" @click="router.back()" />
        <q-icon name="auto_awesome" size="24px" color="primary" />
        <span class="header-title">Nexus</span>
      </div>
      <div class="header-right">
        <q-btn flat dense round icon="history" @click="loadSessionList" title="Past conversations" />
        <q-btn flat dense round icon="add_comment" @click="newSession" title="New conversation" />
      </div>
    </div>

    <!-- Session Picker Dialog -->
    <q-dialog v-model="showSessionPicker">
      <q-card style="min-width: 320px; max-width: 420px;">
        <q-card-section>
          <div class="text-h6">Conversations</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-list separator v-if="store.sessions.length > 0">
            <q-item
              v-for="s in store.sessions"
              :key="s.id"
              clickable
              v-ripple
              @click="resumeSession(s.id)"
            >
              <q-item-section>
                <q-item-label>{{ s.title || 'Untitled' }}</q-item-label>
                <q-item-label caption>
                  {{ s.items_added }} items, {{ s.rooms_added }} rooms
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn flat dense round icon="delete" size="sm"
                       @click.stop="store.deleteSession(s.id)" />
              </q-item-section>
            </q-item>
          </q-list>
          <div v-else class="text-grey text-center q-pa-md">
            No past conversations yet.
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="New conversation" color="primary" @click="newSession" />
          <q-btn flat label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

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
            clickable outline color="primary"
            @click="inputText = 'I\'m planning a move'; send()"
          >I'm planning a move</q-chip>
          <q-chip
            clickable outline color="primary"
            @click="inputText = 'I want to catalog my stuff'; send()"
          >Catalog my stuff</q-chip>
          <q-chip
            clickable outline color="primary"
            @click="inputText = 'Let\'s go room by room'; send()"
          >Go room by room</q-chip>
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
          <div class="msg-text" v-if="msg.content">{{ msg.content }}</div>

          <!-- Action chips (on model messages) -->
          <div v-if="msg.actions && msg.actions.length > 0" class="msg-actions">
            <q-chip
              v-for="(action, i) in msg.actions.filter(isAddAction)"
              :key="i"
              :icon="actionIcon(action.tool)"
              size="sm"
              color="positive"
              text-color="white"
              dense
            >{{ actionLabel(action) }}</q-chip>
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
.nexus-chat {
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

.msg-attachments {
  margin-bottom: 8px;
}
.msg-photo {
  max-width: 200px;
  max-height: 200px;
  border-radius: 8px;
  object-fit: cover;
}

.msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
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
