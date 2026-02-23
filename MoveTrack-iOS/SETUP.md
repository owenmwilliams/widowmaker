# MoveTrack iOS - Native Swift Application
## Setup Instructions

**Created:** December 26, 2025
**Target:** iOS 15.0+
**Language:** Swift 5.9+
**UI Framework:** SwiftUI

---

## 1. Create Xcode Project

### Step 1: Open Xcode
1. Open Xcode (version 15.0 or later recommended)
2. Click "Create a new Xcode project"

### Step 2: Configure Project
- **Template:** iOS → App
- **Product Name:** `MoveTrack`
- **Team:** Select your Apple Developer account
- **Organization Identifier:** `com.movetrack` (or your preference)
- **Bundle Identifier:** Will be `com.movetrack.MoveTrack`
- **Interface:** SwiftUI
- **Language:** Swift
- **Storage:** None (we'll use UserDefaults and Keychain)
- **Include Tests:** Yes

### Step 3: Project Location
- Save to: `/Users/owenwilliams/Projects/widowmaker/MoveTrack-iOS/`

---

## 2. Add Swift Files to Project

After creating the project, add the following files to your project:

### File Structure
```
MoveTrack/
├── App/
│   └── MoveTrackApp.swift (already created by Xcode)
├── Models/
│   ├── User.swift
│   ├── Location.swift
│   ├── Collection.swift
│   ├── Container.swift
│   └── Item.swift
├── Services/
│   ├── APIClient.swift
│   ├── AuthService.swift
│   ├── InventoryService.swift
│   └── KeychainService.swift
├── ViewModels/
│   ├── AuthViewModel.swift
│   ├── LocationsViewModel.swift
│   ├── CollectionsViewModel.swift
│   └── ItemsViewModel.swift
├── Views/
│   ├── Auth/
│   │   ├── LoginView.swift
│   │   └── MagicLinkSentView.swift
│   ├── Locations/
│   │   ├── LocationsListView.swift
│   │   └── LocationDetailView.swift
│   ├── Collections/
│   │   ├── CollectionsListView.swift
│   │   └── CollectionDetailView.swift
│   ├── Items/
│   │   ├── ItemsListView.swift
│   │   ├── ItemDetailView.swift
│   │   └── AddItemView.swift
│   └── Camera/
│       └── CameraView.swift
├── Utils/
│   └── Constants.swift
└── ContentView.swift
```

### How to Add Files:
1. Right-click on the `MoveTrack` folder in Xcode
2. Select "New File..."
3. Choose "Swift File"
4. Name it according to the structure above
5. Copy the code from the Swift files I've created

---

## 3. Configure Info.plist

Add the following keys to `Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>We need access to your camera to photograph items for your inventory.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>We need access to your photo library to select photos for your items.</string>

<key>NSPhotoLibraryAddUsageDescription</key>
<string>We need permission to save photos to your library.</string>
```

---

## 4. Configure App Transport Security (for local development)

Add to `Info.plist` for local API testing:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
    <key>NSExceptionDomains</key>
    <dict>
        <key>localhost</key>
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <true/>
        </dict>
    </dict>
</dict>
```

**IMPORTANT:** Remove this for production builds!

---

## 5. Update API Base URL

In `Utils/Constants.swift`, update the API URL:

```swift
// For local development
static let apiBaseURL = "http://localhost:3050"

// For production
static let apiBaseURL = "https://movetrack-api-7hwn7ggbiq-uc.a.run.app"
```

---

## 6. Build and Run

1. Select a simulator (iPhone 15 Pro recommended)
2. Press ⌘R to build and run
3. The app should launch in the simulator

---

## 7. Testing Authentication

1. Enter your email in the login screen
2. Check the API console logs for the magic link
3. The link will be in format: `movetrack://login?token=...`
4. To test deep linking in simulator:
   ```bash
   xcrun simctl openurl booted "movetrack://login?token=YOUR_TOKEN_HERE"
   ```

---

## 8. Configure URL Scheme (Deep Linking)

1. In Xcode, select your project in the navigator
2. Select the `MoveTrack` target
3. Go to the "Info" tab
4. Expand "URL Types"
5. Click "+" to add a URL type
6. Configure:
   - **Identifier:** `com.movetrack.MoveTrack`
   - **URL Schemes:** `movetrack`
   - **Role:** Editor

---

## 9. Dependencies (Optional - for future)

If you want to add Swift Package Manager dependencies later:

1. File → Add Packages...
2. Search for packages:
   - **Kingfisher:** Image loading and caching
   - **CodeScanner:** QR code scanning (or use AVFoundation directly)

For now, we're using native iOS frameworks only.

---

## 10. Running on Physical Device

To test on your iPhone:

1. Connect your iPhone via USB
2. Trust the computer on your iPhone
3. In Xcode, select your device from the scheme selector
4. You may need to:
   - Sign in with your Apple ID in Xcode preferences
   - Select your team in the Signing & Capabilities tab
   - Trust your developer certificate on your iPhone (Settings → General → VPN & Device Management)

---

## Troubleshooting

### Build Errors
- **"No such module 'SwiftUI'"** - Make sure deployment target is iOS 13.0+
- **Keychain errors** - Run on simulator first, keychain access is easier there
- **Network errors** - Check that the API is running (`cd movetrack-api && npm start`)

### Deep Linking Not Working
- Make sure URL scheme is configured correctly
- Use the `xcrun simctl openurl` command for testing
- Check `MoveTrackApp.swift` has the `.onOpenURL` handler

### Camera Not Working
- Camera doesn't work in simulator - must use physical device
- Or use "Choose from Library" option instead

---

## Next Steps

After getting the app running:

1. Test authentication flow
2. Browse existing inventory
3. Add camera integration
4. Implement QR code generation
5. Add offline support with Core Data
6. Implement move planning features

---

**Project Status:** Initial Setup Complete ✅
**Ready for Testing:** Yes
**Estimated Setup Time:** 30 minutes
