<script setup lang="ts">
import { ref, onMounted, defineEmits } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { useQuasar } from 'quasar';

const route = useRoute();
const router = useRouter();
const $q = useQuasar();

const emits = defineEmits<{
  (e: 'app:loading', value: boolean): void
}>();

// To adjust url based on whether in prod or not
const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

const email = ref('');
const emailError = ref(false);
const emailErrorMessage = ref('');
const isSubmitting = ref(false);
const isVerifying = ref(false);
const emailSent = ref(false);
const verificationError = ref('');
const isDevelopment = import.meta.env.MODE === 'development';

onMounted(async () => {
  emits('app:loading', false);

  // Check if we have a token in the URL (magic link callback)
  const token = route.query.token as string;
  if (token) {
    await verifyMagicLink(token);
  }

  // Check if user is already logged in
  const sessionToken = localStorage.getItem('session_token');
  if (sessionToken && !token) {
    // Verify the session token is still valid
    try {
      const response = await axios.get(`${core_url}/auth/me`, {
        headers: {
          Authorization: `Bearer ${sessionToken}`
        }
      });

      if (response.data.success) {
        // User is already logged in, redirect to items
        router.push('/items');
      }
    } catch (error) {
      // Session expired or invalid, clear it
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

const requestMagicLink = async () => {
  if (!validateEmail()) {
    return;
  }

  isSubmitting.value = true;

  try {
    const response = await axios.post(`${core_url}/auth/request-magic-link`, {
      email: email.value
    });

    if (response.data.success) {
      emailSent.value = true;
      $q.notify({
        type: 'positive',
        message: 'Check your email for the login link!',
        caption: 'The link will expire in 15 minutes'
      });
    } else {
      $q.notify({
        type: 'negative',
        message: response.data.error || 'Failed to send magic link'
      });
    }
  } catch (error: any) {
    console.error('Error requesting magic link:', error);
    $q.notify({
      type: 'negative',
      message: error.response?.data?.error || 'Failed to send magic link'
    });
  } finally {
    isSubmitting.value = false;
  }
};

const verifyMagicLink = async (token: string) => {
  isVerifying.value = true;
  emits('app:loading', true);

  try {
    const response = await axios.get(`${core_url}/auth/verify-magic-link`, {
      params: { token }
    });

    if (response.data.success) {
      // Store session token and user data
      localStorage.setItem('session_token', response.data.sessionToken);
      localStorage.setItem('user_data', JSON.stringify(response.data.user));

      $q.notify({
        type: 'positive',
        message: `Welcome back!`
      });

      // Redirect to items page
      setTimeout(() => {
        router.push('/items');
      }, 500);
    } else {
      verificationError.value = response.data.error || 'Invalid or expired magic link';
      $q.notify({
        type: 'negative',
        message: verificationError.value
      });
    }
  } catch (error: any) {
    console.error('Error verifying magic link:', error);
    verificationError.value = error.response?.data?.error || 'Failed to verify magic link';
    $q.notify({
      type: 'negative',
      message: verificationError.value
    });
  } finally {
    isVerifying.value = false;
    emits('app:loading', false);
  }
};

const tryAgain = () => {
  emailSent.value = false;
  verificationError.value = '';
  email.value = '';
};
</script>

<template>
  <div class="login-container">
    <q-card class="login-card">
      <q-card-section>
        <div class="text-h4 q-mb-md">
          {{ isVerifying ? 'Verifying...' : 'Login to MoveTrack' }}
        </div>

        <!-- Verifying state -->
        <div v-if="isVerifying" class="text-center q-py-lg">
          <q-spinner color="primary" size="50px" />
          <div class="q-mt-md text-body1">Logging you in...</div>
        </div>

        <!-- Verification error -->
        <div v-else-if="verificationError" class="text-center q-py-lg">
          <q-icon name="error" color="negative" size="50px" />
          <div class="q-mt-md text-body1 text-negative">{{ verificationError }}</div>
          <q-btn
            color="primary"
            label="Try Again"
            class="q-mt-md"
            @click="tryAgain"
          />
        </div>

        <!-- Email sent confirmation -->
        <div v-else-if="emailSent" class="text-center q-py-lg">
          <q-icon name="mail" color="positive" size="50px" />
          <div class="q-mt-md text-h6">Check your email!</div>
          <div class="q-mt-sm text-body2">
            We've sent a magic link to <strong>{{ email }}</strong>
          </div>
          <div class="q-mt-sm text-body2 text-grey-7">
            Click the link in the email to log in. The link will expire in 15 minutes.
          </div>
          <div v-if="isDevelopment" class="q-mt-md q-pa-md bg-grey-3 rounded-borders">
            <div class="text-caption text-weight-bold">Development Mode</div>
            <div class="text-caption">Check the API console for the magic link</div>
          </div>
          <q-btn
            flat
            color="primary"
            label="Send Another Link"
            class="q-mt-md"
            @click="tryAgain"
          />
        </div>

        <!-- Login form -->
        <div v-else>
          <div class="text-body1 q-mb-lg">
            Enter your email address and we'll send you a magic link to log in.
          </div>

          <q-input
            v-model="email"
            label="Email Address"
            type="email"
            outlined
            :error="emailError"
            :error-message="emailErrorMessage"
            @update:model-value="emailError = false"
            @keyup.enter="requestMagicLink"
            class="q-mb-md"
          >
            <template v-slot:prepend>
              <q-icon name="mail" />
            </template>
          </q-input>

          <q-btn
            color="primary"
            label="Send Magic Link"
            :loading="isSubmitting"
            :disable="isSubmitting"
            @click="requestMagicLink"
            class="full-width"
            size="lg"
          />

          <div class="q-mt-lg text-center text-body2 text-grey-7">
            No password needed. We'll email you a secure login link.
          </div>
        </div>
      </q-card-section>
    </q-card>
  </div>
</template>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 80vh;
  padding: 20px;
}

.login-card {
  width: 100%;
  max-width: 500px;
}

@media (max-width: 600px) {
  .login-container {
    min-height: 60vh;
  }
}
</style>
