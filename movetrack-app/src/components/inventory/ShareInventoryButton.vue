<script setup lang="ts">
import { ref } from 'vue'
import { API_BASE_URL } from "../../config/api";
import axios from 'axios'
import { useQuasar } from 'quasar'

// Creates a tokenized public share link for the user's inventory and surfaces it
// for copy / native share. Self-contained (no store dependency).
withDefaults(defineProps<{ label?: string; flat?: boolean; dense?: boolean }>(), {
  label: 'Share with movers',
  flat: false,
  dense: false,
})

const $q = useQuasar()
const core_url = API_BASE_URL;

const loading = ref(false)
const showDialog = ref(false)
const shareUrl = ref('')

const headers = () => {
  const t = localStorage.getItem('session_token')
  return t ? { Authorization: 'Bearer ' + t } : {}
}

async function createLink() {
  loading.value = true
  try {
    const { data } = await axios.post(`${core_url}/shares`, {}, { headers: headers() })
    shareUrl.value = data.url
    showDialog.value = true
  } catch (e: any) {
    $q.notify({ type: 'negative', message: e?.response?.data?.error || 'Could not create share link' })
  } finally {
    loading.value = false
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    $q.notify({ type: 'positive', message: 'Link copied' })
  } catch {
    $q.notify({ type: 'warning', message: 'Copy failed — select the link and copy manually' })
  }
}

async function nativeShare() {
  if ((navigator as any).share) {
    try {
      await (navigator as any).share({ title: 'My moving inventory', url: shareUrl.value })
    } catch {
      /* user cancelled */
    }
  } else {
    copyLink()
  }
}
</script>

<template>
  <q-btn
    :flat="flat"
    :dense="dense"
    :unelevated="!flat"
    color="primary"
    icon="ios_share"
    no-caps
    :loading="loading"
    :label="label"
    @click="createLink"
  />

  <q-dialog v-model="showDialog">
    <q-card style="min-width: 320px; max-width: 480px;">
      <q-card-section>
        <div class="text-h6">Share with moving companies</div>
        <div class="text-caption text-grey-7 q-mt-xs">
          Anyone with this link can view your inventory to prepare a quote — no account needed.
          You can revoke it anytime from your shares.
        </div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <q-input
          outlined dense readonly :model-value="shareUrl"
          @focus="(e:any) => e.target.select()"
        >
          <template #append>
            <q-btn flat dense icon="content_copy" @click="copyLink" />
          </template>
        </q-input>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Close" v-close-popup />
        <q-btn unelevated color="primary" icon="ios_share" label="Share" no-caps @click="nativeShare" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
