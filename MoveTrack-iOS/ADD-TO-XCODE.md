# Add MoveTrack Files to Xcode Project

## Quick Method (Drag & Drop)

### 1. Open Xcode
```bash
open -a Xcode
# Create New Project → iOS → App
# Name: MoveTrack
# Interface: SwiftUI
# Language: Swift
# Save to: /Users/owenwilliams/Projects/widowmaker/MoveTrack-iOS/
```

### 2. Delete Default Files
In Xcode project navigator:
- Delete `ContentView.swift` (we have our own)
- Keep `MoveTrackApp.swift` (we'll replace it)

### 3. Add All Files at Once

**Option A: Drag the Entire MoveTrack Folder**
1. In Finder, navigate to `/Users/owenwilliams/Projects/widowmaker/MoveTrack-iOS/`
2. Drag the `MoveTrack` folder into Xcode's project navigator
3. In the dialog:
   - ✅ Check "Copy items if needed"
   - ✅ Select "Create groups"
   - ✅ Add to target: MoveTrack
4. Click "Finish"

**Option B: Add Files Manually**
If drag & drop doesn't work, add each folder:

1. Right-click on `MoveTrack` in Xcode navigator
2. Select "Add Files to MoveTrack..."
3. Navigate to each folder and add:
   - Add `Models` folder (5 files)
   - Add `Services` folder (4 files)
   - Add `ViewModels` folder (4 files)
   - Add `Views` folder with subfolders (7 files)
   - Add `Utils` folder (1 file)
   - Add `MoveTrackApp.swift` (replace existing)
   - Add `ContentView.swift`

### 4. Verify Files Added
In Xcode, you should see this structure:

```
MoveTrack/
├── MoveTrackApp.swift
├── ContentView.swift
├── Models/
│   ├── User.swift
│   ├── Location.swift
│   ├── Collection.swift
│   ├── Container.swift
│   └── Item.swift
├── Services/
│   ├── KeychainService.swift
│   ├── APIClient.swift
│   ├── AuthService.swift
│   └── InventoryService.swift
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
│   │   └── LocationsListView.swift
│   ├── Collections/
│   │   └── CollectionsListView.swift
│   └── Items/
│       ├── ItemsListView.swift
│       ├── ItemDetailView.swift
│       └── AddItemView.swift
└── Utils/
    └── Constants.swift
```

### 5. Configure Info.plist

**Option A: Edit as Source Code**
1. Find `Info.plist` in Xcode
2. Right-click → Open As → Source Code
3. Add before `</dict>`:

```xml
<key>NSCameraUsageDescription</key>
<string>We need camera access to photograph items for your inventory.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>We need access to your photo library to select photos for your items.</string>

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

**Option B: Edit as Property List**
1. Open Info.plist
2. Right-click → Add Row
3. Add these keys:
   - Privacy - Camera Usage Description: "We need camera access to photograph items for your inventory."
   - Privacy - Photo Library Usage Description: "We need access to your photo library to select photos for your items."

### 6. Configure URL Scheme

1. Click on project (blue MoveTrack icon) in navigator
2. Select MoveTrack target (under TARGETS)
3. Go to "Info" tab
4. Scroll to "URL Types"
5. Click "+" button
6. Enter:
   - Identifier: `com.movetrack.MoveTrack`
   - URL Schemes: `movetrack`
   - Role: `Editor`

### 7. Build Project

Press `⌘B` to build

**If you get errors:**
- "No such module": Clean build folder (`⌘⇧K`) then rebuild
- Missing files: Check all files are checked in Target Membership
- Signing errors: Add your Apple ID in Xcode → Preferences → Accounts

### 8. Run in Simulator

1. Select simulator: iPhone 15 Pro
2. Press `⌘R` to run
3. App should launch!

---

## Troubleshooting

### Files Not Showing in Xcode
**Fix:**
1. Right-click file in Finder
2. Select "Show in Enclosing Folder"
3. Drag file into Xcode
4. Check "Copy items if needed"

### Build Errors
**"Cannot find 'X' in scope"**
- Right-click file → Show File Inspector
- Check "Target Membership" → MoveTrack is checked

**Deployment Target Error**
- Project Settings → Deployment Info → iOS 15.0+

### Files in Wrong Location
**Fix:**
- In Xcode, drag files to correct folder
- Files will update in file system too

---

## Quick Commands

```bash
# Open Xcode
open -a Xcode

# Build from command line
xcodebuild -project MoveTrack.xcodeproj -scheme MoveTrack -destination 'platform=iOS Simulator,name=iPhone 15 Pro' build

# Run tests (when added)
xcodebuild test -project MoveTrack.xcodeproj -scheme MoveTrack -destination 'platform=iOS Simulator,name=iPhone 15 Pro'
```

---

## Next Steps

1. ✅ Files added to Xcode
2. ✅ Info.plist configured
3. ✅ URL scheme set up
4. ✅ Build succeeds
5. ⏭️ Run app in simulator
6. ⏭️ Test authentication with magic link

See [QUICKSTART.md](QUICKSTART.md) for full testing instructions!

---

**Last Updated:** December 26, 2025
