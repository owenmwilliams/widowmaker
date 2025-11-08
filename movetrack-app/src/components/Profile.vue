<script setup lang="ts">
  import { onMounted, ref, watch } from 'vue'
  import { debounce } from 'debounce'
  import axios from 'axios';
  import router from '../router';

  const emits = defineEmits<{
    (e: 'app:loading', id: boolean): void
  }>()

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

  // To adjust url based on whether in prod or not
  const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'

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
