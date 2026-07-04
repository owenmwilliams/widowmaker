<script setup lang="ts">
import { ref, onMounted, nextTick, computed, defineEmits } from 'vue';
import { API_BASE_URL } from "../config/api";
import { isMobileViewport } from '../utils/viewport';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { CircleAlert, Mail } from 'lucide-vue-next';
import { useQuasar } from 'quasar';


const route = useRoute();
const router = useRouter();
const $q = useQuasar();

const emits = defineEmits<{
  (e: 'app:loading', value: boolean): void
}>();

const core_url = API_BASE_URL;

const email = ref('');
const emailError = ref(false);
const emailErrorMessage = ref('');
const isSubmitting = ref(false);
// Check for token in URL immediately to avoid showing login form (magic-link callback)
const hasTokenInUrl = !!route.query.token;
const isVerifying = ref(hasTokenInUrl);
const verificationError = ref('');
const isDevelopment = import.meta.env.MODE === 'development';

// 6-digit code flow
const codeSent = ref(false);
const digits = ref<string[]>(['', '', '', '', '', '']);
const inputs = ref<HTMLInputElement[]>([]);
const codeError = ref('');
const isVerifyingCode = ref(false);
const code = computed(() => digits.value.join(''));

onMounted(async () => {
  emits('app:loading', false);

  // Magic-link callback still works if a user clicks an old link.
  const token = route.query.token as string;
  if (token) {
    await verifyMagicLink(token);
  }

  // Check if user is already logged in
  const sessionToken = localStorage.getItem('session_token');
  if (sessionToken && !token) {
    try {
      const response = await axios.get(`${core_url}/auth/me`, {
        headers: { Authorization: `Bearer ${sessionToken}` }
      });
      if (response.data.success) {
        if (response.data.user) {
          localStorage.setItem('user_data', JSON.stringify(response.data.user));
        }
        redirectAfterLogin(response.data.user);
      }
    } catch (error) {
      localStorage.removeItem('session_token');
      localStorage.removeItem('user_data');
    }
  }
});

const validateEmail = () => {
  if (!email.value) {
    emailError.value = true;
    emailErrorMessage.value = 'Email is required';
    return false;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.value)) {
    emailError.value = true;
    emailErrorMessage.value = 'Invalid email format';
    return false;
  }
  emailError.value = false;
  emailErrorMessage.value = '';
  return true;
};

const requestCode = async () => {
  if (!validateEmail()) return;

  // Clear any existing session so the old user doesn't persist
  localStorage.removeItem('session_token');
  localStorage.removeItem('user_data');

  isSubmitting.value = true;
  try {
    const response = await axios.post(`${core_url}/auth/request-code`, { email: email.value });
    if (response.data.success) {
      codeSent.value = true;
      digits.value = ['', '', '', '', '', ''];
      codeError.value = '';
      await nextTick();
      inputs.value[0]?.focus();
      $q.notify({ type: 'positive', message: 'We emailed you a 6-digit code', caption: 'It expires in 10 minutes' });
    } else {
      $q.notify({ type: 'negative', message: response.data.error || 'Failed to send code' });
    }
  } catch (error: any) {
    console.error('Error requesting code:', error);
    $q.notify({ type: 'negative', message: error.response?.data?.error || 'Failed to send code' });
  } finally {
    isSubmitting.value = false;
  }
};

// ── 6-box input handling ──
const onDigitInput = (i: number, e: Event) => {
  const target = e.target as HTMLInputElement;
  const val = target.value.replace(/\D/g, '');
  codeError.value = '';
  if (!val) { digits.value[i] = ''; return; }
  // Take the last typed character (handles overwrite)
  digits.value[i] = val[val.length - 1];
  target.value = digits.value[i];
  if (i < 5) {
    nextTick(() => inputs.value[i + 1]?.focus());
  } else if (code.value.length === 6) {
    verifyCode();
  }
};

const onDigitKeydown = (i: number, e: KeyboardEvent) => {
  if (e.key === 'Backspace' && !digits.value[i] && i > 0) {
    inputs.value[i - 1]?.focus();
    digits.value[i - 1] = '';
  } else if (e.key === 'ArrowLeft' && i > 0) {
    inputs.value[i - 1]?.focus();
  } else if (e.key === 'ArrowRight' && i < 5) {
    inputs.value[i + 1]?.focus();
  }
};

const onDigitPaste = (e: ClipboardEvent) => {
  e.preventDefault();
  const pasted = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
  if (!pasted) return;
  const next = ['', '', '', '', '', ''];
  for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
  digits.value = next;
  codeError.value = '';
  nextTick(() => {
    const focusIdx = Math.min(pasted.length, 5);
    inputs.value[focusIdx]?.focus();
    if (pasted.length === 6) verifyCode();
  });
};

const verifyCode = async () => {
  if (code.value.length !== 6) {
    codeError.value = 'Enter all 6 digits';
    return;
  }
  isVerifyingCode.value = true;
  codeError.value = '';
  try {
    const response = await axios.post(`${core_url}/auth/verify-code`, {
      email: email.value,
      code: code.value
    });
    if (response.data.success) {
      const sessionToken = response.data.session_token || response.data.sessionToken;
      if (!sessionToken) throw new Error('Missing session token in auth response');
      localStorage.setItem('session_token', sessionToken);
      localStorage.setItem('user_data', JSON.stringify(response.data.user));
      if (isDevelopment) {
        sessionStorage.setItem('dev_session_backup', sessionToken);
        sessionStorage.setItem('dev_user_backup', JSON.stringify(response.data.user));
      }
      $q.notify({ type: 'positive', message: 'Welcome back!' });
      redirectAfterLogin(response.data.user);
    } else {
      codeError.value = response.data.error || 'Invalid or expired code';
      resetDigits();
    }
  } catch (error: any) {
    console.error('Error verifying code:', error);
    codeError.value = error.response?.data?.error || 'Invalid or expired code';
    resetDigits();
  } finally {
    isVerifyingCode.value = false;
  }
};

const resetDigits = () => {
  digits.value = ['', '', '', '', '', ''];
  nextTick(() => inputs.value[0]?.focus());
};

const verifyMagicLink = async (token: string) => {
  isVerifying.value = true;
  emits('app:loading', true);
  try {
    const response = await axios.get(`${core_url}/auth/verify-magic-link`, { params: { token } });
    if (response.data.success) {
      const sessionToken = response.data.sessionToken || response.data.session_token;
      if (!sessionToken) throw new Error('Missing session token in auth response');
      localStorage.setItem('session_token', sessionToken);
      localStorage.setItem('user_data', JSON.stringify(response.data.user));
      if (isDevelopment) {
        sessionStorage.setItem('dev_session_backup', sessionToken);
        sessionStorage.setItem('dev_user_backup', JSON.stringify(response.data.user));
      }
      $q.notify({ type: 'positive', message: `Welcome back!` });
      isVerifying.value = false;
      emits('app:loading', false);
      redirectAfterLogin(response.data.user);
    } else {
      verificationError.value = response.data.error || 'Invalid or expired magic link';
      isVerifying.value = false;
      emits('app:loading', false);
      $q.notify({ type: 'negative', message: verificationError.value });
    }
  } catch (error: any) {
    console.error('Error verifying magic link:', error);
    verificationError.value = error.response?.data?.error || 'Failed to verify magic link';
    isVerifying.value = false;
    emits('app:loading', false);
    $q.notify({ type: 'negative', message: verificationError.value });
  }
};

const tryAgain = () => {
  codeSent.value = false;
  verificationError.value = '';
  codeError.value = '';
  digits.value = ['', '', '', '', '', ''];
  email.value = '';
};

const redirectAfterLogin = (_user: any) => {
  router.push(isMobileViewport() ? '/mobile/nexus' : '/nexus');
};
</script>

<template>
  <!-- Full-screen loading when verifying magic link -->
  <div v-if="isVerifying" class="fullscreen-loading">
    <div class="fullscreen-loading__aurora" aria-hidden="true"></div>
    <div class="loading-content">
      <q-spinner color="white" size="80px" />
      <div class="loading-title q-mt-lg">Logging you in...</div>
      <div class="loading-sub q-mt-sm">Please wait a moment</div>
    </div>
  </div>

  <div v-else class="login-container">
    <q-card class="login-card" flat bordered>
      <q-card-section>
        <div class="logo-row">
          <img src="../assets/brand/logo-lockup-light.svg" alt="Nexus Moves" class="login-logo" height="34" />
        </div>

        <!-- Verification error (magic link) -->
        <div v-if="verificationError" class="text-center q-py-lg">
          <CircleAlert :size="50" class="error-icon" aria-hidden="true" />
          <div class="q-mt-md text-body1 error-text">{{ verificationError }}</div>
          <q-btn unelevated no-caps color="primary" label="Try again" class="q-mt-md" @click="tryAgain" />
        </div>

        <!-- Code entry -->
        <div v-else-if="codeSent">
          <div class="login-title text-center">Enter your code</div>
          <div class="hint-text text-center q-mt-xs q-mb-lg">
            We sent a 6-digit code to <strong>{{ email }}</strong>
          </div>

          <div class="code-boxes" @paste="onDigitPaste">
            <input
              v-for="(d, i) in digits"
              :key="i"
              :ref="el => { if (el) inputs[i] = el as HTMLInputElement }"
              class="code-box"
              :class="{ 'code-box--error': codeError }"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="1"
              :value="d"
              :disabled="isVerifyingCode"
              @input="onDigitInput(i, $event)"
              @keydown="onDigitKeydown(i, $event)"
            />
          </div>

          <div v-if="codeError" class="error-text text-center text-body2 q-mt-sm">{{ codeError }}</div>

          <q-btn
            unelevated
            no-caps
            color="primary"
            label="Verify and log in"
            :loading="isVerifyingCode"
            :disable="isVerifyingCode || code.length !== 6"
            @click="verifyCode"
            class="full-width q-mt-lg"
            size="lg"
          />

          <div v-if="isDevelopment" class="dev-note q-mt-md q-pa-sm text-center">
            <div class="text-caption text-weight-bold">Development mode</div>
            <div class="text-caption">Check the API console for the code</div>
          </div>

          <div class="row justify-center q-mt-md q-gutter-sm">
            <q-btn flat dense no-caps color="primary" label="Resend code" :disable="isSubmitting" @click="requestCode" />
            <q-btn flat dense no-caps class="quiet-btn" label="Use a different email" @click="tryAgain" />
          </div>
        </div>

        <!-- Email form -->
        <div v-else>
          <div class="login-title text-center q-mb-xs">Log in to Nexus Moves</div>
          <div class="hint-text text-center q-mb-lg">
            Enter your email and we'll send you a 6-digit code.
          </div>

          <q-input
            v-model="email"
            label="Email address"
            type="email"
            outlined
            :error="emailError"
            :error-message="emailErrorMessage"
            @update:model-value="emailError = false"
            @keyup.enter="requestCode"
            class="q-mb-md"
          >
            <template v-slot:prepend>
              <Mail :size="22" class="input-icon" aria-hidden="true" />
            </template>
          </q-input>

          <q-btn
            unelevated
            no-caps
            color="primary"
            label="Email me a code"
            :loading="isSubmitting"
            :disable="isSubmitting"
            @click="requestCode"
            class="full-width"
            size="lg"
          />

          <div class="hint-text q-mt-lg text-center">
            No password needed — just a quick code by email.
          </div>
        </div>
      </q-card-section>
    </q-card>
  </div>
</template>

<style scoped>
.fullscreen-loading {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  background: var(--navy-800);
  overflow: hidden;
  z-index: 9999;
}

.fullscreen-loading__aurora {
  position: absolute;
  inset: 0;
  background: var(--aurora);
  pointer-events: none;
}

.loading-content {
  position: relative;
  text-align: center;
  color: var(--text-on-accent);
}

.loading-title {
  font-family: var(--font-display);
  font-size: var(--fs-title-l);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-display);
}

.loading-sub {
  font-size: var(--fs-body);
  color: var(--text-on-accent);
  opacity: 0.75;
}

.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 80vh;
  padding: var(--sp-6);
  background: var(--bg);
}

.login-card {
  width: 100%;
  max-width: 440px;
  border-radius: var(--r-lg);
  background: var(--surface-card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
}

.logo-row {
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: var(--sp-6);
}

.login-logo {
  display: block;
  height: 34px;
  width: auto;
}

.login-title {
  font-family: var(--font-display);
  font-size: var(--fs-title-m);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-display);
  color: var(--text-primary);
}

.hint-text {
  font-size: var(--fs-body);
  color: var(--text-secondary);
  line-height: var(--lh-body);
}

.error-icon {
  color: var(--danger);
}

.error-text {
  color: var(--danger);
}

.input-icon {
  color: var(--text-tertiary);
}

.quiet-btn {
  color: var(--text-secondary);
}

.dev-note {
  background: var(--surface-hover);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text-secondary);
}

.q-btn {
  border-radius: var(--r-md);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
}

.q-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.q-btn:active {
  transform: scale(0.97);
}

.q-btn.disabled {
  opacity: 0.45 !important;
}

.q-btn.bg-primary:hover {
  background: var(--accent-hover) !important;
}

.code-boxes {
  display: flex;
  justify-content: center;
  gap: var(--sp-4);
}

.code-box {
  width: 48px;
  height: 58px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: var(--fs-title-l);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  border: 1.5px solid var(--border);
  border-radius: var(--r-md);
  outline: none;
  transition: border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
  background: var(--surface-card);
}

.code-box:focus {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.code-box:disabled {
  opacity: 0.45;
}

.code-box--error {
  border-color: var(--danger);
}

@media (max-width: 420px) {
  .code-box { width: 42px; height: 52px; font-size: var(--fs-title-m); }
  .code-boxes { gap: var(--sp-3); }
}

@media (max-width: 600px) {
  .login-container { min-height: 60vh; }
}
</style>
