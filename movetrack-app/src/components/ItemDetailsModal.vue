<script setup lang="ts">
import { computed, reactive, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useQuasar } from 'quasar';
import { inventoryStore } from '../stores/InventoryStore';
import QrCodeCard from './QrCodeCard.vue';

declare global {
  interface Window {
    __forceItemQr?: (value: string) => void;
  }
}

const store = inventoryStore();
const $q = useQuasar();

const editMode = ref(false);
const resolveUserId = () => {
  if (store.itemDetailsUser) {
    return store.itemDetailsUser;
  }
  try {
    const raw = localStorage.getItem('user_data');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.user_id) {
        return parsed.user_id;
      }
      if (parsed?.id) {
        return parsed.id;
      }
    }
  } catch (error) {
    console.warn('[ItemDetailsModal] Failed to parse user_data', error);
  }
  const sessionUser = localStorage.getItem('session_user_id');
  if (sessionUser) {
    return sessionUser;
  }
  return null;
};

const form = reactive({
  name: '',
  description: '',
  quantity: 1,
  collection: undefined as number | undefined,
  container: undefined as number | undefined,
  estimatedValue: null as number | null,
  fragile: false,
  weightLbs: null as number | null,
  dimensions: '' as string | null,
  lengthIn: null as number | null,
  widthIn: null as number | null,
  heightIn: null as number | null,
  material: '' as string | null,
  primaryColor: '' as string | null,
  tags: '' as string,
  notes: '' as string | null
});

const showModal = computed({
  get: () => store.isItemDetailsOpen,
  set: (value) => {
    if (!value) {
      handleClose();
    }
  }
});

watch(
  () => showModal.value,
  (open) => {
    if (!open) {
      pendingQrUrl.value = null;
    }
  },
);

const selectedItem = computed(() => store.activeItemDetails);
const isCreateMode = computed(() => store.itemDetailsMode === 'create');
const isDirectEditMode = computed(() => store.itemDetailsMode === 'edit');

const tagList = computed(() => selectedItem.value?.tags ?? []);
const pendingQrUrl = ref<string | null>(null);
const actualItemQrUrl = computed(() => {
  if (!selectedItem.value) return null;
  return (
    selectedItem.value.qr_url ||
    (selectedItem.value.qr_code
      ? store.getQrUrl('item', selectedItem.value.qr_code)
      : null)
  );
});
const itemQrUrl = computed(() => pendingQrUrl.value || actualItemQrUrl.value);

watch(actualItemQrUrl, (url) => {
  console.log('[ItemDetailsModal] actualItemQrUrl changed:', url);
  if (url && pendingQrUrl.value === url) {
    return;
  }
  if (url) {
    pendingQrUrl.value = null;
  }
});

const collectionOptions = computed(() =>
  store.collections.map((collection) => ({
    label: collection.label,
    value: collection.value
  }))
);

const containerOptions = computed(() => {
  if (!form.collection) {
    return [];
  }
  return store.containers
    .filter((container) => container.collection === form.collection)
    .map((container) => ({
      label: container.label,
      value: container.value
    }));
});

const resetForm = () => {
  form.name = '';
  form.description = '';
  form.quantity = 1;
  form.collection = store.activeCollection?.value ?? store.collections[0]?.value;
  form.container = undefined;
  form.estimatedValue = null;
  form.fragile = false;
  form.weightLbs = null;
  form.dimensions = '';
  form.lengthIn = null;
  form.widthIn = null;
  form.heightIn = null;
  form.material = '';
  form.primaryColor = '';
  form.tags = '';
  form.notes = '';
};

const photoInput = ref<HTMLInputElement | null>(null);
const newPhotoBlob = ref<Blob | null>(null);
const newPhotoPreview = ref<string | null>(null);
const removePhoto = ref(false);

const currentPhotoSrc = computed(() => {
  if (newPhotoPreview.value) {
    return newPhotoPreview.value;
  }
  return selectedItem.value?.picture_url || null;
});

const resetPhotoState = () => {
  newPhotoBlob.value = null;
  newPhotoPreview.value = null;
  removePhoto.value = false;
  if (photoInput.value) {
    photoInput.value.value = '';
  }
};

const triggerPhotoUpload = () => {
  photoInput.value?.click();
};

const handlePhotoUpload = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  newPhotoBlob.value = file;
  const reader = new FileReader();
  reader.onload = () => {
    newPhotoPreview.value = reader.result as string;
  };
  reader.readAsDataURL(file);
  removePhoto.value = false;
};

const markRemovePhoto = () => {
  newPhotoBlob.value = null;
  newPhotoPreview.value = null;
  removePhoto.value = true;
  if (photoInput.value) {
    photoInput.value.value = '';
  }
};

const populateFormFromItem = () => {
  if (!selectedItem.value) {
    return;
  }

  form.name = selectedItem.value.label;
  form.description = selectedItem.value.description || '';
  form.quantity = selectedItem.value.quantity || 1;
  form.collection = selectedItem.value.collection;
  form.container = selectedItem.value.container ?? undefined;
  form.estimatedValue =
    selectedItem.value.estimated_value !== undefined
      ? selectedItem.value.estimated_value
      : null;
  form.fragile = Boolean(selectedItem.value.fragile);
  form.weightLbs =
    selectedItem.value.weight_lbs !== undefined
      ? selectedItem.value.weight_lbs
      : null;
  form.dimensions = selectedItem.value.dimensions || '';
  form.lengthIn = selectedItem.value.length_in ?? null;
  form.widthIn = selectedItem.value.width_in ?? null;
  form.heightIn = selectedItem.value.height_in ?? null;
  form.material = selectedItem.value.material || '';
  form.primaryColor = selectedItem.value.primary_color || '';
  form.tags = (selectedItem.value.tags || []).join(', ');
  form.notes = selectedItem.value.notes || '';
};

watch(
  () => [showModal.value, selectedItem.value, isCreateMode.value, isDirectEditMode.value],
  () => {
    if (!showModal.value) {
      return;
    }
    if (isCreateMode.value) {
      resetForm();
      resetPhotoState();
      editMode.value = false;
    } else if (selectedItem.value) {
      populateFormFromItem();
      if (isDirectEditMode.value) {
        editMode.value = true;
      } else {
        editMode.value = false;
      }
      if (!isDirectEditMode.value) {
        resetPhotoState();
      }
    }
  },
  { immediate: true }
);

watch(
  () => form.collection,
  (newCollection) => {
    if (newCollection && form.container) {
      const container = store.containers.find(
        (c) => c.value === form.container
      );
      if (!container || container.collection !== newCollection) {
        form.container = undefined;
      }
    }
  }
);

const tagsAsArray = computed(() =>
  form.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
);

const startEdit = () => {
  editMode.value = true;
  store.itemDetailsMode = 'edit';
};

const cancelEdit = () => {
  editMode.value = false;
  store.itemDetailsMode = 'view';
  populateFormFromItem();
  resetPhotoState();
};

const createManualItem = async () => {
  if (!store.itemDetailsUser) {
    return;
  }

  if (!form.name.trim()) {
    $q.notify({
      type: 'warning',
      message: 'Item name is required',
      position: 'bottom'
    });
    return;
  }

  const targetCollection =
    form.collection ??
    store.activeCollection?.value ??
    store.collections[0]?.value;

  if (!targetCollection) {
    $q.notify({
      type: 'warning',
      message: 'Please select a collection',
      position: 'bottom'
    });
    return;
  }

  try {
    $q.loading.show({ message: 'Adding item...' });
    await store.createItem(
      store.itemDetailsUser,
      form.name,
      form.description || '',
      form.quantity,
      targetCollection,
      form.container,
      newPhotoBlob.value ?? undefined,
      form.estimatedValue,
      form.fragile,
      undefined, // priority (no longer used)
      form.weightLbs,
      form.dimensions || undefined,
      form.lengthIn,
      form.widthIn,
      form.heightIn,
      form.notes || undefined,
      form.material || undefined,
      form.primaryColor || undefined,
      tagsAsArray.value
    );

    $q.notify({
      type: 'positive',
      message: 'Item added to your inventory',
      position: 'bottom'
    });
    resetPhotoState();
    handleClose();
  } catch (error) {
    console.error('Failed to create item', error);
    $q.notify({
      type: 'negative',
      message: 'Unable to add item',
      position: 'bottom'
    });
  } finally {
    $q.loading.hide();
  }
};

const saveItem = async () => {
  if (isCreateMode.value) {
    await createManualItem();
    return;
  }

  if (!selectedItem.value || !store.itemDetailsUser) {
    return;
  }

  try {
    $q.loading.show({ message: 'Saving item...' });
    const pictureParam = removePhoto.value
      ? undefined
      : selectedItem.value.picture_url ?? undefined;
    await store.updateItem(
      selectedItem.value.value,
      store.itemDetailsUser,
      form.name,
      form.description,
      form.quantity,
      form.collection ?? selectedItem.value.collection,
      form.container,
      pictureParam,
      {
        estimatedValue: form.estimatedValue,
        fragile: form.fragile,
        weightLbs: form.weightLbs,
        dimensions: form.dimensions,
        lengthIn: form.lengthIn,
        widthIn: form.widthIn,
        heightIn: form.heightIn,
        notes: form.notes,
        material: form.material,
        primaryColor: form.primaryColor,
        tags: tagsAsArray.value
      },
      { skipRedirect: true, newImage: newPhotoBlob.value, removeImage: removePhoto.value }
    );

    $q.notify({
      type: 'positive',
      message: 'Item updated',
      position: 'bottom'
    });
    editMode.value = false;
    store.itemDetailsMode = 'view';
    resetPhotoState();
    populateFormFromItem();
  } catch (error) {
    console.error('Failed to update item', error);
    $q.notify({
      type: 'negative',
      message: 'Unable to update item',
      position: 'bottom'
    });
  } finally {
    $q.loading.hide();
  }
};

const handleClose = () => {
  editMode.value = false;
  resetPhotoState();
  store.closeItemDetailsModal();
};

const qrGenerating = ref(false);

const handleGenerateItemQr = async () => {
  if (!selectedItem.value) {
    return;
  }
  try {
    qrGenerating.value = true;
    const response = await store.generateItemQr(selectedItem.value.value);
    console.log('[ItemDetailsModal] generate QR response:', response);
  } catch (error) {
    console.error('Failed to generate QR', error);
    $q.notify({
      type: 'negative',
      message: 'Unable to generate QR code',
      position: 'top'
    });
  } finally {
    qrGenerating.value = false;
  }
};

const handleAssignItemQr = async (payload: string) => {
  const userId = resolveUserId();
  if (!selectedItem.value || !userId) {
    console.warn('[ItemDetailsModal] Missing item or user context for QR link', {
      item: selectedItem.value?.value,
      userId,
      storeUser: store.itemDetailsUser
    });
    $q.notify({
      type: 'negative',
      message: 'Unable to determine user. Please reopen the item and try again.',
      position: 'top'
    });
    return;
  }
  const scannedValue = payload.trim();
  console.log("[ItemDetailsModal] Linking QR payload:", scannedValue, "for item:", selectedItem.value.value, "user:", userId);
  if (scannedValue) {
    pendingQrUrl.value = scannedValue;
  }
  try {
    qrGenerating.value = true;
    const response = await store.generateItemQr(selectedItem.value.value, userId, {
      token: payload
    });
    console.log("[ItemDetailsModal] QR link response:", response);
    if (response?.url) {
      pendingQrUrl.value = response.url;
      console.log("[ItemDetailsModal] Pending QR updated with response url:", response.url);
    }
    $q.notify({
      type: 'positive',
      message: 'QR linked to this item',
      position: 'top'
    });
  } catch (error) {
    console.error('Failed to assign QR', error);
    $q.notify({
      type: 'negative',
      message: 'Unable to link that QR code',
      position: 'top'
    });
  } finally {
    qrGenerating.value = false;
  }
};

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.__forceItemQr = (value: string) => {
      console.log('[ItemDetailsModal] window.__forceItemQr triggered with:', value);
      handleAssignItemQr(String(value ?? ''));
    };
  }
});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined' && window.__forceItemQr) {
    delete window.__forceItemQr;
  }
});
</script>

<template>
  <q-dialog v-model="showModal" transition-show="slide-up" transition-hide="slide-down">
    <q-card class="item-details-card">
      <q-card-section class="row items-start q-col-gutter-md">
        <div class="col-12 col-md-4">
          <q-img
            v-if="currentPhotoSrc"
            :src="currentPhotoSrc"
            ratio="1"
            class="item-image"
          />
          <div v-else class="item-image placeholder flex flex-center column">
            <q-icon name="inventory_2" color="grey-5" size="64px" />
            <div class="text-grey-6 q-mt-sm">No photo</div>
          </div>
          <div
            v-if="isCreateMode || editMode"
            class="photo-actions q-mt-md column q-gutter-sm"
          >
            <input
              type="file"
              ref="photoInput"
              accept="image/*"
              class="hidden-input"
              @change="handlePhotoUpload"
            />
            <q-btn
              outline
              color="primary"
              icon="upload"
              label="Upload Photo"
              dense
              @click="triggerPhotoUpload"
            />
            <q-btn
              v-if="currentPhotoSrc"
              outline
              color="negative"
              icon="delete"
              label="Remove Photo"
              dense
              @click="markRemovePhoto"
            />
            <q-btn
              v-if="newPhotoPreview || removePhoto"
              flat
              color="grey-7"
              icon="undo"
              label="Reset"
              dense
              @click="resetPhotoState"
            />
          </div>
        </div>
        <div class="col-12 col-md-8">
          <div>
            <div class="text-h5 text-primary">
              {{ isCreateMode ? 'Add New Item' : form.name }}
            </div>
            <div v-if="!isCreateMode" class="text-subtitle2 text-grey-7">
              {{
                store.collections.find((c) => c.value === selectedItem?.collection)
                  ?.label || 'Uncategorized'
              }}
            </div>
          </div>

          <div v-if="!isCreateMode" class="q-mt-sm row q-gutter-sm">
            <q-chip
              v-if="form.fragile"
              color="red"
              text-color="white"
              square
              dense
            >
              Fragile
            </q-chip>
            <q-chip
              v-if="form.weightLbs"
              color="grey-7"
              text-color="white"
              square
              dense
            >
              {{ form.weightLbs }} lbs
            </q-chip>
          </div>

          <div v-if="tagList.length > 0 && !isCreateMode && !editMode" class="q-mt-sm">
            <q-chip
              v-for="tag in tagList"
              :key="tag"
              size="sm"
              color="secondary"
              text-color="white"
              class="q-mr-xs q-mb-xs"
            >
              {{ tag }}
            </q-chip>
          </div>
        </div>
      </q-card-section>

      <q-separator />

      <q-card-section class="q-pa-md scroll-area">
        <div v-if="!isCreateMode && selectedItem && !editMode" class="details-view">
          <div class="detail-grid">
            <div class="detail-card">
              <div class="detail-label">Quantity</div>
              <div class="detail-value">{{ form.quantity }}</div>
            </div>
            <div class="detail-card">
              <div class="detail-label">Estimated Value</div>
              <div class="detail-value">
                {{
                  form.estimatedValue !== null
                    ? `$${form.estimatedValue.toLocaleString()}`
                    : 'Not set'
                }}
              </div>
            </div>
            <div class="detail-card">
              <div class="detail-label">Location</div>
              <div class="detail-value">
                {{
                  store.locations.find((l) => l.value === store.collections.find((c) => c.value === form.collection)?.location)?.label ||
                  'Unassigned'
                }}
                <span class="text-caption text-grey-7" v-if="form.collection"> (inherited from collection)</span>
              </div>
            </div>
            <div class="detail-card">
              <div class="detail-label">Container</div>
              <div class="detail-value">
                {{
                  store.containers.find((c) => c.value === form.container)?.label ||
                  'None'
                }}
              </div>
            </div>
            <div class="detail-card">
              <div class="detail-label">Weight</div>
              <div class="detail-value">
                {{ form.weightLbs ? `${form.weightLbs} lbs` : 'Not set' }}
              </div>
            </div>
            <div class="detail-card">
              <div class="detail-label">Dimensions</div>
              <div class="detail-value">
                <span v-if="form.lengthIn && form.widthIn && form.heightIn">
                  {{ form.lengthIn }}" × {{ form.widthIn }}" × {{ form.heightIn }}"
                  <span class="text-caption text-grey-7">({{ ((form.lengthIn * form.widthIn * form.heightIn) / 1728).toFixed(2) }} cu ft)</span>
                </span>
                <span v-else>Not set</span>
              </div>
            </div>
            <div class="detail-card">
              <div class="detail-label">Material</div>
              <div class="detail-value">
                {{ form.material || 'Not specified' }}
              </div>
            </div>
            <div class="detail-card">
              <div class="detail-label">Primary Color</div>
              <div class="detail-value">
                {{ form.primaryColor || 'Not specified' }}
              </div>
            </div>
            <div class="detail-card detail-card--wide">
              <div class="detail-label">Notes</div>
              <div class="detail-value multiline">
                {{ form.notes || 'No notes yet' }}
              </div>
            </div>
          </div>
          <div class="q-mt-xl">
            <QrCodeCard
              v-if="selectedItem"
              title="Item QR Code"
              description="Print or place this code on the item to link helpers straight to its profile."
              :qr-url="itemQrUrl"
              :generating="qrGenerating"
              @generate="handleGenerateItemQr"
              @assign="handleAssignItemQr"
            />
          </div>
        </div>

        <q-form
          v-else-if="isCreateMode || (selectedItem && editMode)"
          class="column q-gutter-md"
          @submit.prevent="saveItem"
        >
          <div class="form-section">
            <div class="section-title">Basics</div>
            <div class="row q-col-gutter-md">
              <div class="col-12 col-md-6">
                <q-input dense v-model="form.name" label="Item Name" outlined />
              </div>
              <div class="col-12 col-md-3">
                <q-input
                  dense
                  v-model.number="form.quantity"
                  type="number"
                  label="Quantity"
                  outlined
                  min="1"
                />
              </div>
              <div class="col-12 col-md-3">
                <q-input
                  dense
                  v-model.number="form.estimatedValue"
                  type="number"
                  label="Estimated Value ($)"
                  outlined
                  prefix="$"
                />
              </div>
              <div class="col-12">
                <q-input
                  dense
                  v-model="form.description"
                  type="textarea"
                  label="Description"
                  outlined
                  autogrow
                />
              </div>
            </div>
          </div>

          <div class="form-section">
            <div class="section-title">Placement</div>
            <div class="row q-col-gutter-md">
              <div class="col-12 col-md-4">
                <q-select
                  dense
                  v-model="form.collection"
                  :options="collectionOptions"
                  label="Collection"
                  outlined
                />
              </div>
              <div class="col-12 col-md-4">
                <q-select
                  dense
                  v-model="form.container"
                  :options="containerOptions"
                  label="Container"
                  outlined
                  clearable
                />
              </div>
            </div>
            <!-- Location is now inherited from collection, so no location selector needed -->
          </div>

          <div class="form-section">
            <div class="section-title">Characteristics</div>
            <div class="row q-col-gutter-md">
              <div class="col-12 col-md-4">
                <q-input
                  dense
                  v-model.number="form.weightLbs"
                  type="number"
                  label="Weight (lbs)"
                  outlined
                  suffix="lbs"
                />
              </div>
              <div class="col-12">
                <div class="text-caption text-grey-7 q-mb-xs">Dimensions (inches)</div>
              </div>
              <div class="col-4 col-md-2">
                <q-input
                  dense
                  v-model.number="form.lengthIn"
                  label="Length"
                  type="number"
                  outlined
                  min="0"
                  step="0.1"
                  suffix="in"
                />
              </div>
              <div class="col-4 col-md-2">
                <q-input
                  dense
                  v-model.number="form.widthIn"
                  label="Width"
                  type="number"
                  outlined
                  min="0"
                  step="0.1"
                  suffix="in"
                />
              </div>
              <div class="col-4 col-md-2">
                <q-input
                  dense
                  v-model.number="form.heightIn"
                  label="Height"
                  type="number"
                  outlined
                  min="0"
                  step="0.1"
                  suffix="in"
                />
              </div>
              <div class="col-4 col-md-2 flex flex-center">
                <q-checkbox
                  dense
                  v-model="form.fragile"
                  label="Fragile"
                  color="red"
                />
              </div>
              <div class="col-12 col-md-3">
                <q-input dense v-model="form.material" label="Material" outlined />
              </div>
              <div class="col-12 col-md-3">
                <q-input
                  dense
                  v-model="form.primaryColor"
                  label="Primary Color"
                  outlined
                />
              </div>
              <div class="col-12">
                <q-input
                  dense
                  v-model="form.tags"
                  label="Tags (comma separated)"
                  outlined
                />
              </div>
              <div class="col-12">
                <q-input
                  dense
                  v-model="form.notes"
                  type="textarea"
                  label="Notes"
                  outlined
                  autogrow
                />
              </div>
            </div>
          </div>
        </q-form>
      </q-card-section>

      <q-separator />

      <q-card-actions align="right">
        <q-btn
          flat
          color="grey-7"
          :label="isCreateMode ? 'Cancel' : 'Close'"
          @click="handleClose"
        />
        <template v-if="isCreateMode">
          <q-btn color="primary" label="Save Item" @click="saveItem" />
        </template>
        <template v-else-if="editMode">
          <q-btn flat color="primary" label="Cancel" @click="cancelEdit" />
          <q-btn color="primary" label="Save Changes" @click="saveItem" />
        </template>
        <template v-else>
          <q-btn color="primary" label="Edit Item" @click="startEdit" />
        </template>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.item-details-card {
  max-width: 1100px;
  width: 95vw;
  max-height: calc(100vh - 72px);
  margin-top: 36px;
  display: flex;
  flex-direction: column;
  font-size: 0.95rem;
}

.item-image {
  border-radius: 12px;
  overflow: hidden;
  min-height: 280px;
  background: #f5f5f5;
}

.item-image.placeholder {
  border: 1px dashed #d0d0d0;
}

.photo-actions .q-btn {
  width: 100%;
}

.hidden-input {
  display: none;
}

.scroll-area {
  overflow-y: auto;
  max-height: 50vh;
}

.details-view {
  padding-bottom: 8px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.detail-card {
  background: #fafafa;
  border-radius: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border-light);
}

.detail-card--wide {
  grid-column: span 2;
}

@media (max-width: 600px) {
  .detail-card--wide {
    grid-column: span 1;
  }
}

.detail-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: #8f8f8f;
  margin-bottom: 4px;
  letter-spacing: 0.08em;
}

.detail-value {
  font-size: 0.95rem;
  color: #1f1f1f;
}

.detail-value.multiline {
  white-space: pre-line;
}

.form-section {
  border: 1px solid var(--border-light);
  border-radius: 12px;
  padding: 12px 14px;
  background: #fff;
}

.form-section + .form-section {
  margin-top: 12px;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #787878;
  margin-bottom: 10px;
}

.tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
