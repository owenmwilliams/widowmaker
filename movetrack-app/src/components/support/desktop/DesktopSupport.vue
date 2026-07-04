<script setup lang="ts">
import { ref } from 'vue';
import { API_BASE_URL } from "../../../config/api";
import { useQuasar } from 'quasar';
import axios from 'axios';

const core_url = API_BASE_URL;

const $q = useQuasar();

const name = ref('');
const email = ref('');
const message = ref('');

const onSubmit = async () => {
  const requestData = {
    name: name.value,
    email: email.value,
    message: message.value
  };

  try {
    $q.loading.show({ message: 'Sending message...' });
    await axios.post(`${core_url}/email/send`, requestData);
    $q.notify({
      type: 'positive',
      message: 'Message sent successfully! We\'ll get back to you soon.',
      position: 'bottom',
      timeout: 3000
    });
    name.value = '';
    email.value = '';
    message.value = '';
  } catch (error) {
    console.error('Error sending message:', error);
    $q.notify({
      type: 'negative',
      message: 'Error sending message. Please try again.',
      position: 'bottom'
    });
  } finally {
    $q.loading.hide();
  }
};
</script>

<template>
  <div class="support-container">
    <div class="support-header q-pa-md">
      <h5 class="text-h5 text-primary q-my-none">Support</h5>
      <p class="text-caption text-grey-7 q-mt-xs">
        Have a question or need help? Send us a message and we'll get back to you as soon as possible
      </p>
    </div>

    <div class="support-content">
      <q-card class="support-card">
        <q-card-section>
          <div class="section-header q-mb-md">
            <q-icon name="email" size="md" color="primary" class="q-mr-md" />
            <div class="text-h6">Get in Touch</div>
          </div>

          <q-form @submit.prevent="onSubmit">
            <q-input
              v-model="name"
              label="Your Name *"
              outlined
              class="q-mb-md"
              :rules="[val => !!val || 'Name is required']"
            />

            <q-input
              v-model="email"
              label="Your Email *"
              type="email"
              outlined
              class="q-mb-md"
              :rules="[
                val => !!val || 'Email is required',
                val => /.+@.+\..+/.test(val) || 'Please enter a valid email'
              ]"
            />

            <q-input
              v-model="message"
              label="Message *"
              type="textarea"
              outlined
              rows="6"
              class="q-mb-md"
              :rules="[val => !!val || 'Message is required']"
            />

            <q-btn
              unelevated
              color="primary"
              label="Send Message"
              type="submit"
              icon="send"
              class="full-width"
              size="lg"
            />
          </q-form>
        </q-card-section>
      </q-card>

      <!-- FAQ Section -->
      <q-card class="support-card q-mt-lg">
        <q-card-section>
          <div class="section-header q-mb-md">
            <q-icon name="help_outline" size="md" color="primary" class="q-mr-md" />
            <div class="text-h6">Frequently Asked Questions</div>
          </div>

          <q-list>
            <q-expansion-item
              icon="camera_alt"
              label="How does photo AI analysis work?"
              dense
            >
              <q-card>
                <q-card-section class="text-grey-8">
                  Our AI-powered photo analysis uses advanced computer vision to automatically detect item details like dimensions, weight, material, and color from your photos. Simply snap a picture, and we'll pre-fill the item details for you to review and confirm.
                </q-card-section>
              </q-card>
            </q-expansion-item>

            <q-expansion-item
              icon="inventory_2"
              label="How do collections and containers work?"
              dense
            >
              <q-card>
                <q-card-section class="text-grey-8">
                  Collections represent groups of related items (like "Kitchen", "Bedroom", or "Office"). Within each collection, you can create containers (boxes) to organize your items. Think of collections as rooms and containers as the boxes you pack them in.
                </q-card-section>
              </q-card>
            </q-expansion-item>

            <q-expansion-item
              icon="security"
              label="Is my data secure?"
              dense
            >
              <q-card>
                <q-card-section class="text-grey-8">
                  Yes! All your data is encrypted in transit and at rest. We use industry-standard security practices to protect your information. Your photos and inventory details are private and only accessible to you.
                </q-card-section>
              </q-card>
            </q-expansion-item>

            <q-expansion-item
              icon="share"
              label="Can I share my inventory with movers?"
              dense
            >
              <q-card>
                <q-card-section class="text-grey-8">
                  Yes! You can generate shareable links for your items to provide accurate inventory lists to moving companies for precise quotes. This helps ensure you get fair pricing based on what you actually need to move.
                </q-card-section>
              </q-card>
            </q-expansion-item>
          </q-list>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<style scoped>
.support-container {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--sp-7);
}

.support-header {
  margin-bottom: var(--sp-8);
}

.support-content {
  display: flex;
  flex-direction: column;
}

.support-card {
  background: var(--surface-card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border);
}

.section-header {
  display: flex;
  align-items: center;
}
</style>
