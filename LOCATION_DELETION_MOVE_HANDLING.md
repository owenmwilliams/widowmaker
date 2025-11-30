# Location Deletion: Move Handling Strategy

## Summary

When a user deletes a location, the system handles associated moves differently based on the deletion strategy:

| Strategy | Inventory Behavior | Move Behavior | Data Loss |
|----------|-------------------|---------------|-----------|
| **Reassign** | Move to selected location | **Update** to new location | ❌ No loss |
| **Unassigned** | Move to holding area | **Delete** all affected moves | ⚠️ Moves deleted |
| **Delete All** | Delete everything | **Delete** all affected moves | ✅ Everything deleted |

---

## Detailed Strategy Behavior

### Strategy 1: `reassign` - Move to Another Location

**What happens to inventory:**
- All collections → moved to user-selected destination location
- All items → stay in their collections (location inherited)
- All containers → stay in their collections (location inherited)

**What happens to moves:**
- `saved_moves` with this location as **origin** → origin updated to destination location
- `saved_moves` with this location as **destination** → destination updated to destination location
- `move_waypoints` at this location → updated to destination location
- `move_locations` entries → updated to destination location
- `move_sessions` → all location references updated to destination location

**Result:**
- ✅ **Zero data loss**
- ✅ All moves remain functional
- ✅ Distance/cost calculations still work
- ⚠️ **Edge case:** If origin and destination become the same, move may need review

**Example:**
```
Before: Seattle Apartment → Portland House (moving from Seattle to Portland)
After deletion of "Seattle Apartment" (reassigned to "Storage Unit"):
Result: Storage Unit → Portland House (now moving from storage to Portland)
```

---

### Strategy 2: `unassigned` - Move to Unassigned Items

**What happens to inventory:**
- All collections → moved to auto-created "Unassigned Items" holding location
- All items → preserved in their collections
- All containers → preserved in their collections

**What happens to moves:**
- **All affected `saved_moves` → PERMANENTLY DELETED**
- Associated `move_sessions` → deleted
- Associated `move_waypoints` → deleted
- Associated `move_locations` entries → deleted

**Rationale:**
- Moves to/from "Unassigned Items" don't make logical sense
- "Unassigned Items" has no address → can't calculate distance/cost
- Better to delete moves than have broken move plans

**Example:**
```
Before: Seattle Apartment → Portland House
After deletion of "Seattle Apartment" (unassigned):
Result: Move deleted (moving from "Unassigned Items" is meaningless)
```

---

### Strategy 3: `delete_all` - Delete All Inventory

**What happens to inventory:**
- All collections → **PERMANENTLY DELETED**
- All items → deleted (cascade)
- All containers → deleted (cascade)

**What happens to moves:**
- **All affected `saved_moves` → PERMANENTLY DELETED**
- Associated `move_sessions` → deleted
- Associated `move_waypoints` → deleted
- Associated `move_locations` entries → deleted

**Rationale:**
- User is doing complete cleanup
- No inventory = no reason to keep move plans
- Simpler UX than leaving orphaned moves

---

## Frontend Preview API Response

### GET /locations/delete/preview?location_id=123

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
    "containers": 15,
    "moves": 3
  },
  "affectedMoves": [
    { "id": 5, "name": "Summer 2025 Move" },
    { "id": 12, "name": "Storage Transfer" },
    { "id": 18, "name": "Temporary Relocation" }
  ],
  "availableDestinations": [
    {
      "id": 124,
      "name": "Portland House",
      "location_type": "residence",
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
      "description": "Collections and items will be moved to the selected location",
      "moveBehavior": "3 saved move(s) will be updated to use the new location",
      "recommended": true,
      "requiresDestination": true
    },
    {
      "id": "unassigned",
      "name": "Move to Unassigned Items",
      "description": "Collections will be moved to a holding area",
      "moveBehavior": "3 saved move(s) will be permanently deleted",
      "recommended": false,
      "requiresDestination": false
    },
    {
      "id": "delete_all",
      "name": "Delete all inventory",
      "description": "Permanently delete all collections, items, and containers at this location",
      "moveBehavior": "3 saved move(s) will be permanently deleted",
      "recommended": false,
      "requiresDestination": false,
      "requiresConfirmation": true
    }
  ]
}
```

---

## Frontend Dialog UX

### Example Dialog with Move Warning

```vue
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
        <li v-if="deletionPreview?.affectedData.moves > 0" class="text-warning">
          ⚠️ {{ deletionPreview?.affectedData.moves }} saved move(s)
        </li>
      </ul>

      <!-- Show affected moves if any -->
      <q-banner
        v-if="deletionPreview?.affectedData.moves > 0"
        class="bg-warning-1 q-mt-md"
      >
        <template v-slot:avatar>
          <q-icon name="warning" color="warning" />
        </template>
        <div class="text-subtitle2 q-mb-xs">Affected Moves:</div>
        <ul class="text-body2">
          <li v-for="move in deletionPreview?.affectedMoves" :key="move.id">
            {{ move.name }}
          </li>
        </ul>
      </q-banner>

      <div class="text-body1 q-mt-md q-mb-sm">
        What would you like to do with this inventory?
      </div>

      <!-- Strategy Selection -->
      <q-option-group
        v-model="selectedStrategy"
        :options="deletionPreview?.deletionStrategies.map(s => ({
          label: s.name,
          value: s.id,
          caption: s.moveBehavior  // Shows move impact!
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

      <!-- Delete Confirmation (for unassigned/delete_all with moves) -->
      <div v-if="(selectedStrategy === 'unassigned' || selectedStrategy === 'delete_all') &&
                  deletionPreview?.affectedData.moves > 0"
           class="q-mt-md">
        <q-banner class="bg-red-1 text-negative">
          <template v-slot:avatar>
            <q-icon name="warning" color="negative" />
          </template>
          This will permanently delete {{ deletionPreview?.affectedData.moves }} saved move(s).
          This action cannot be undone.
        </q-banner>
      </div>

      <!-- DELETE confirmation for delete_all -->
      <div v-if="selectedStrategy === 'delete_all'" class="q-mt-md">
        <q-input
          v-model="deleteConfirmation"
          label="Type DELETE to confirm"
          outlined
          dense
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
```

---

## Success Messages

### Reassign Strategy
```javascript
if (data.deletedCounts.movesUpdated > 0) {
  message = `Location deleted. ${data.deletedCounts.moved} collections and ${data.deletedCounts.movesUpdated} move(s) moved to ${destinationName}.`;
} else {
  message = `Location deleted. ${data.deletedCounts.moved} collections moved to ${destinationName}.`;
}
```

### Unassigned Strategy
```javascript
if (data.deletedCounts.movesDeleted > 0) {
  message = `Location deleted. ${data.deletedCounts.moved} collections moved to Unassigned Items. ${data.deletedCounts.movesDeleted} move(s) deleted.`;
} else {
  message = `Location deleted. ${data.deletedCounts.moved} collections moved to Unassigned Items.`;
}
```

### Delete All Strategy
```javascript
message = `Location deleted. ${data.deletedCounts.collections} collections, ${data.deletedCounts.items} items, ${data.deletedCounts.containers} containers, and ${data.deletedCounts.movesDeleted} move(s) permanently deleted.`;
```

---

## Database Operations

### Reassign Strategy
```sql
BEGIN;

-- Update collections
UPDATE collections
SET location_id = :destination_location_id, updated_at = NOW()
WHERE location_id = :location_id AND user_id = :user_id;

-- Update saved_moves origin
UPDATE saved_moves
SET origin_location_id = :destination_location_id, updated_at = NOW()
WHERE origin_location_id = :location_id AND user_id = :user_id;

-- Update saved_moves destination
UPDATE saved_moves
SET destination_location_id = :destination_location_id, updated_at = NOW()
WHERE destination_location_id = :location_id AND user_id = :user_id;

-- Update waypoints
UPDATE move_waypoints
SET location_id = :destination_location_id
WHERE location_id = :location_id;

-- Update move_locations
UPDATE move_locations
SET location_id = :destination_location_id
WHERE location_id = :location_id;

-- Update move_sessions
UPDATE move_sessions
SET session_start_location_id = :destination_location_id, updated_at = NOW()
WHERE session_start_location_id = :location_id AND user_id = :user_id;

-- Delete location
DELETE FROM locations WHERE id = :location_id AND user_id = :user_id;

COMMIT;
```

### Unassigned/Delete All Strategy
```sql
BEGIN;

-- Move collections (unassigned only)
UPDATE collections
SET location_id = :holding_location_id, updated_at = NOW()
WHERE location_id = :location_id AND user_id = :user_id;

-- OR delete collections (delete_all only)
DELETE FROM collections
WHERE location_id = :location_id AND user_id = :user_id;

-- Find affected moves
SELECT DISTINCT id FROM saved_moves
WHERE (origin_location_id = :location_id OR destination_location_id = :location_id)
  AND user_id = :user_id
UNION
SELECT DISTINCT saved_move_id FROM move_waypoints
WHERE location_id = :location_id;

-- Delete associated data
DELETE FROM move_waypoints WHERE saved_move_id IN (:affected_move_ids);
DELETE FROM move_locations WHERE move_id IN (:affected_move_ids);
DELETE FROM move_sessions WHERE saved_move_id IN (:affected_move_ids);
DELETE FROM saved_moves WHERE id IN (:affected_move_ids);

-- Delete location
DELETE FROM locations WHERE id = :location_id AND user_id = :user_id;

COMMIT;
```

---

## Benefits of This Approach

1. **Clear User Intent**
   - If user wants to keep data → choose `reassign` → everything preserved
   - If user wants quick cleanup → choose `unassigned` or `delete_all` → moves deleted too

2. **No Broken Moves**
   - Never leaves moves in invalid state (NULL origins/destinations)
   - No confusing "Unassigned Items" in move plans
   - All moves are either fully functional or deleted

3. **Predictable Behavior**
   - Preview shows exactly what will happen to moves
   - Success message confirms what was deleted/updated
   - No surprises

4. **Simpler Implementation**
   - No need for complex "needs review" workflow
   - No NULL handling in move UI
   - Clean, deterministic logic

5. **Better UX**
   - User makes one choice, system handles everything consistently
   - Clear warnings before deletion
   - If they care about moves, they'll choose `reassign`
