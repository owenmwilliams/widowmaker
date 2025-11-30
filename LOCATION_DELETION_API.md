# Location Deletion API

## Overview

This API provides smart location deletion with three strategies to handle inventory:

1. **Reassign** - Move all collections/items to another user location
2. **Unassigned** - Move all collections/items to "Unassigned Items" holding area
3. **Delete All** - Permanently delete all collections/items/containers at this location

## Endpoints

### 1. Preview Deletion (GET)

Get information about what will be affected by deleting a location.

**Endpoint:** `GET /locations/delete/preview?location_id={id}`

**Response:**
```json
{
  "location": {
    "id": 123,
    "name": "Seattle Apartment",
    "location_type": "residence"
  },
  "affectedData": {
    "collections": 8,
    "items": 247,
    "containers": 15
  },
  "availableDestinations": [
    {
      "id": 124,
      "name": "Portland House",
      "location_type": "residence",
      "address": "123 Main St",
      "city": "Portland",
      "state": "OR"
    },
    {
      "id": 125,
      "name": "Storage Unit #42",
      "location_type": "storage_unit",
      "city": "Seattle",
      "state": "WA"
    }
  ],
  "deletionStrategies": [
    {
      "id": "reassign",
      "name": "Move to another location",
      "description": "Choose a destination for your collections and items",
      "recommended": true,
      "requiresDestination": true
    },
    {
      "id": "unassigned",
      "name": "Move to Unassigned Items",
      "description": "Collections will be moved to a holding area",
      "recommended": false,
      "requiresDestination": false
    },
    {
      "id": "delete_all",
      "name": "Delete all inventory",
      "description": "Permanently delete all collections, items, and containers at this location",
      "recommended": false,
      "requiresDestination": false,
      "requiresConfirmation": true
    }
  ]
}
```

### 2. Execute Deletion (DELETE)

Delete a location using one of the three strategies.

**Endpoint:** `DELETE /locations/delete/execute`

**Request Body:**
```json
{
  "location_id": 123,
  "strategy": "reassign",  // or "unassigned" or "delete_all"
  "destination_location_id": 124  // Required only for "reassign" strategy
}
```

**Response:**
```json
{
  "success": true,
  "message": "Location deleted successfully using reassign strategy",
  "strategy": "reassign",
  "targetLocationId": 124,
  "deletedCounts": {
    "moved": 8  // For reassign/unassigned strategies
    // OR
    "collections": 8,  // For delete_all strategy
    "items": 247,
    "containers": 15
  },
  "movesNeedingReview": [5, 12, 18]  // Saved move IDs affected
}
```

## Frontend Implementation Example

### Vue/Quasar Dialog Component

```vue
<script setup>
import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import axios from 'axios';

const $q = useQuasar();
const showDeleteDialog = ref(false);
const deletionPreview = ref(null);
const selectedStrategy = ref('reassign');
const selectedDestination = ref(null);
const deleteConfirmation = ref('');

async function handleDeleteLocation(locationId) {
  try {
    // Step 1: Get preview
    const { data } = await axios.get(`/locations/delete/preview?location_id=${locationId}`);
    deletionPreview.value = data;

    // Auto-select recommended strategy
    const recommended = data.deletionStrategies.find(s => s.recommended);
    selectedStrategy.value = recommended?.id || 'unassigned';

    // Auto-select first destination if available
    if (data.availableDestinations.length > 0) {
      selectedDestination.value = data.availableDestinations[0].id;
    }

    showDeleteDialog.value = true;
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: 'Failed to load deletion preview',
      position: 'bottom'
    });
  }
}

async function executeDelete() {
  if (selectedStrategy.value === 'delete_all') {
    // Require confirmation
    if (deleteConfirmation.value !== 'DELETE') {
      $q.notify({
        type: 'warning',
        message: 'Please type DELETE to confirm',
        position: 'bottom'
      });
      return;
    }
  }

  if (selectedStrategy.value === 'reassign' && !selectedDestination.value) {
    $q.notify({
      type: 'warning',
      message: 'Please select a destination location',
      position: 'bottom'
    });
    return;
  }

  $q.loading.show({ message: 'Deleting location...' });

  try {
    const { data } = await axios.delete('/locations/delete/execute', {
      data: {
        location_id: deletionPreview.value.location.id,
        strategy: selectedStrategy.value,
        destination_location_id: selectedDestination.value
      }
    });

    $q.loading.hide();
    showDeleteDialog.value = false;

    // Show success message based on strategy
    let message = '';
    if (selectedStrategy.value === 'reassign') {
      message = `Location deleted. ${data.deletedCounts.moved} collections moved to selected location.`;
    } else if (selectedStrategy.value === 'unassigned') {
      message = `Location deleted. ${data.deletedCounts.moved} collections moved to Unassigned Items.`;
    } else {
      message = `Location deleted. ${data.deletedCounts.items} items and ${data.deletedCounts.containers} containers permanently deleted.`;
    }

    $q.notify({
      type: 'positive',
      message,
      position: 'bottom',
      timeout: 3000
    });

    // Refresh locations list
    await loadLocations();

  } catch (error) {
    $q.loading.hide();
    $q.notify({
      type: 'negative',
      message: error.response?.data?.error || 'Failed to delete location',
      position: 'bottom'
    });
  }
}
</script>

<template>
  <q-dialog v-model="showDeleteDialog" persistent>
    <q-card style="min-width: 500px">
      <q-card-section>
        <div class="text-h6">Delete Location</div>
        <div class="text-subtitle2 text-grey-7">{{ deletionPreview?.location.name }}</div>
      </q-card-section>

      <q-separator />

      <q-card-section>
        <div class="text-body1 q-mb-md">
          This location contains:
        </div>
        <ul class="text-body2">
          <li>{{ deletionPreview?.affectedData.collections }} collections</li>
          <li>{{ deletionPreview?.affectedData.items }} items</li>
          <li>{{ deletionPreview?.affectedData.containers }} containers</li>
        </ul>

        <div class="text-body1 q-mt-md q-mb-sm">
          What would you like to do with this inventory?
        </div>

        <!-- Strategy Selection -->
        <q-option-group
          v-model="selectedStrategy"
          :options="deletionPreview?.deletionStrategies.map(s => ({
            label: s.name,
            value: s.id,
            caption: s.description,
            disable: false
          }))"
          color="primary"
        />

        <!-- Destination Selection (for reassign) -->
        <div v-if="selectedStrategy === 'reassign'" class="q-mt-md">
          <q-select
            v-model="selectedDestination"
            :options="deletionPreview?.availableDestinations.map(d => ({
              label: `${d.name} ${d.city ? '- ' + d.city : ''}`,
              value: d.id
            }))"
            label="Select destination location"
            outlined
            dense
            emit-value
            map-options
          />
        </div>

        <!-- Delete Confirmation (for delete_all) -->
        <div v-if="selectedStrategy === 'delete_all'" class="q-mt-md">
          <q-banner class="bg-red-1 text-negative">
            <template v-slot:avatar>
              <q-icon name="warning" color="negative" />
            </template>
            <strong>Warning:</strong> This will permanently delete all inventory at this location.
            This action cannot be undone.
          </q-banner>

          <q-input
            v-model="deleteConfirmation"
            label="Type DELETE to confirm"
            outlined
            dense
            class="q-mt-md"
            :rules="[val => val === 'DELETE' || 'Please type DELETE to confirm']"
          />
        </div>
      </q-card-section>

      <q-separator />

      <q-card-actions align="right">
        <q-btn
          flat
          label="Cancel"
          color="grey-7"
          @click="showDeleteDialog = false"
        />
        <q-btn
          :label="selectedStrategy === 'delete_all' ? 'Delete All' : 'Delete Location'"
          :color="selectedStrategy === 'delete_all' ? 'negative' : 'primary'"
          :disable="selectedStrategy === 'delete_all' && deleteConfirmation !== 'DELETE'"
          @click="executeDelete"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
```

## Strategy Details

### Strategy 1: Reassign
- Moves all collections to user-selected location
- Preserves all items and containers
- Best when user has multiple locations
- **Database:** `UPDATE collections SET location_id = destination_location_id`

### Strategy 2: Unassigned
- Moves all collections to auto-created "Unassigned Items" location
- Preserves all items and containers
- Best when user has only one location
- User can reorganize later
- **Database:** `UPDATE collections SET location_id = holding_location_id`

### Strategy 3: Delete All
- Permanently deletes all collections at this location
- Cascades to delete all items and containers
- Requires typing "DELETE" to confirm
- **Database:** `DELETE FROM collections WHERE location_id = location_id`

## Migration Notes

### For Account Deletion (GDPR)

The account deletion flow should continue to use the direct deletion approach (already implemented in `/users/account`):

```javascript
// In users.js DELETE /account endpoint
// Delete collections first (cascades to items/containers)
await knex('collections').where('user_id', userId).delete();
await knex('locations').where('user_id', userId).delete();
```

This is different from user-initiated location deletion where we want to preserve data.

### Schema Changes (Optional)

If you want to enforce CASCADE deletion at the database level for saved_moves:

```sql
-- Migration: Make saved_moves CASCADE delete when location is deleted
ALTER TABLE saved_moves
DROP CONSTRAINT IF EXISTS saved_moves_origin_location_id_fkey,
ADD CONSTRAINT saved_moves_origin_location_id_fkey
  FOREIGN KEY (origin_location_id)
  REFERENCES locations(id)
  ON DELETE CASCADE;

ALTER TABLE saved_moves
DROP CONSTRAINT IF EXISTS saved_moves_destination_location_id_fkey,
ADD CONSTRAINT saved_moves_destination_location_id_fkey
  FOREIGN KEY (destination_location_id)
  REFERENCES locations(id)
  ON DELETE CASCADE;
```

Currently, the implementation handles this in code by setting location references to NULL.

## Testing

### Test Case 1: Reassign Strategy
```bash
# Preview
curl -X GET "http://localhost:3050/locations/delete/preview?location_id=123" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Execute
curl -X DELETE "http://localhost:3050/locations/delete/execute" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "location_id": 123,
    "strategy": "reassign",
    "destination_location_id": 124
  }'
```

### Test Case 2: Unassigned Strategy
```bash
curl -X DELETE "http://localhost:3050/locations/delete/execute" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "location_id": 123,
    "strategy": "unassigned"
  }'
```

### Test Case 3: Delete All Strategy
```bash
curl -X DELETE "http://localhost:3050/locations/delete/execute" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "location_id": 123,
    "strategy": "delete_all"
  }'
```

## Security Considerations

1. **Authorization**: All endpoints verify `user_id` from JWT token
2. **Ownership Validation**: Endpoints verify location belongs to user
3. **Holding Location Protection**: Cannot delete the "Unassigned Items" holding location
4. **Transaction Safety**: All operations wrapped in database transactions
5. **Cascading Safety**: Delete operations properly handle foreign key constraints

## Future Enhancements

1. **Undo/Restore**: Keep deleted location in "trash" for 30 days
2. **Bulk Operations**: Delete multiple locations at once
3. **Partial Reassignment**: Let user choose which collections to move/delete
4. **Archive Instead**: Mark location as archived instead of deleting
