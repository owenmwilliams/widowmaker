# MoveTrack Implementation Checklist

Use this checklist to track your progress as you build out MoveTrack.

## 🏗️ Setup & Configuration

- [x] Create new workspace directory
- [x] Copy takestock-app to movetrack-app
- [x] Copy takestock-api to movetrack-api
- [x] Update package.json files
- [x] Create enhanced database schema
- [x] Create Docker Compose configuration
- [x] Create .env.example
- [x] Create setup script
- [x] Create documentation
- [ ] Initialize git repository
- [ ] Create .env file with actual values
- [ ] Test Docker Compose startup
- [ ] Verify database initialization

## 🔧 Backend API - Configuration

- [ ] Update database connection config in `movetrack-api/bin/database.js`
  - [ ] Change `TS_DATALAYER_*` to `MT_DATALAYER_*`
  - [ ] Update database name to `movetrack_db`
  - [ ] Update username to `movetrack_user`
- [ ] Remove/clean up Web3-related imports
- [ ] Update CORS configuration if needed
- [ ] Test API server starts successfully

## 🔧 Backend API - New Routes

### Move Projects Routes
- [ ] Create `movetrack-api/routes/move-projects.js`
- [ ] Implement `GET /move-projects` - List all projects
- [ ] Implement `POST /move-projects` - Create project
- [ ] Implement `GET /move-projects/:id` - Get single project
- [ ] Implement `PUT /move-projects/:id` - Update project
- [ ] Implement `DELETE /move-projects/:id` - Delete project
- [ ] Add project status filtering
- [ ] Register route in app.js
- [ ] Test with Postman/curl

### Move Tasks Routes
- [ ] Create `movetrack-api/routes/move-tasks.js`
- [ ] Implement `GET /move-projects/:projectId/tasks` - List tasks
- [ ] Implement `POST /move-projects/:projectId/tasks` - Create task
- [ ] Implement `PUT /tasks/:id` - Update task
- [ ] Implement `PATCH /tasks/:id/complete` - Mark complete
- [ ] Implement `DELETE /tasks/:id` - Delete task
- [ ] Register route in app.js
- [ ] Test with Postman/curl

### Storage Units Routes
- [ ] Create `movetrack-api/routes/storage-units.js`
- [ ] Implement `GET /storage-units` - List units
- [ ] Implement `POST /storage-units` - Create unit
- [ ] Implement `GET /storage-units/:id` - Get single unit
- [ ] Implement `PUT /storage-units/:id` - Update unit
- [ ] Implement `DELETE /storage-units/:id` - Delete unit
- [ ] Add cost calculation helpers
- [ ] Register route in app.js
- [ ] Test with Postman/curl

### Item History Routes
- [ ] Create `movetrack-api/routes/item-history.js`
- [ ] Implement `GET /items/:id/history` - Get item history
- [ ] Implement `POST /item-history` - Record movement
- [ ] Implement `GET /move-projects/:id/history` - Get project history
- [ ] Register route in app.js
- [ ] Test with Postman/curl

## 🔧 Backend API - Update Existing Routes

### Items Route Updates
- [ ] Open `movetrack-api/routes/items.js`
- [ ] Add `estimated_value` to create/update
- [ ] Add `fragile` (boolean) to create/update
- [ ] Add `priority` to create/update
- [ ] Add `weight_lbs` to create/update
- [ ] Add `dimensions` to create/update
- [ ] Add `notes` to create/update
- [ ] Add automatic item history recording
- [ ] Test all endpoints

### Containers Route Updates
- [ ] Open `movetrack-api/routes/containers.js`
- [ ] Add `box_number` to create/update
- [ ] Add `box_type` to create/update
- [ ] Add `sealed` (boolean) to create/update
- [ ] Add `sealed_at` (timestamp) on seal
- [ ] Add `weight_lbs` to create/update
- [ ] Add `fragile_contents` to create/update
- [ ] Add `qr_code` to create/update
- [ ] Add `color_code` to create/update
- [ ] Test all endpoints

### Collections Route Updates
- [ ] Open `movetrack-api/routes/collections.js`
- [ ] Add `color_code` to create/update
- [ ] Add `icon` to create/update
- [ ] Test all endpoints

### Locations Route Updates
- [ ] Open `movetrack-api/routes/locations.js`
- [ ] Add `location_type` to create/update
- [ ] Add `contact_name` to create/update
- [ ] Add `contact_phone` to create/update
- [ ] Add `access_code` to create/update
- [ ] Add `unit_number` to create/update
- [ ] Add `country` to create/update
- [ ] Add `notes` to create/update
- [ ] Test all endpoints

## 🎨 Frontend - Store Updates

- [ ] Open `movetrack-app/src/stores/InventoryStore.ts`
- [ ] Add `moveProjects` state array
- [ ] Add `currentMoveProject` state
- [ ] Add `moveTasks` state array
- [ ] Add `storageUnits` state array
- [ ] Add `itemHistory` state array

### Move Projects Store Actions
- [ ] Implement `fetchMoveProjects()`
- [ ] Implement `createMoveProject(project)`
- [ ] Implement `updateMoveProject(id, updates)`
- [ ] Implement `deleteMoveProject(id)`
- [ ] Implement `setCurrentMoveProject(id)`

### Move Tasks Store Actions
- [ ] Implement `fetchMoveTasks(projectId)`
- [ ] Implement `createMoveTask(projectId, task)`
- [ ] Implement `updateMoveTask(id, updates)`
- [ ] Implement `completeTask(id)`
- [ ] Implement `deleteTask(id)`

### Storage Units Store Actions
- [ ] Implement `fetchStorageUnits()`
- [ ] Implement `createStorageUnit(unit)`
- [ ] Implement `updateStorageUnit(id, updates)`
- [ ] Implement `deleteStorageUnit(id)`

### Item History Store Actions
- [ ] Implement `fetchItemHistory(itemId)`
- [ ] Implement `recordItemMovement(movement)`

## 🎨 Frontend - New Components (Desktop)

### Move Projects Components
- [ ] Create `movetrack-app/src/components/desktop/MoveProjectsList.vue`
- [ ] Create `movetrack-app/src/components/desktop/MoveProjectCard.vue`
- [ ] Create `movetrack-app/src/components/desktop/MoveProjectForm.vue`
- [ ] Create `movetrack-app/src/components/desktop/MoveProjectDetail.vue`
- [ ] Create `movetrack-app/src/components/desktop/MoveProjectTimeline.vue`

### Move Tasks Components
- [ ] Create `movetrack-app/src/components/desktop/MoveTasksList.vue`
- [ ] Create `movetrack-app/src/components/desktop/MoveTaskItem.vue`
- [ ] Create `movetrack-app/src/components/desktop/MoveTaskForm.vue`
- [ ] Create `movetrack-app/src/components/desktop/TaskTemplates.vue`

### Storage Units Components
- [ ] Create `movetrack-app/src/components/desktop/StorageUnitsList.vue`
- [ ] Create `movetrack-app/src/components/desktop/StorageUnitCard.vue`
- [ ] Create `movetrack-app/src/components/desktop/StorageUnitForm.vue`
- [ ] Create `movetrack-app/src/components/desktop/StorageUnitDetail.vue`

### Other Desktop Components
- [ ] Create `movetrack-app/src/components/desktop/ItemHistoryTimeline.vue`
- [ ] Create `movetrack-app/src/components/desktop/BoxLabel.vue`
- [ ] Create `movetrack-app/src/components/desktop/ColorCodePicker.vue`
- [ ] Create `movetrack-app/src/components/desktop/QRCodeGenerator.vue`
- [ ] Create `movetrack-app/src/components/desktop/MoveReports.vue`

## 🎨 Frontend - New Components (Mobile)

- [ ] Create `movetrack-app/src/components/mobile/MobileMoveProjectCard.vue`
- [ ] Create `movetrack-app/src/components/mobile/MobileMoveTaskList.vue`
- [ ] Create `movetrack-app/src/components/mobile/MobileBoxScanner.vue`
- [ ] Create `movetrack-app/src/components/mobile/MobileStorageUnit.vue`
- [ ] Create `movetrack-app/src/components/mobile/MobileBoxLabel.vue`

## 🎨 Frontend - New Views/Pages

- [ ] Create `movetrack-app/src/views/MoveProjects.vue`
- [ ] Create `movetrack-app/src/views/MoveProjectDetails.vue`
- [ ] Create `movetrack-app/src/views/StorageUnits.vue`
- [ ] Create `movetrack-app/src/views/BoxLabels.vue`
- [ ] Create `movetrack-app/src/views/MoveTimeline.vue`
- [ ] Create `movetrack-app/src/views/Reports.vue`

## 🎨 Frontend - Update Existing Components

### Update Item Form
- [ ] Open item form component
- [ ] Add "Estimated Value" number input
- [ ] Add "Fragile" checkbox
- [ ] Add "Priority" dropdown (High/Normal/Low)
- [ ] Add "Weight (lbs)" number input
- [ ] Add "Dimensions" text input
- [ ] Add "Notes" textarea
- [ ] Test form submission

### Update Container Form
- [ ] Open container form component
- [ ] Add "Box Number" text input
- [ ] Add "Box Type" dropdown
- [ ] Add "Color Code" color picker
- [ ] Add "Fragile Contents" checkbox
- [ ] Add "Sealed" checkbox
- [ ] Add "Weight (lbs)" number input
- [ ] Display QR code if exists
- [ ] Test form submission

### Update Collection Form
- [ ] Open collection form component
- [ ] Add "Color Code" color picker
- [ ] Add "Icon" selector
- [ ] Test form submission

### Update Location Form
- [ ] Open location form component
- [ ] Add "Location Type" dropdown
- [ ] Add "Contact Name" text input
- [ ] Add "Contact Phone" text input
- [ ] Add "Access Code" text input
- [ ] Add "Unit Number" text input (for storage)
- [ ] Add "Country" dropdown
- [ ] Add "Notes" textarea
- [ ] Test form submission

## 🎨 Frontend - Router Updates

- [ ] Open `movetrack-app/src/router/index.ts`
- [ ] Add route for `/move-projects`
- [ ] Add route for `/move-projects/:id`
- [ ] Add route for `/storage-units`
- [ ] Add route for `/box-labels`
- [ ] Add route for `/reports`
- [ ] Test all routes navigate correctly

## 🎨 Frontend - Navigation Updates

- [ ] Open navigation component
- [ ] Add "Move Projects" menu item
- [ ] Add "Storage Units" menu item
- [ ] Add "Box Labels" menu item
- [ ] Add "Reports" menu item
- [ ] Update mobile navigation
- [ ] Test navigation on both desktop and mobile

## 🌟 Enhanced Features

### QR Code System
- [ ] Install `qrcode` npm package
- [ ] Create QR code generator utility
- [ ] Add QR generation to container creation
- [ ] Create printable label template
- [ ] Implement QR scanner for mobile
- [ ] Test scanning and lookup

### Box Label Printing
- [ ] Install `jspdf` or similar
- [ ] Create printable PDF template
- [ ] Include QR code in label
- [ ] Include box number, room, contents
- [ ] Add print button to container view
- [ ] Test printing

### Color Coding System
- [ ] Define color palette
- [ ] Create color picker component
- [ ] Add color indicators to lists
- [ ] Color-code box labels
- [ ] Test across all views

### Reports Dashboard
- [ ] Create reports page
- [ ] Total items count
- [ ] Total estimated value
- [ ] Boxes per room chart
- [ ] Unpacking progress tracker
- [ ] Storage cost summary
- [ ] Export to PDF

### Task Templates
- [ ] Create default task templates
- [ ] "1 Month Before" tasks
- [ ] "1 Week Before" tasks
- [ ] "Moving Day" tasks
- [ ] "First Week" tasks
- [ ] Allow custom templates
- [ ] Template selection on project creation

## 🔒 Security & Production

### Security Hardening
- [ ] Re-enable JWT authentication in app.js
- [ ] Remove hardcoded API keys
- [ ] Verify all API keys in .env
- [ ] Implement rate limiting
- [ ] Add input validation
- [ ] Sanitize user inputs
- [ ] Review CORS policies
- [ ] Add security headers

### Testing
- [ ] Set up testing framework
- [ ] Write API route tests
- [ ] Write component unit tests
- [ ] Write E2E tests for critical flows
- [ ] Test mobile app on iOS device
- [ ] Test mobile app on Android device
- [ ] Load testing
- [ ] Security testing

### Documentation
- [ ] API documentation (Swagger/OpenAPI)
- [ ] Component documentation
- [ ] User guide/help section
- [ ] Video tutorials
- [ ] Deployment guide
- [ ] Contribution guidelines

### Performance
- [ ] Optimize database queries
- [ ] Add database indexes (already in schema)
- [ ] Implement pagination
- [ ] Optimize images
- [ ] Lazy load routes
- [ ] Bundle size optimization
- [ ] Lighthouse audit

### Deployment
- [ ] Create production Dockerfiles
- [ ] Set up CI/CD pipeline
- [ ] Configure cloud hosting
- [ ] Set up database backups
- [ ] Configure CDN for images
- [ ] SSL certificate setup
- [ ] Monitoring and logging
- [ ] Error tracking (Sentry, etc.)

## 📱 Mobile Apps

### iOS App
- [ ] Configure Capacitor for iOS
- [ ] Test camera integration
- [ ] Test QR scanner
- [ ] Test offline mode
- [ ] App Store assets
- [ ] TestFlight beta
- [ ] App Store submission

### Android App
- [ ] Configure Capacitor for Android
- [ ] Test camera integration
- [ ] Test QR scanner
- [ ] Test offline mode
- [ ] Play Store assets
- [ ] Google Play beta
- [ ] Play Store submission

## 🎯 Final Checks

- [ ] All API endpoints tested
- [ ] All forms working
- [ ] All views responsive
- [ ] Mobile app tested
- [ ] Desktop app tested
- [ ] Database migrations work
- [ ] Docker Compose works
- [ ] Documentation complete
- [ ] Security audit passed
- [ ] Performance acceptable
- [ ] User testing completed
- [ ] Ready for launch!

---

**Progress Tracking**: Mark items as complete with [x] as you go.

**Last Updated**: 2025-11-02
