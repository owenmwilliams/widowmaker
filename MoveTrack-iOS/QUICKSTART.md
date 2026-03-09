# Nexus Moves iOS - Quick Start Guide

## Getting the App Running in Xcode

### Step 1: Create the Xcode Project (5 minutes)

1. **Open Xcode**
   ```bash
   open -a Xcode
   ```

2. **Create New Project**
   - Click "Create a new Xcode project"
   - Select: iOS → App
   - Click "Next"

3. **Configure Project**
   - Product Name: `MoveTrack`
   - Team: Select your Apple ID
   - Organization Identifier: `com.movetrack`
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Click "Next"

4. **Save Location**
   - Navigate to: `/Users/owenwilliams/Projects/widowmaker/`
   - Create folder: `MoveTrack-iOS`
   - Save project there

### Step 2: Add Swift Files (10 minutes)

1. **Delete Default Files**
   - Delete `ContentView.swift` (we'll replace it)

2. **Create Folder Structure**
   In Xcode, right-click on `MoveTrack` folder and create these groups:
   - Models
   - Services
   - ViewModels
   - Views
     - Auth
     - Locations
     - Collections
     - Items
   - Utils

3. **Add Files to Each Group**

   For each Swift file I created, do this:
   - Right-click on the appropriate folder
   - Select "Add Files to Nexus Moves..."
   - Navigate to the file
   - Check "Copy items if needed"
   - Click "Add"

   **Files to add:**
   ```
   Models/
     - User.swift
     - Location.swift
     - Collection.swift
     - Container.swift
     - Item.swift

   Services/
     - KeychainService.swift
     - APIClient.swift
     - AuthService.swift
     - InventoryService.swift

   ViewModels/
     - AuthViewModel.swift
     - LocationsViewModel.swift
     - CollectionsViewModel.swift
     - ItemsViewModel.swift

   Views/Auth/
     - LoginView.swift
     - MagicLinkSentView.swift

   Views/Locations/
     - LocationsListView.swift

   Views/Collections/
     - CollectionsListView.swift

   Views/Items/
     - ItemsListView.swift
     - ItemDetailView.swift
     - AddItemView.swift

   Utils/
     - Constants.swift

   Root Level:
     - MoveTrackApp.swift (replace existing)
     - ContentView.swift (replace existing)
   ```

### Step 3: Configure Info.plist (2 minutes)

1. **Open Info.plist**
   - In Xcode, find `Info.plist` in the project navigator
   - Right-click → Open As → Source Code

2. **Add These Keys**
   Add before the closing `</dict>`:
   ```xml
   <key>NSCameraUsageDescription</key>
   <string>We need access to your camera to photograph items for your inventory.</string>

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

### Step 4: Configure URL Scheme (2 minutes)

1. **Select Project in Navigator**
   - Click on the blue `MoveTrack` project file at the top

2. **Select Target**
   - Click on `MoveTrack` under "TARGETS"

3. **Go to Info Tab**
   - Scroll down to "URL Types"
   - Click the "+" button

4. **Add URL Scheme**
   - Identifier: `com.movetrack.MoveTrack`
   - URL Schemes: `movetrack`
   - Role: `Editor`

### Step 5: Start the API Server (2 minutes)

```bash
# In a new terminal
cd /Users/owenwilliams/Projects/widowmaker/movetrack-api
npm install  # if not already done
npm start
```

You should see:
```
MoveTrack API Server listening on port 3050
```

### Step 6: Build and Run (1 minute)

1. **Select Simulator**
   - At the top of Xcode, click the device selector
   - Choose: "iPhone 15 Pro" (or any iPhone simulator)

2. **Build and Run**
   - Press `⌘R` or click the Play button
   - Wait for build to complete (~30 seconds first time)

3. **App Should Launch!**

---

## Testing the App

### Test 1: Authentication

1. **Open Login Screen**
   - You should see the Nexus Moves logo and email input

2. **Enter Your Email**
   ```
   your-email@example.com
   ```

3. **Send Magic Link**
   - Click "Send Magic Link"
   - Check the API console logs for the magic link URL

4. **Extract Token from Logs**
   Look for output like:
   ```
   ================================================================================
   MAGIC LINK
   ================================================================================
   Email: your-email@example.com
   Magic Link: http://localhost:5173/login?token=abc123def456...
   ```

5. **Test Deep Linking**
   In terminal, paste the token:
   ```bash
   xcrun simctl openurl booted "movetrack://login?token=PASTE_TOKEN_HERE"
   ```

6. **You Should Be Logged In!**
   - The app will automatically verify the token
   - You'll see the Locations list

### Test 2: Browse Inventory

If you have existing data:

1. **Locations List**
   - Should show all your locations
   - Each with item counts

2. **Tap a Location**
   - See collections (rooms)

3. **Tap a Collection**
   - See items in that room

4. **Tap an Item**
   - See full item details with photo

### Test 3: Add an Item

1. **Navigate to Items List**
   - Tap Location → Collection

2. **Tap "+" Button**
   - Add item form appears

3. **Fill Out Form**
   - Name: "Test Item"
   - Description: "Testing from iOS app"
   - Quantity: 1

4. **Tap "Save"**
   - Item should appear in list immediately

---

## Troubleshooting

### Build Errors

**Error: "No such module 'SwiftUI'"**
- Fix: Set deployment target to iOS 15.0+
- Project Settings → Deployment Info → iOS Deployment Target → 15.0

**Error: "Cannot find 'Constants' in scope"**
- Fix: Make sure `Utils/Constants.swift` is added to the project
- Right-click file → Target Membership → Check `MoveTrack`

**Error: Signing issues**
- Fix: Xcode → Preferences → Accounts → Add your Apple ID
- Select your team in project settings

### Runtime Errors

**Error: "Invalid URL"**
- Fix: Make sure API is running on port 3050
- Check `Constants.swift` has correct URL

**Error: Network errors**
- Fix: Check Info.plist has `NSAllowsLocalNetworking = true`
- Make sure API is running: `cd movetrack-api && npm start`

**Error: "Unauthorized"**
- Fix: Token expired or invalid
- Request a new magic link

### Deep Linking Not Working

**Magic link doesn't open app**
- Fix: Make sure URL scheme is configured
- Use the `xcrun simctl openurl` command
- Format: `movetrack://login?token=...` (not https://)

**Token verification fails**
- Fix: Copy the full token from API logs
- Don't truncate or add extra characters
- Token should be ~64 characters

---

## Next Steps

Once the app is running:

### Immediate Improvements

1. **Add Camera Support**
   - Implement photo capture in `AddItemView`
   - Upload images to Google Cloud Storage

2. **Implement QR Code Generation**
   - Add QR code view for containers
   - Use Core Image to generate QR codes

3. **Add Offline Support**
   - Integrate Core Data
   - Sync data when online

### Future Features

1. **Search**
   - Add search bar to items list
   - Filter by name, description, tags

2. **Settings**
   - User profile
   - App preferences
   - About screen

3. **Move Planning**
   - Implement move creation
   - Route planning with MapKit
   - Move day tracking

---

## Development Tips

### Xcode Shortcuts

- **Build:** `⌘B`
- **Run:** `⌘R`
- **Stop:** `⌘.`
- **Clean Build:** `⌘⇧K`
- **Open Quickly:** `⌘⇧O`

### Debugging

- **Print Statements:** Already added throughout the code
- **Breakpoints:** Click line number to add breakpoint
- **Debug Console:** View → Debug Area → Show Debug Area

### Testing on Device

1. Connect your iPhone via USB
2. Select it from device menu
3. Trust computer on phone
4. Build and run (`⌘R`)

For production testing, you'll need:
- Paid Apple Developer Account ($99/year)
- Proper signing certificates
- App Store Connect setup

---

## Success Criteria

✅ App builds without errors
✅ App launches in simulator
✅ Login screen appears
✅ Can request magic link
✅ Can verify magic link via deep link
✅ Can browse locations
✅ Can view collections
✅ Can view items
✅ Can add new item

**You're Ready to Test!** 🎉

---

## Support

If you encounter issues:

1. Check build errors in Xcode
2. Check API console for errors
3. Review SETUP.md for detailed configuration
4. Check that all files are added to the project

**Common Issues:**
- API not running → Start with `npm start`
- Wrong URL → Check `Constants.swift`
- Signing errors → Add Apple ID in Xcode preferences
- Deep linking not working → Verify URL scheme configuration

---

**Last Updated:** December 26, 2025
**Tested On:** Xcode 15.1, iOS 17.2
