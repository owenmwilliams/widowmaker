# MoveTrack - Native iOS Application

A native Swift/SwiftUI application for MoveTrack inventory management.

**Status:** 🔧 Login Working - Testing in Progress
**Created:** December 26, 2025
**Last Updated:** February 2026
**Platform:** iOS 15.0+
**Language:** Swift 5.9+
**UI Framework:** SwiftUI

---

## 🗺️ Current Status (February 2026)

### Where We Left Off
The Xcode project is set up in `MoveTrack-iOS/widowmaker/widowmaker.xcodeproj` and builds successfully. We were in the middle of getting the copy/paste login code flow working.

**Last known issue being debugged:**
- API returns valid JSON with `session_token` and full `user` object
- iOS was failing to decode `user_id` field
- Root cause: Swift's `.convertFromSnakeCase` decoder strategy pre-converts keys to camelCase before matching CodingKeys, so CodingKeys must reference camelCase names (e.g. `userId`) not snake_case originals (e.g. `user_id`)
- Fix applied in `User.swift` CodingKeys — needs a rebuild and fresh test to verify

**To pick back up:**
1. Open `MoveTrack-iOS/widowmaker/widowmaker.xcodeproj` in Xcode
2. Build and run on iPhone simulator (⌘R)
3. Request a magic link email, copy the token from the link
4. Paste into "Have a code?" field and tap "Log In with Code"
5. Check Xcode console for `✅ [AuthViewModel] User authenticated:` — that's success

**API changes made (requires restart of API server):**
- `routes/auth.js` — route now returns `session_token` (snake_case) not `sessionToken`
- `bin/authService.js` — both `verifyMagicLinkToken` and `getUserFromToken` now return consistent snake_case field names

---

## 📱 Features Implemented

### ✅ Core Features
- [x] Magic link email authentication
- [x] Copy/paste login code (fallback for simulator testing)
- [x] Secure session token storage in Keychain
- [x] Browse locations, collections (rooms), and items
- [x] View item details with photos
- [x] Add new items
- [x] Pull-to-refresh on all lists
- [x] Async/await API integration
- [x] Proper error handling and loading states
- [x] Detailed console logging for debugging

### ⏳ Coming Soon
- [ ] Camera integration for photos
- [ ] QR code generation and scanning
- [ ] Offline mode with Core Data
- [ ] Move planning and tracking
- [ ] Search functionality
- [ ] Settings screen

---

## 📂 Project Structure

```
MoveTrack-iOS/
├── README.md (this file)
├── SETUP.md (detailed setup instructions)
├── QUICKSTART.md (get running in 20 minutes)
├── Models/
│   ├── User.swift - User account model
│   ├── Location.swift - Physical location model
│   ├── Collection.swift - Room/category model
│   ├── Container.swift - Box/container model
│   └── Item.swift - Individual item model
├── Services/
│   ├── KeychainService.swift - Secure credential storage
│   ├── APIClient.swift - Generic API client with URLSession
│   ├── AuthService.swift - Authentication logic
│   └── InventoryService.swift - Inventory CRUD operations
├── ViewModels/
│   ├── AuthViewModel.swift - Authentication state management
│   ├── LocationsViewModel.swift - Locations data management
│   ├── CollectionsViewModel.swift - Collections data management
│   └── ItemsViewModel.swift - Items data management
├── Views/
│   ├── Auth/
│   │   ├── LoginView.swift - Email login screen
│   │   └── MagicLinkSentView.swift - Confirmation screen
│   ├── Locations/
│   │   └── LocationsListView.swift - Browse locations
│   ├── Collections/
│   │   └── CollectionsListView.swift - Browse collections
│   └── Items/
│       ├── ItemsListView.swift - Browse items
│       ├── ItemDetailView.swift - Item detail view
│       └── AddItemView.swift - Add new item form
├── Utils/
│   └── Constants.swift - App-wide constants and configuration
├── MoveTrackApp.swift - App entry point with deep linking
└── ContentView.swift - Root view with auth routing
```

---

## 🚀 Quick Start

### Prerequisites
- macOS with Xcode 15.0+
- Apple Developer account (free tier OK for simulator)
- MoveTrack API running on localhost:3050

### Get Running in 3 Steps

1. **Create Xcode Project**
   ```bash
   # Open Xcode
   # Create new iOS App project
   # Name: MoveTrack
   # Interface: SwiftUI
   # Save to: /Users/owenwilliams/Projects/widowmaker/MoveTrack-iOS/
   ```

2. **Add All Swift Files**
   - See [SETUP.md](SETUP.md) for detailed instructions
   - Or follow [QUICKSTART.md](QUICKSTART.md) for fastest path

3. **Build and Run**
   ```bash
   # Press ⌘R in Xcode
   # Select iPhone 15 Pro simulator
   ```

See [QUICKSTART.md](QUICKSTART.md) for complete step-by-step instructions.

---

## 🔑 Authentication Flow

### Option A: Copy/Paste Code (Recommended for Simulator)
1. **User enters email** and taps "Send Magic Link"
2. **API sends magic link** to email - check email for the token
3. **Copy the token** from the magic link URL (the part after `?token=`)
4. **Paste into "Have a code?" field** in the app
5. **Tap "Log In with Code"**
6. **Session token saved** in Keychain (secure)

### Option B: Deep Link
1. **User enters email** and taps "Send Magic Link"
2. **Click the email link** on the same device
3. **iOS opens app** via `movetrack://` URL scheme
4. **Token verified automatically**

### Testing Authentication in Simulator

```bash
# Start API (use your startup script or:)
cd movetrack-api && npm start

# Request a magic link, then grab the token from the API logs
# Paste it into the "Have a code?" field in the app

# OR trigger via deep link:
xcrun simctl openurl booted "movetrack://login?token=YOUR_TOKEN_HERE"
```

---

## 🏗️ Architecture

### Design Pattern
- **MVVM** (Model-View-ViewModel)
- SwiftUI for declarative UI
- Combine for reactive programming
- Async/await for networking

### Data Flow
```
User Action
    ↓
  View
    ↓
ViewModel (ObservableObject)
    ↓
 Service
    ↓
APIClient
    ↓
Backend API
```

### State Management
- `@StateObject` for ViewModel lifecycle
- `@ObservedObject` for shared ViewModels
- `@EnvironmentObject` for global state (AuthViewModel)
- `@State` for local view state

---

## 🔐 Security

### Session Token Storage
- **Keychain** via `KeychainService`
- iOS Keychain is encrypted by default
- Protected by device passcode
- Cannot be extracted without device access

### API Communication
- **HTTPS only** in production
- Bearer token authentication
- Auto-logout on 401 errors
- Token refresh not implemented yet

### Permissions
- Camera (for photo capture)
- Photo Library (for selecting photos)
- Requested only when needed

---

## 📡 API Integration

### Base URL
- **Development:** `http://127.0.0.1:3050` (must use IP, not `localhost`, for iOS simulator)
- **Production:** `https://movetrack-api-7hwn7ggbiq-uc.a.run.app`

### Key Endpoints Used

**Authentication:**
- `POST /auth/request-magic-link` - Request magic link
- `GET /auth/verify-magic-link?token=` - Verify and create session
- `GET /auth/me` - Get current user
- `POST /auth/logout` - Invalidate session

**Inventory:**
- `GET /locations?user=` - List locations
- `GET /collections?user=&location=` - List collections
- `GET /items?user=&collection=` - List items
- `GET /items/single?user=&item=` - Get item details
- `POST /items/post` - Create item

See `Services/InventoryService.swift` for complete API.

---

## 🎨 UI Components

### Reusable Views
- `EmptyStateView` - No data placeholder
- `LocationRow` - Location list item
- `CollectionRow` - Collection list item
- `ItemRow` - Item list item with thumbnail
- `DetailRow` - Key-value pair display
- `FlowLayout` - Tag layout (custom Layout protocol)

### SwiftUI Features Used
- NavigationView/NavigationLink for navigation
- List with pull-to-refresh
- AsyncImage for remote images
- Forms for data entry
- Sheets for modals
- Task for async loading
- Toolbar for navigation buttons

---

## 🧪 Testing

### Manual Testing Checklist

**Authentication:**
- [x] Login screen appears
- [x] Can enter email
- [x] Magic link sent confirmation
- [ ] Token verification works (in progress - see Current Status)
- [ ] Deep link opens app
- [ ] User session persists on restart
- [ ] Logout clears session

**Inventory Browsing:**
- [ ] Locations load correctly
- [ ] Can navigate to collections
- [ ] Collections show item counts
- [ ] Can navigate to items
- [ ] Items display correctly
- [ ] Images load and display
- [ ] Pull-to-refresh works

**Item Creation:**
- [ ] Add item button works
- [ ] Form validates input
- [ ] Can save new item
- [ ] Item appears in list
- [ ] Can cancel without saving

### Testing in Simulator

```bash
# Build
xcodebuild -project MoveTrack.xcodeproj -scheme MoveTrack -destination 'platform=iOS Simulator,name=iPhone 15 Pro'

# Run tests (when added)
xcodebuild test -project MoveTrack.xcodeproj -scheme MoveTrack -destination 'platform=iOS Simulator,name=iPhone 15 Pro'
```

---

## 🐛 Troubleshooting

### Common Build Errors

**"Cannot find 'Constants' in scope"**
```
Fix: Ensure Constants.swift is added to target
→ File → Target Membership → Check MoveTrack
```

**"No such module 'SwiftUI'"**
```
Fix: Set deployment target
→ Project Settings → iOS Deployment Target → 15.0
```

**Signing errors**
```
Fix: Add Apple ID
→ Xcode → Preferences → Accounts → Add +
→ Project Settings → Signing → Select Team
```

### Common Runtime Errors

**Network errors / "Invalid URL"**
```
Fix: Ensure API is running and use 127.0.0.1 not localhost
→ Constants.swift: apiBaseURL = "http://127.0.0.1:3050" (NOT localhost)
→ Info.plist: NSAllowsLocalNetworking = true + NSExceptionDomains for localhost
→ iOS simulator requires 127.0.0.1 to reach host machine
```

**"Failed to decode response: The data couldn't be read because it is missing"**
```
This was the main bug we fixed. Cause was a CodingKeys mismatch:
- The APIClient uses .convertFromSnakeCase decoder strategy
- This auto-converts user_id → userId, first_name → firstName, etc.
- CodingKeys must map to the CONVERTED camelCase names, not original snake_case
- Example: case id = "userId" (NOT "user_id")
```

**"Unauthorized" after login**
```
Fix: Token may be expired
→ Request new magic link
→ Check Keychain has saved token
```

**Deep linking not working**
```
Fix: Verify URL scheme
→ Project → Target → Info → URL Types
→ Should have: movetrack
→ Test with: xcrun simctl openurl booted "movetrack://login?token=..."
```

---

## 📝 Code Style

### Naming Conventions
- **Files:** PascalCase (e.g., `LocationsListView.swift`)
- **Types:** PascalCase (e.g., `struct Location`)
- **Variables:** camelCase (e.g., `var isLoading`)
- **Constants:** camelCase or UPPER_CASE for static
- **Private:** prefix with `private`

### SwiftUI Conventions
- **Views:** Suffix with `View` (e.g., `LoginView`)
- **ViewModels:** Suffix with `ViewModel`
- **Services:** Suffix with `Service`
- **State:** Use `@State`, `@StateObject`, `@ObservedObject`, `@EnvironmentObject` appropriately

### Comments
- **MARK:** for section headers
- **TODO:** for future work
- DocStrings for public APIs

---

## 🔮 Future Enhancements

### Phase 1 (Camera & Photos)
- [ ] Camera integration with AVFoundation
- [ ] Photo gallery picker
- [ ] Image compression before upload
- [ ] Cropping and editing
- [ ] Multiple photo support

### Phase 2 (QR Codes)
- [ ] QR code generation with Core Image
- [ ] QR code display and sharing
- [ ] QR code scanning with AVFoundation
- [ ] Link QR to items/containers

### Phase 3 (Offline Mode)
- [ ] Core Data integration
- [ ] Sync queue for offline changes
- [ ] Conflict resolution
- [ ] Network status monitoring
- [ ] Background sync

### Phase 4 (Move Features)
- [ ] Create move projects
- [ ] Route planning with MapKit
- [ ] Waypoint management
- [ ] Move day tracking
- [ ] Box loading/unloading
- [ ] Damage reporting

### Phase 5 (Polish)
- [ ] Search functionality
- [ ] Filters and sorting
- [ ] Settings screen
- [ ] Dark mode support
- [ ] Accessibility improvements
- [ ] iPad optimization
- [ ] Widgets
- [ ] Apple Watch app

---

## 📊 Performance

### Optimization Strategies
- AsyncImage for lazy image loading
- List virtualization (automatic in SwiftUI)
- Task cancellation on view disappear
- Image caching (via URLCache)
- Pagination for large datasets (TODO)

### Memory Management
- ViewModels deallocated when views dismissed
- Images cached but evicted under memory pressure
- No retain cycles (using `[weak self]` where needed)

---

## 🤝 Contributing

### Adding New Features

1. **Create Model** (if needed)
   - Add to `Models/` folder
   - Conform to `Codable`, `Identifiable`

2. **Add API Methods**
   - Update `Services/` files
   - Use `APIClient.shared` for requests

3. **Create ViewModel**
   - Add to `ViewModels/` folder
   - Subclass `ObservableObject`
   - Use `@Published` for state

4. **Build View**
   - Add to appropriate `Views/` folder
   - Use SwiftUI best practices
   - Add loading/error states

5. **Test Thoroughly**
   - Simulator testing
   - Device testing
   - Edge cases (no data, errors, etc.)

---

## 📄 License

Proprietary - MoveTrack / ReloPrep
© 2025 All Rights Reserved

---

## 📞 Support

- **Issues:** Create GitHub issue
- **Questions:** Contact development team
- **Documentation:** See SETUP.md and QUICKSTART.md

---

**Status:** 🔧 Login debugging in progress
**Last Updated:** February 2026
**Version:** 1.0.0 (MVP)
