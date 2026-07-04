<script setup lang="ts">
  import { onMounted, ref, watch } from 'vue'
  import { debounce } from 'debounce'
  import axios from 'axios';
  import router from '../router';
  import { useQuasar } from 'quasar';
  import { API_BASE_URL } from '../config/api';

  const emits = defineEmits<{
    (e: 'app:loading', id: boolean): void
  }>()

  const $q = useQuasar();

  const username = ref('');
  const usernameError = ref(false);
  const usernameErrorMessage = ref('');
  const firstName = ref('');
  const firstNameError = ref(false);
  const firstNameErrorMessage = ref('');
  const lastName = ref('');
  const lastNameError = ref(false);
  const lastNameErrorMessage = ref('');
  const email = ref('');
  const emailError = ref(false);
  const emailErrorMessage = ref('');
  const phone = ref('');
  const phoneError = ref(false);
  const phoneErrorMessage = ref('');

  // Get user data from localStorage
  const userData = JSON.parse(localStorage.getItem('user_data') || '{}');

  if (userData.email) {
    email.value = userData.email
  }

  if (userData.firstName) {
    firstName.value = userData.firstName
  }

  if (userData.lastName) {
    lastName.value = userData.lastName
  }

  if (userData.username) {
    username.value = userData.username
  }

  const core_url = API_BASE_URL;

  const addUser = async () => {
    const sessionToken = localStorage.getItem('session_token');

    try {
      await axios({
        method: 'post',
        url: core_url + '/users/post',
        params: {
          user_id: userData.userId,
          username: username.value,
          firstname: firstName.value,
          lastname: lastName.value,
          email: email.value,
          phone: phone.value
        },
        headers: {
          Authorization: 'Bearer ' + sessionToken
        }
      });

      router.push({ name: 'items', query: { user: username.value }});
    } catch (error) {
      console.error('Error updating profile:', error);
    }
  }

  onMounted(() => {
    emits('app:loading', false)
  })

  watch(username, debounce( async () => {
    const sessionToken = localStorage.getItem('session_token');

    try {
      const response = await axios({
        method: 'get',
        url: core_url + '/users/usercheck',
        params: {
          username: username.value
        },
        headers: {
          Authorization: 'Bearer ' + sessionToken
        }
      });

      console.log(response.data[0].count)
      if (response.data[0].count > 0) {
        usernameError.value = true
        usernameErrorMessage.value = 'Username already taken.'
      } else {
        usernameError.value = false
        usernameErrorMessage.value = ''
      }
    } catch (error) {
      console.error('Error checking username:', error);
    }
  }, 500));

  // THIS DEBOUNCE IS NOT A SECURITY FEATURE
  watch(email, debounce( () => {
    if (email.value !== '') {
      if (!email.value.includes('@') || !email.value.includes('.')) {
        emailError.value = true
        emailErrorMessage.value = 'Invalid email address.'
      } else {
        emailError.value = false
        emailErrorMessage.value = ''
      }
    } else {
      emailError.value = false
      emailErrorMessage.value = ''

    }
  }, 500));

  // Account deletion
  const showDeleteSection = ref(false);
  const deleteConfirmation = ref('');
  const isDeletingAccount = ref(false);

  const handleDeleteAccount = () => {
    $q.dialog({
      title: '⚠️ Delete Account',
      message: 'This will permanently delete your account and ALL your data including:\n\n• All items in your inventory\n• All collections and containers\n• All locations and moves\n• All uploaded images\n\nThis action CANNOT be undone.\n\nType "DELETE" to confirm:',
      prompt: {
        model: '',
        type: 'text',
        isValid: (val: string) => val === 'DELETE'
      },
      cancel: true,
      persistent: true
    }).onOk(async () => {
      await deleteAccount();
    });
  };

  const deleteAccount = async () => {
    const sessionToken = localStorage.getItem('session_token');

    if (!sessionToken) {
      $q.notify({
        type: 'negative',
        message: 'Please log in to delete your account',
        position: 'bottom'
      });
      return;
    }

    isDeletingAccount.value = true;

    $q.loading.show({
      message: 'Deleting your account and all data...'
    });

    try {
      const response = await axios({
        method: 'delete',
        url: core_url + '/users/account',
        headers: {
          Authorization: 'Bearer ' + sessionToken
        }
      });

      console.log('Account deletion response:', response.data);

      $q.loading.hide();

      $q.notify({
        type: 'positive',
        message: 'Your account has been permanently deleted',
        position: 'bottom',
        timeout: 3000
      });

      // Clear all local storage
      localStorage.clear();

      // Redirect to home page
      setTimeout(() => {
        router.push({ name: 'home' });
      }, 1500);

    } catch (error: any) {
      console.error('Error deleting account:', error);

      $q.loading.hide();
      isDeletingAccount.value = false;

      $q.notify({
        type: 'negative',
        message: error.response?.data?.message || 'Failed to delete account. Please try again.',
        position: 'bottom',
        timeout: 5000
      });
    }
  };
</script>

<template>
  <q-card
    class="q-pa-md"
    style="max-width: 80vw; margin: auto">
    <q-card-section>
      <div class="text-h4">Profile</div>
      <div class="text-body1">Please fill out the following information to complete your profile.</div>
    </q-card-section>
    <q-separator />
    <q-card-section>
      <q-input
        v-model="username"
        label="Username"
        :error="usernameError"
        :error-message="usernameErrorMessage"
        :rules="[val => val.length > 0 || 'Username is required']" />
      <q-input
        v-model="firstName"
        label="First Name"
        :error="firstNameError"
        :error-message="firstNameErrorMessage"
        :rules="[val => val.length > 0 || 'First Name is required']" />
      <q-input
        v-model="lastName"
        label="Last Name"
        :error="lastNameError"
        :error-message="lastNameErrorMessage"
        :rules="[val => val.length > 0 || 'Last Name is required']" />
      <q-input
        v-model="email"
        label="Email"
        :error="emailError"
        :error-message="emailErrorMessage"
        :rules="[val => val.length > 0 || 'Email is required']" />
      <q-input
        v-model="phone"
        label="Phone (optional)"
        :error="phoneError"
        :error-message="phoneErrorMessage" />
    </q-card-section>
    <q-card-actions align="right">
      <q-btn
        color="primary"
        label="Submit"
        :disable="usernameError"
        @click="addUser" />
    </q-card-actions>
  </q-card>

  <!-- Danger Zone - Account Deletion -->
  <q-card
    class="q-pa-md q-mt-xl"
    style="max-width: 80vw; margin: auto; border: 2px solid #c10015;">
    <q-card-section>
      <div class="text-h5 text-negative">⚠️ Danger Zone</div>
      <div class="text-body2 text-grey-7">Irreversible actions</div>
    </q-card-section>
    <q-separator />
    <q-card-section>
      <q-expansion-item
        v-model="showDeleteSection"
        icon="delete_forever"
        label="Delete Account"
        caption="Permanently delete your account and all data"
        header-class="text-negative">
        <q-card class="q-mt-md" flat bordered>
          <q-card-section class="bg-red-1">
            <div class="text-body1 q-mb-md">
              <strong>This will permanently delete:</strong>
            </div>
            <ul class="text-body2">
              <li>All items in your inventory</li>
              <li>All collections, containers, and locations</li>
              <li>All saved moves and move sessions</li>
              <li>All uploaded images</li>
              <li>Your user account</li>
            </ul>
            <div class="text-body2 text-weight-bold q-mt-md text-negative">
              ⚠️ This action CANNOT be undone. All your data will be permanently erased.
            </div>
          </q-card-section>
          <q-card-actions align="right" class="q-pa-md">
            <q-btn
              outline
              color="negative"
              label="Delete My Account"
              icon="delete_forever"
              :loading="isDeletingAccount"
              @click="handleDeleteAccount" />
          </q-card-actions>
        </q-card>
      </q-expansion-item>
    </q-card-section>
  </q-card>

  <!-- <van-cell-group inset>
    <van-field
      v-model="username"
      required
      placeholder="Username"
      :error=usernameError
      :error-message=usernameErrorMessage
    />
    <van-field
      v-model="firstName"
      required
      placeholder="First Name"
      :error=firstNameError
      :error-message=firstNameErrorMessage
    />
    <van-field
      v-model="lastName"
      required
      placeholder="Last Name"
      :error=lastNameError
      :error-message=lastNameErrorMessage
    />
    <van-field
      v-model="email"
      required
      placeholder="Email"
      :error=emailError
      :error-message=emailErrorMessage
    />
    <van-field
      v-model="phone"
      placeholder="Phone (optional)"
      :error=phoneError
      :error-message=phoneErrorMessage
    />
    <div v-if="usernameError">
      <van-button size="large" color="#FF865E" disabled>Submit</van-button>
    </div>
    <div v-else>
      <van-button size="large" color="#FF865E" @click="addUser">Submit</van-button>
    </div>
    
  </van-cell-group> -->
</template>

<style scoped>

</style>
