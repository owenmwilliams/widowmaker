# MoveTrack - Migration & Implementation Notes

This document outlines what has been created, what needs to be updated, and implementation priorities for the MoveTrack application.

## ✅ What's Been Created

### New Workspace Structure
- `/Users/owenwilliams/Projects/movetrack/` - New workspace directory
- Complete copy of `takestock-app` → `movetrack-app`
- Complete copy of `takestock-api` → `movetrack-api`
- All Web3 functionality removed from this workspace

### New Database Schema
- **Enhanced Tables**: Added moving/storage-specific fields to existing tables
  - `items`: Added `estimated_value`, `fragile`, `priority`, `weight_lbs`, `dimensions`, `notes`
  - `containers`: Added `box_number`, `box_type`, `sealed`, `weight_lbs`, `fragile_contents`, `qr_code`, `color_code`
  - `collections`: Added `color_code`, `icon`
  - `locations`: Added `location_type`, `contact_name`, `contact_phone`, `access_code`, `unit_number`, `country`, `notes`

- **New Tables**:
  - `move_projects`: Track entire move operations
  - `move_tasks`: Checklist items for moves
  - `storage_units`: Storage facility details and costs
  - `item_history`: Audit trail of item movements

### Configuration Files
- `docker-compose.yaml`: Updated with MoveTrack branding, removed Web3, added environment variables
- `.env.example`: Template for environment configuration
- `.gitignore`: Standard ignores for Node.js, Docker, and sensitive files
- `setup.sh`: Quick setup script for new users
- `README.md`: Comprehensive documentation for moving/storage use case
- `init-movetrack.sql`: Enhanced database initialization

## 🔨 What Needs to Be Implemented

### Priority 1: Core API Updates (Required for Basic Functionality)

#### 1. Database Connection Updates
**File**: `movetrack-api/bin/database.js` or similar
- Update database connection config to use new environment variables:
  - `MT_DATALAYER_HOSTNAME` instead of `TS_DATALAYER_HOSTNAME`
  - `MT_DATALAYER_DATABASE` → `movetrack_db`
  - `MT_DATALAYER_USERNAME` → `movetrack_user`

#### 2. New API Routes (New Feature Routes)
Create these new route files in `movetrack-api/routes/`:

**`move-projects.js`**
```javascript
// CRUD operations for move_projects table
GET    /move-projects          // List all projects
POST   /move-projects          // Create new project
GET    /move-projects/:id      // Get project details
PUT    /move-projects/:id      // Update project
DELETE /move-projects/:id      // Delete project
```

**`move-tasks.js`**
```javascript
// CRUD operations for move_tasks table
GET    /move-projects/:projectId/tasks    // List tasks for project
POST   /move-projects/:projectId/tasks    // Create task
PUT    /tasks/:id                          // Update task
DELETE /tasks/:id                          // Delete task
PATCH  /tasks/:id/complete                 // Mark complete
```

**`storage-units.js`**
```javascript
// CRUD operations for storage_units table
GET    /storage-units          // List all storage units
POST   /storage-units          // Create new unit
GET    /storage-units/:id      // Get unit details
PUT    /storage-units/:id      // Update unit
DELETE /storage-units/:id      // Delete unit
```

**`item-history.js`**
```javascript
// Track item movements
GET    /items/:id/history      // Get item movement history
POST   /item-history           // Record a movement
GET    /move-projects/:id/history  // Get all movements for a move
```

#### 3. Update Existing Routes
Modify existing routes in `movetrack-api/routes/` to handle new fields:

**`items.js`**
- Add handling for: `estimated_value`, `fragile`, `priority`, `weight_lbs`, `dimensions`, `notes`
- Add item history recording on updates

**`containers.js`**
- Add handling for: `box_number`, `box_type`, `sealed`, `sealed_at`, `weight_lbs`, `fragile_contents`, `qr_code`, `color_code`

**`collections.js`**
- Add handling for: `color_code`, `icon`

**`locations.js`**
- Add handling for: `location_type`, `contact_name`, `contact_phone`, `access_code`, `unit_number`, `country`, `notes`

#### 4. Register New Routes
**File**: `movetrack-api/app.js`
```javascript
// Add these imports
const moveProjectsRouter = require('./routes/move-projects');
const moveTasksRouter = require('./routes/move-tasks');
const storageUnitsRouter = require('./routes/storage-units');
const itemHistoryRouter = require('./routes/item-history');

// Register routes
app.use('/move-projects', moveProjectsRouter);
app.use('/move-tasks', moveTasksRouter);
app.use('/tasks', moveTasksRouter); // For direct task access
app.use('/storage-units', storageUnitsRouter);
app.use('/item-history', itemHistoryRouter);
```

### Priority 2: Frontend Updates (Required for UI)

#### 1. Pinia Store Updates
**File**: `movetrack-app/src/stores/InventoryStore.ts`

Add new state sections:
```typescript
// Add to store state
moveProjects: [],
currentMoveProject: null,
moveTasks: [],
storageUnits: [],
itemHistory: []
```

Add new actions:
```typescript
// Move Projects
async fetchMoveProjects()
async createMoveProject(project)
async updateMoveProject(id, updates)
async deleteMoveProject(id)

// Move Tasks
async fetchMoveTasks(projectId)
async createMoveTask(projectId, task)
async updateMoveTask(id, updates)
async completeTask(id)

// Storage Units
async fetchStorageUnits()
async createStorageUnit(unit)
async updateStorageUnit(id, updates)

// Item History
async fetchItemHistory(itemId)
async recordItemMovement(movement)
```

#### 2. New Vue Components
Create these components in `movetrack-app/src/components/`:

**Desktop Components** (`movetrack-app/src/components/desktop/`)
- `MoveProjectsList.vue` - List all move projects
- `MoveProjectDetail.vue` - View/edit single move project
- `MoveProjectForm.vue` - Create/edit move project
- `MoveTasksList.vue` - Checklist of tasks for a move
- `MoveTaskItem.vue` - Single task component
- `StorageUnitsList.vue` - List storage units
- `StorageUnitCard.vue` - Single storage unit display
- `StorageUnitForm.vue` - Create/edit storage unit
- `ItemHistoryTimeline.vue` - Show item movement history
- `BoxLabel.vue` - Printable box label component
- `ColorCodePicker.vue` - Color selection for rooms/boxes

**Mobile Components** (`movetrack-app/src/components/mobile/`)
- `MobileMoveProjectCard.vue` - Move project card for mobile
- `MobileMoveTaskList.vue` - Mobile-optimized task list
- `MobileBoxScanner.vue` - QR code scanner for boxes
- `MobileStorageUnit.vue` - Storage unit view for mobile

#### 3. New Views/Pages
Create these pages in `movetrack-app/src/views/`:

- `MoveProjects.vue` - Main move projects page
- `MoveProjectDetails.vue` - Single move project view
- `StorageUnits.vue` - Storage units management
- `BoxLabels.vue` - Generate and print box labels
- `MoveTimeline.vue` - Visual timeline of move progress
- `Reports.vue` - Moving reports and statistics

#### 4. Update Router
**File**: `movetrack-app/src/router/index.ts`
```typescript
{
  path: '/move-projects',
  name: 'MoveProjects',
  component: () => import('../views/MoveProjects.vue')
},
{
  path: '/move-projects/:id',
  name: 'MoveProjectDetails',
  component: () => import('../views/MoveProjectDetails.vue')
},
{
  path: '/storage-units',
  name: 'StorageUnits',
  component: () => import('../views/StorageUnits.vue')
},
{
  path: '/box-labels',
  name: 'BoxLabels',
  component: () => import('../views/BoxLabels.vue')
}
```

#### 5. Update Navigation
**Files**: Navigation components in `movetrack-app/src/components/`
- Add menu items for:
  - Move Projects
  - Storage Units
  - Box Labels
  - Reports

#### 6. Enhanced Existing Forms
Update existing forms to include new fields:

**`ItemForm.vue`**
- Add fields: Value, Fragile checkbox, Priority dropdown, Weight, Dimensions
- Add "Notes" textarea

**`ContainerForm.vue`**
- Add fields: Box Number, Box Type dropdown, Color Code picker, QR Code display
- Add "Sealed" checkbox with seal date

**`CollectionForm.vue`**
- Add fields: Color Code picker, Icon selector

**`LocationForm.vue`**
- Add fields: Location Type dropdown, Contact info, Access Code, Unit Number

### Priority 3: Enhanced Features (Nice-to-Have)

#### 1. QR Code Generation
- Install package: `qrcode` or `qrcode.vue3`
- Add QR generation to container creation
- Create printable label template
- Implement QR scanner for mobile

#### 2. Box Label Printing
- Create printable PDF templates
- Use `jspdf` or similar library
- Include QR code, box number, room, contents list

#### 3. Color Coding System
- Predefined color palette for rooms
- Visual color indicators in lists
- Color-coded box labels

#### 4. Moving Checklist Templates
- Pre-built task templates for common moves
- Task categories (1 month before, 1 week before, moving day, etc.)
- Customizable templates

#### 5. Reports & Analytics
- Total item count and value
- Boxes per room breakdown
- Unpacking progress tracker
- Storage cost calculator
- Moving timeline visualization

#### 6. Barcode Scanning
- Use device camera to scan product barcodes
- Auto-lookup item details
- Faster item entry

### Priority 4: Production Readiness

#### 1. Security
- Re-enable JWT authentication in `movetrack-api/app.js`
- Move all API keys to environment variables
- Implement proper CORS policies
- Add rate limiting

#### 2. Testing
- Unit tests for API routes
- Component tests for Vue components
- E2E tests for critical workflows
- Test mobile app on devices

#### 3. Documentation
- API documentation (Swagger/OpenAPI)
- Component storybook
- User guide/help section
- Video tutorials

#### 4. Performance
- Database indexing (already in schema)
- Image optimization
- Lazy loading for routes
- Pagination for large lists

#### 5. Deployment
- Production Dockerfile configurations
- CI/CD pipeline setup
- Cloud hosting configuration
- Database backup strategy

## 🎯 Recommended Implementation Order

### Week 1: Foundation
1. Update database connection configs
2. Create new API routes (move-projects, move-tasks, storage-units)
3. Update existing routes with new fields
4. Test API endpoints with Postman

### Week 2: Core UI
1. Update Pinia store with new actions
2. Create MoveProjects list and detail views
3. Create basic move task checklist
4. Update item/container forms with new fields

### Week 3: Storage Features
1. Create storage units management UI
2. Implement item history tracking
3. Add color coding system
4. Enhanced container/box management

### Week 4: Polish & Mobile
1. QR code generation and scanning
2. Box label printing
3. Mobile optimizations
4. Reports and analytics

### Week 5: Production Prep
1. Security hardening
2. Testing
3. Documentation
4. Performance optimization

## 📝 Notes

### Reusable Components from TakeStock
Most of the existing UI components can be reused:
- Item cards and lists
- Container management
- Collection/room views
- Location management
- Image upload and display
- Search and filter functionality

### Breaking Changes from TakeStock
- Database name changed: `demo_project_edition` → `movetrack_db`
- Environment variable prefix changed: `TS_*` → `MT_*`
- All Web3/NFT functionality removed
- New database tables require API implementation

### Future Considerations
- Multi-tenant support for moving companies
- Integration with moving company APIs
- Marketplace for selling items during move
- Insurance integration for claims
- Collaboration features for family members
- Template sharing (room layouts, checklists)

## 🔗 Migration Checklist

When ready to migrate from TakeStock codebase:

- [ ] Update all database connection strings
- [ ] Remove all Web3 imports and dependencies
- [ ] Update API endpoint references
- [ ] Remove Ethereum/blockchain components
- [ ] Update branding (TakeStock → MoveTrack)
- [ ] Test all existing functionality still works
- [ ] Implement new API routes
- [ ] Create new UI components
- [ ] Update navigation and routing
- [ ] Test end-to-end workflows
- [ ] Update documentation
- [ ] Deploy to staging environment

---

**Last Updated**: 2025-11-02
**Status**: Ready for development
