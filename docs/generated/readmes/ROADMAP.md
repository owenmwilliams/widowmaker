# VeriMove Development Roadmap

## Completed Features ✅

### Authentication & Security
- ✅ Magic link authentication system (passwordless)
- ✅ 30-day session tokens with JWT
- ✅ Session-based authentication middleware
- ✅ Email integration (SendGrid) with console fallback
- ✅ Fixed 401 authentication errors for /items routes

### Branding & Design
- ✅ VeriMove "Precision Blue" color scheme implemented
  - Primary: #274690 (Royal Blue)
  - Secondary: #1CA1C1 (Proof Cyan)
  - Positive: #2EBD85 (On-Time Green)
  - Negative: #D64545 (Safety Red)
  - Warning: #C99A3E (Brass)
- ✅ Shield logo with checkmark and "VERIMOVE" text
- ✅ Responsive logo component
- ✅ Consistent branding across application

### Desktop Features
- ✅ Collections management with drag-and-drop
- ✅ Container creation and organization
- ✅ Items table with search and filtering
- ✅ Photo capture with AI analysis (Gemini/Claude/GPT-4)
- ✅ AI-powered item detection from photos
- ✅ Vision provider selection (Settings page)
- ✅ Auto-create default collection for new users
- ✅ Settings page (Vision AI + Locations)
- ✅ Support page with contact form and FAQ
- ✅ Unpacked items section (items without containers)

### UI/UX Improvements
- ✅ Image scaling in photo modal
- ✅ Loading indicators for async operations
- ✅ Bottom notifications to avoid header overlap
- ✅ Better error messaging for session expiration
- ✅ Color-coded buttons (primary vs secondary)
- ✅ Simplified menu structure

## Pending Features & Improvements 📋

### High Priority

#### 1. UUID-Based User Identification
**Status:** Planned for future implementation
**Reason:** Critical for production to avoid username collisions

**Phase 1: Database Schema (Safe Migration)**
- [ ] Add UUID column to `users` table
  ```sql
  ALTER TABLE users ADD COLUMN uuid UUID DEFAULT gen_random_uuid();
  CREATE UNIQUE INDEX users_uuid_idx ON users(uuid);
  UPDATE users SET uuid = gen_random_uuid() WHERE uuid IS NULL;
  ALTER TABLE users ALTER COLUMN uuid SET NOT NULL;
  ```
- [ ] Add UUID foreign keys to related tables:
  - `items.user_uuid UUID REFERENCES users(uuid)`
  - `collections.user_uuid UUID REFERENCES users(uuid)`
  - `containers.user_uuid UUID REFERENCES users(uuid)`
  - `locations.user_uuid UUID REFERENCES users(uuid)`
- [ ] Backfill existing data:
  ```sql
  UPDATE items SET user_uuid = (SELECT uuid FROM users WHERE users.user_name = items.owner);
  UPDATE collections SET user_uuid = (SELECT uuid FROM users WHERE users.user_name = collections.owner);
  UPDATE containers SET user_uuid = (SELECT uuid FROM users WHERE users.user_name = containers.owner);
  UPDATE locations SET user_uuid = (SELECT uuid FROM users WHERE users.user_name = locations.owner);
  ```

**Phase 2: Backend API**
- [ ] Update JWT session token payload to include UUID
- [ ] Modify `authService.js` to return UUID from session
- [ ] Update API middleware to extract and pass UUID
- [ ] Update all routes to accept both `user` and `user_uuid` (backward compatibility)
- [ ] Gradually migrate route handlers to use UUID internally

**Phase 3: Frontend**
- [ ] Update auth store to store UUID from session response
- [ ] Modify InventoryStore to use UUID instead of username
- [ ] Update all API calls to pass `user_uuid` parameter
- [ ] Update component props to pass UUID

**Phase 4: Cleanup (After Testing)**
- [ ] Remove username-based foreign keys
- [ ] Make UUID columns NOT NULL and primary identifiers
- [ ] Remove backward compatibility code
- [ ] Update database constraints

#### 2. Mobile Version Improvements
**Status:** Needs review and simplification
**Priority:** High - Many users will access via mobile

**Tasks:**
- [ ] Review current mobile layout and user flow
- [ ] Simplify navigation for mobile users
- [ ] Optimize touch interactions
- [ ] Improve photo capture experience on mobile
- [ ] Test responsive design on various screen sizes
- [ ] Consider mobile-first redesign of key features

### Medium Priority

#### 3. Container Management Enhancements
- [ ] Edit container details
- [ ] Delete containers with item reassignment
- [ ] Container search and filtering
- [ ] Container color coding/labeling
- [ ] Print container labels with QR codes

#### 4. Items Management
- [ ] Bulk item operations (move, delete, update)
- [ ] Item search across all collections
- [ ] Advanced filtering (by fragile, weight, dimensions)
- [ ] Export inventory to CSV/PDF
- [ ] Item history and audit log

#### 5. Sharing & Collaboration
- [ ] Share inventory with movers (read-only link)
- [ ] Temporary access tokens for movers
- [ ] Multiple user access levels (owner, viewer)
- [ ] Activity log for shared inventories

### Low Priority

#### 6. Analytics & Insights
- [ ] Total weight calculation per container/collection
- [ ] Volume estimation
- [ ] Cost estimation based on weight/volume
- [ ] Move timeline planning
- [ ] Progress tracking

#### 7. Advanced Features
- [ ] Barcode/QR code scanning
- [ ] Integration with moving companies
- [ ] Packing checklists
- [ ] Essential items flagging
- [ ] Custom fields for items

## Technical Debt & Optimizations

### Performance
- [ ] Implement pagination for large item lists
- [ ] Optimize image upload and storage
- [ ] Add caching for frequently accessed data
- [ ] Lazy loading for images
- [ ] Database query optimization

### Code Quality
- [ ] Add TypeScript to backend
- [ ] Comprehensive error handling
- [ ] API rate limiting
- [ ] Input validation and sanitization
- [ ] Automated testing (unit, integration, e2e)

### DevOps
- [ ] CI/CD pipeline setup
- [ ] Automated database backups
- [ ] Monitoring and logging
- [ ] Production deployment strategy
- [ ] Environment-specific configurations

## Notes

### Current Issues
- Container creation now working (fixed parameter order)
- Photo capture image scaling improved
- Session expiration errors now show clear messaging
- All notifications appear from bottom to avoid header

### Design Decisions
- Items can exist without containers ("Unpacked Items")
- Collections are required for items
- Default collection auto-created for new users
- Magic link sessions last 30 days

### Future Considerations
- Consider PWA features for offline access
- Explore native mobile app development
- Integration with storage facility APIs
- Insurance valuation features
- Moving company marketplace integration
