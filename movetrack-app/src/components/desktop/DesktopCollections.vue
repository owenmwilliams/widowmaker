<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { inventoryStore } from '../../stores/InventoryStore';
import { storeToRefs } from 'pinia';
import { useQuasar } from 'quasar';

const props = defineProps({
  user: { type: String, required: true }
});

const store = inventoryStore();
const { collections, containers, items } = storeToRefs(store);
const $q = useQuasar();

// State
const selectedCollection = ref<any>(null);
const draggedItem = ref<any>(null);
const dragOverContainer = ref<number | null>(null);
const showCreateDialog = ref(false);
const newCollectionName = ref('');
const newCollectionDescription = ref('');
const showCreateContainerDialog = ref(false);
const newContainerName = ref('');
const newContainerDescription = ref('');

// Computed
const containersInCollection = computed(() => {
  if (!selectedCollection.value) return [];
  return store.containers.filter(c => c.collection === selectedCollection.value.value);
});

const itemsInCollection = computed(() => {
  if (!selectedCollection.value) return [];
  return store.items.filter(i => i.collection === selectedCollection.value.value);
});

const unassignedItems = computed(() => {
  return itemsInCollection.value.filter(i => !i.container || i.container === null);
});

const getContainerItems = (containerValue: number) => {
  return itemsInCollection.value.filter(i => i.container === containerValue);
};

const getItemCount = (collectionValue: number) => {
  return store.items.filter(i => i.collection === collectionValue).length;
};

// Methods
const selectCollection = (collection: any) => {
  selectedCollection.value = collection;
  store.setActiveCollection({ label: collection.label, value: collection.value });
};

const createCollection = async () => {
  if (!newCollectionName.value.trim()) {
    $q.notify({
      type: 'warning',
      message: 'Please enter a collection name',
      position: 'top'
    });
    return;
  }

  try {
    $q.loading.show({ message: 'Creating collection...' });
    await store.createCollection(props.user, newCollectionName.value, newCollectionDescription.value || '');

    $q.notify({
      type: 'positive',
      message: `Collection "${newCollectionName.value}" created!`,
      position: 'top',
      timeout: 2000
    });

    // Reset form and close dialog
    newCollectionName.value = '';
    newCollectionDescription.value = '';
    showCreateDialog.value = false;

    // Select the newly created collection
    if (store.collections.length > 0) {
      const newCollection = store.collections[store.collections.length - 1];
      selectCollection(newCollection);
    }
  } catch (error) {
    console.error('Error creating collection:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to create collection',
      position: 'top'
    });
  } finally {
    $q.loading.hide();
  }
};

const createContainer = async () => {
  if (!newContainerName.value.trim()) {
    $q.notify({
      type: 'warning',
      message: 'Please enter a container name',
      position: 'top'
    });
    return;
  }

  if (!selectedCollection.value) {
    $q.notify({
      type: 'warning',
      message: 'Please select a collection first',
      position: 'top'
    });
    return;
  }

  try {
    $q.loading.show({ message: 'Creating container...' });
    await store.createContainer(
      props.user,
      newContainerName.value,
      selectedCollection.value.value
    );

    $q.notify({
      type: 'positive',
      message: `Container "${newContainerName.value}" created!`,
      position: 'top',
      timeout: 2000
    });

    // Reset form and close dialog
    newContainerName.value = '';
    newContainerDescription.value = '';
    showCreateContainerDialog.value = false;

    // Reload inventory to show new container
    await store.loadInventory(props.user);
  } catch (error) {
    console.error('Error creating container:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to create container',
      position: 'top'
    });
  } finally {
    $q.loading.hide();
  }
};

// Drag and Drop Handlers
const handleDragStart = (item: any) => {
  draggedItem.value = item;
};

const handleDragEnd = () => {
  draggedItem.value = null;
  dragOverContainer.value = null;
};

const handleDragOver = (event: DragEvent, containerValue: number) => {
  event.preventDefault();
  dragOverContainer.value = containerValue;
};

const handleDragLeave = () => {
  dragOverContainer.value = null;
};

const handleDrop = async (event: DragEvent, containerValue: number) => {
  event.preventDefault();

  if (!draggedItem.value) return;

  try {
    $q.loading.show({ message: 'Moving item...' });

    // Call API to update item's container
    // For now, we'll update locally and reload
    const response = await fetch(`${import.meta.env.MODE === 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'}/items/${draggedItem.value.value}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('session_token')}`
      },
      body: JSON.stringify({
        container: containerValue
      })
    });

    if (response.ok) {
      await store.loadInventory(props.user);
      $q.notify({
        type: 'positive',
        message: `Moved ${draggedItem.value.label} to container`,
        position: 'top',
        timeout: 1500
      });
    }
  } catch (error) {
    console.error('Error moving item:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to move item',
      position: 'top'
    });
  } finally {
    $q.loading.hide();
    draggedItem.value = null;
    dragOverContainer.value = null;
  }
};

// Initialize
onMounted(() => {
  if (store.collections.length > 0 && !selectedCollection.value) {
    selectCollection(store.collections[0]);
  }
});
</script>

<template>
  <div class="collections-container">
    <!-- Empty state -->
    <div v-if="collections.length === 0" class="empty-state">
      <q-icon name="inventory_2" size="80px" color="grey-5" />
      <div class="text-h5 q-mt-md text-grey-7">No Collections Yet</div>
      <div class="text-body2 text-grey-6 q-mt-sm">Create your first collection to start organizing items</div>
      <q-btn unelevated color="primary" icon="add" label="Create Collection" class="q-mt-lg" @click="showCreateDialog = true" />
    </div>

    <!-- Main layout with collections -->
    <div v-else class="main-layout">
      <!-- Left Sidebar - Collections List -->
      <div class="collections-sidebar">
        <div class="sidebar-header">
          <div class="text-h6 text-primary">Collections</div>
          <q-btn flat dense round icon="add" color="primary" size="sm" @click="showCreateDialog = true">
            <q-tooltip>Add Collection</q-tooltip>
          </q-btn>
        </div>

        <q-separator class="q-my-sm" />

        <div class="collections-list">
          <div
            v-for="collection in collections"
            :key="collection.value"
            class="collection-item"
            :class="{ 'active': selectedCollection?.value === collection.value }"
            @click="selectCollection(collection)"
          >
            <div class="collection-icon">
              <q-icon name="inventory_2" size="24px" />
            </div>
            <div class="collection-info">
              <div class="collection-name">{{ collection.label }}</div>
              <div class="collection-count">{{ getItemCount(collection.value) }} items</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Content - Containers and Items -->
      <div class="content-area">
        <div v-if="!selectedCollection" class="select-prompt">
          <q-icon name="arrow_back" size="48px" color="grey-5" />
          <div class="text-h6 text-grey-6 q-mt-md">Select a collection to view containers</div>
        </div>

        <div v-else class="collection-content">
          <!-- Header -->
          <div class="content-header">
            <div>
              <div class="text-h5 text-primary">{{ selectedCollection.label }}</div>
              <div class="text-body2 text-grey-7">{{ selectedCollection.description }}</div>
            </div>
            <q-btn unelevated color="primary" icon="add" label="Add Container" @click="showCreateContainerDialog = true" />
          </div>

          <!-- Containers Grid -->
          <div class="section-title">
            <q-icon name="inventory_2" size="20px" class="q-mr-sm" />
            Containers
            <q-chip dense size="sm" color="primary" text-color="white" class="q-ml-sm">
              {{ containersInCollection.length }}
            </q-chip>
          </div>

          <div v-if="containersInCollection.length === 0" class="no-containers">
            <q-icon name="inventory_2" size="48px" color="grey-5" />
            <div class="text-body1 text-grey-6 q-mt-sm">No containers in this collection</div>
            <q-btn unelevated color="secondary" icon="add" label="Add First Container" class="q-mt-sm" @click="showCreateContainerDialog = true" />
          </div>

          <div v-else class="containers-grid">
            <div
              v-for="container in containersInCollection"
              :key="container.value"
              class="container-card"
              :class="{ 'drag-over': dragOverContainer === container.value }"
              @dragover="handleDragOver($event, container.value)"
              @dragleave="handleDragLeave"
              @drop="handleDrop($event, container.value)"
            >
              <q-card flat bordered>
                <q-card-section>
                  <div class="row items-center q-mb-sm">
                    <q-icon name="inventory_2" size="sm" color="primary" />
                    <span class="text-subtitle1 text-weight-medium q-ml-sm">{{ container.label }}</span>
                    <q-space />
                    <q-chip dense color="secondary" text-color="white" size="sm">
                      {{ getContainerItems(container.value).length }}
                    </q-chip>
                  </div>

                  <!-- Item thumbnails -->
                  <div v-if="getContainerItems(container.value).length > 0" class="item-thumbnails">
                    <div
                      v-for="item in getContainerItems(container.value).slice(0, 6)"
                      :key="item.value"
                      class="item-thumb"
                    >
                      <q-img
                        v-if="item.picture_url"
                        :src="item.picture_url"
                        fit="cover"
                        class="thumb-img"
                      />
                      <div v-else class="thumb-placeholder">
                        <q-icon name="category" size="16px" color="grey-6" />
                      </div>
                    </div>
                    <div v-if="getContainerItems(container.value).length > 6" class="more-items">
                      +{{ getContainerItems(container.value).length - 6 }}
                    </div>
                  </div>

                  <div v-else class="empty-container">
                    <q-icon name="inbox" size="24px" color="grey-5" />
                    <div class="text-caption text-grey-6">Drop items here</div>
                  </div>
                </q-card-section>

                <q-card-actions align="right">
                  <q-btn flat dense color="primary" icon="visibility" size="sm">
                    <q-tooltip>View Details</q-tooltip>
                  </q-btn>
                  <q-btn flat dense color="primary" icon="edit" size="sm">
                    <q-tooltip>Edit</q-tooltip>
                  </q-btn>
                </q-card-actions>
              </q-card>
            </div>
          </div>

          <!-- Unpacked Items -->
          <div v-if="unassignedItems.length > 0" class="unassigned-section">
            <div class="section-title">
              <q-icon name="category" size="20px" class="q-mr-sm" />
              Unpacked Items
              <q-chip dense size="sm" color="warning" text-color="white" class="q-ml-sm">
                {{ unassignedItems.length }}
              </q-chip>
            </div>

            <div class="unassigned-items">
              <div
                v-for="item in unassignedItems"
                :key="item.value"
                class="draggable-item"
                draggable="true"
                @dragstart="handleDragStart(item)"
                @dragend="handleDragEnd"
              >
                <q-icon name="drag_indicator" class="drag-handle" />
                <div class="item-image">
                  <q-img
                    v-if="item.picture_url"
                    :src="item.picture_url"
                    fit="cover"
                    class="item-img"
                  />
                  <div v-else class="item-placeholder">
                    <q-icon name="category" size="24px" color="grey-6" />
                  </div>
                </div>
                <div class="item-details">
                  <div class="text-weight-medium">{{ item.label }}</div>
                  <div class="text-caption text-grey-7">{{ item.description }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Collection Dialog -->
    <q-dialog v-model="showCreateDialog" persistent>
      <q-card style="min-width: 450px;">
        <q-card-section>
          <div class="text-h6">Create Collection</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="newCollectionName"
            label="Collection Name *"
            outlined
            autofocus
            class="q-mb-md"
            :rules="[val => !!val || 'Name is required']"
            @keyup.enter="createCollection"
          />

          <q-input
            v-model="newCollectionDescription"
            label="Description (optional)"
            type="textarea"
            outlined
            rows="3"
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey-7" v-close-popup @click="newCollectionName = ''; newCollectionDescription = ''" />
          <q-btn unelevated label="Create" color="primary" @click="createCollection" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Create Container Dialog -->
    <q-dialog v-model="showCreateContainerDialog" persistent>
      <q-card style="min-width: 450px;">
        <q-card-section>
          <div class="text-h6">Create Container</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="newContainerName"
            label="Container Name *"
            outlined
            autofocus
            class="q-mb-md"
            :rules="[val => !!val || 'Name is required']"
            @keyup.enter="createContainer"
          />

          <q-input
            v-model="newContainerDescription"
            label="Description (optional)"
            type="textarea"
            outlined
            rows="3"
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey-7" v-close-popup @click="newContainerName = ''; newContainerDescription = ''" />
          <q-btn unelevated label="Create" color="primary" @click="createContainer" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<style scoped>
.collections-container {
  height: calc(100vh - 50px);
  background: var(--bg-secondary);
  overflow: hidden;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.main-layout {
  display: flex;
  height: 100%;
  gap: 0;
}

/* Collections Sidebar */
.collections-sidebar {
  width: 280px;
  background: white;
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.collections-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.collection-item {
  display: flex;
  align-items: center;
  padding: 12px;
  margin-bottom: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
}

.collection-item:hover {
  background: var(--bg-secondary);
}

.collection-item.active {
  background: var(--primary-subtle);
  border-color: var(--primary);
}

.collection-icon {
  color: var(--primary);
  margin-right: 12px;
}

.collection-info {
  flex: 1;
}

.collection-name {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.collection-count {
  font-size: 12px;
  color: var(--text-secondary);
}

/* Content Area */
.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.select-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.collection-content {
  max-width: 1400px;
  margin: 0 auto;
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
}

.section-title {
  display: flex;
  align-items: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 24px 0 16px 0;
}

/* Containers Grid */
.no-containers {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px;
  background: white;
  border-radius: 12px;
  border: 2px dashed var(--border-light);
}

.containers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.container-card {
  transition: all 0.3s;
}

.container-card.drag-over {
  transform: scale(1.02);
}

.container-card.drag-over .q-card {
  border-color: var(--primary);
  background: var(--primary-subtle);
  box-shadow: 0 4px 12px rgba(139, 115, 85, 0.2);
}

.item-thumbnails {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
}

.item-thumb {
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-tertiary);
}

.thumb-img {
  width: 100%;
  height: 100%;
}

.thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.more-items {
  aspect-ratio: 1;
  background: var(--primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  border-radius: 6px;
}

.empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  border: 2px dashed var(--border-light);
  border-radius: 8px;
  margin-top: 12px;
}

/* Unassigned Items */
.unassigned-section {
  background: white;
  border-radius: 12px;
  padding: 16px;
  margin-top: 24px;
}

.unassigned-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.draggable-item {
  display: flex;
  align-items: center;
  padding: 12px;
  background: white;
  border: 2px solid var(--border-light);
  border-radius: 8px;
  cursor: grab;
  transition: all 0.2s;
}

.draggable-item:hover {
  background: var(--bg-secondary);
  border-color: var(--primary);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.draggable-item:active {
  cursor: grabbing;
  transform: scale(0.98);
}

.drag-handle {
  color: var(--text-hint);
  margin-right: 8px;
}

.item-image {
  width: 60px;
  height: 60px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-tertiary);
  flex-shrink: 0;
  margin-right: 12px;
}

.item-img {
  width: 100%;
  height: 100%;
}

.item-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-details {
  flex: 1;
  min-width: 0;
}

.item-details > div {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
