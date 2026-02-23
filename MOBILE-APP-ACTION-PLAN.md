# MoveTrack Native Mobile App Development Plan
## Comprehensive iOS and Android Implementation Roadmap

**Created:** December 26, 2025
**Last Updated:** December 26, 2025
**Status:** Planning Phase

---

## Overview

This document outlines the complete plan for developing native iOS and Android applications for MoveTrack. The current web application is built with Vue 3/Quasar (desktop) and Vant UI (mobile web), with basic Capacitor integration for mobile platforms.

**Current State:** Hybrid mobile app via Capacitor
**Target State:** Native iOS (Swift/SwiftUI) and Android (Kotlin/Jetpack Compose) applications
**Alternative Approach:** React Native for faster development with single codebase

**Current Mobile Grade:** C (Hybrid WebView)
**Target Mobile Grade:** A (True Native Experience)

---

## Technology Stack Decision

### Option 1: React Native (RECOMMENDED)

**Pros:**
- ✅ Single codebase for iOS and Android
- ✅ 60-70% code reuse across platforms
- ✅ Native performance for most use cases
- ✅ Huge ecosystem and mature libraries
- ✅ Faster development (3-4 months vs 6-8 months)
- ✅ Easier to hire developers (React skills)
- ✅ Excellent camera and QR code support
- ✅ Strong offline/sync capabilities

**Cons:**
- ❌ Not 100% native (some WebView components possible)
- ❌ Requires bridging for some native features
- ❌ Complete rewrite from Vue

**Estimated Development Time:** 4-6 months (MVP)
**Team Size:** 2 React Native developers + 1 backend + 1 QA

### Option 2: Native iOS + Native Android

**Pros:**
- ✅ Best possible performance
- ✅ 100% native experience
- ✅ Full access to platform features
- ✅ Best long-term maintainability

**Cons:**
- ❌ Two separate codebases
- ❌ Double development time
- ❌ Requires Swift AND Kotlin expertise
- ❌ Twice the maintenance effort

**Estimated Development Time:** 8-12 months (MVP)
**Team Size:** 1 iOS dev + 1 Android dev + 1 backend + 1 QA

### Option 3: Upgrade Capacitor (Fastest)

**Pros:**
- ✅ Reuse existing Vue components
- ✅ Fastest time to market (1-2 months)
- ✅ Minimal code changes
- ✅ Same skillset (Vue/TypeScript)

**Cons:**
- ❌ WebView performance limitations
- ❌ Not true native experience
- ❌ Plugin dependency for native features
- ❌ Harder to optimize

**Estimated Development Time:** 1-2 months (improvements)
**Team Size:** 1-2 frontend developers

### **DECISION: React Native**
Recommended for best balance of development speed, performance, and maintainability.

---

## 🔴 CRITICAL PRIORITY (Phase 1 - MVP - Months 1-4)

### ✅ 0. Project Setup and Architecture
**Status:** ⏳ NOT STARTED
**Estimated Time:** 2 weeks
**Priority:** CRITICAL - Foundation for all development
**Impact:** Enables all future development

**Implementation Steps:**

**0.1 Technology Stack Setup**
- [ ] Initialize React Native project: `npx react-native init MoveTrack --template react-native-template-typescript`
- [ ] Configure ESLint and Prettier
- [ ] Set up folder structure:
  ```
  src/
    api/          # API client
    components/   # Reusable UI components
    screens/      # Screen components
    navigation/   # React Navigation config
    store/        # Redux or Zustand state
    utils/        # Helper functions
    types/        # TypeScript types
    assets/       # Images, fonts
  ```

**0.2 Core Dependencies**
```json
{
  "dependencies": {
    "@react-navigation/native": "^6.1.9",
    "@react-navigation/native-stack": "^6.9.17",
    "@react-navigation/bottom-tabs": "^6.5.11",
    "react-native-vector-icons": "^10.0.3",
    "axios": "^1.6.2",
    "react-native-keychain": "^8.1.2",
    "react-native-sqlite-storage": "^6.0.1",
    "@react-native-async-storage/async-storage": "^1.21.0",
    "react-native-camera": "^4.2.1",
    "react-native-qrcode-svg": "^6.2.0",
    "react-native-image-picker": "^7.1.0",
    "react-native-image-resizer": "^3.0.7",
    "react-native-maps": "^1.10.0",
    "react-native-fast-image": "^8.6.3",
    "@reduxjs/toolkit": "^2.0.1",
    "react-redux": "^9.0.4"
  }
}
```

**0.3 iOS Configuration**
- [ ] Set bundle identifier: `com.movetrack.app` or `com.reloprep.app`
- [ ] Configure Info.plist permissions:
  - Camera: `NSCameraUsageDescription`
  - Photo library: `NSPhotoLibraryUsageDescription`
  - Location: `NSLocationWhenInUseUsageDescription`
- [ ] Add Google Maps API key to AppDelegate

**0.4 Android Configuration**
- [ ] Set package name: `com.movetrack.app` or `com.reloprep.app`
- [ ] Configure AndroidManifest.xml permissions:
  ```xml
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
  <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
  <uses-permission android:name="android.permission.INTERNET" />
  ```
- [ ] Add Google Maps API key to AndroidManifest.xml

**0.5 API Client Setup**
```typescript
// src/api/client.ts
import axios from 'axios';
import * as Keychain from 'react-native-keychain';

const API_BASE_URL = __DEV__
  ? 'http://localhost:3050'
  : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
apiClient.interceptors.request.use(async (config) => {
  const credentials = await Keychain.getGenericPassword();
  if (credentials) {
    config.headers.Authorization = `Bearer ${credentials.password}`;
  }
  return config;
});

// Handle 401 errors (logout)
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await Keychain.resetGenericPassword();
      // Navigate to login
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

**Testing:**
- [ ] iOS builds successfully
- [ ] Android builds successfully
- [ ] API client connects to backend
- [ ] Environment variables work in both dev and prod

---

### 1. Authentication Implementation
**Status:** ⏳ NOT STARTED
**Estimated Time:** 1 week
**Priority:** CRITICAL - Required for all authenticated features
**Impact:** Users can log in and access their data

**Implementation Steps:**

**1.1 Magic Link Request Screen**
```typescript
// src/screens/LoginScreen.tsx
import React, { useState } from 'react';
import { View, TextInput, Button, Alert } from 'react-native';
import apiClient from '../api/client';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const requestMagicLink = async () => {
    if (!email) return Alert.alert('Error', 'Please enter your email');

    setLoading(true);
    try {
      await apiClient.post('/auth/request-magic-link', { email });
      Alert.alert('Check Your Email',
        'We sent you a magic link. Click it to log in.');
      navigation.navigate('MagicLinkSent', { email });
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View>
      <TextInput
        placeholder="Enter your email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Button title="Send Magic Link" onPress={requestMagicLink} disabled={loading} />
    </View>
  );
}
```

**1.2 Deep Linking for Magic Link**
- [ ] Configure deep linking: `movetrack://login?token=...`
- [ ] iOS: Configure URL schemes in Info.plist
- [ ] Android: Configure intent filters in AndroidManifest.xml
- [ ] Handle incoming links with React Navigation

```typescript
// src/navigation/LinkingConfiguration.ts
const linking = {
  prefixes: ['movetrack://', 'https://movetrack.app', 'https://reloprep.com'],
  config: {
    screens: {
      Login: 'login',
    },
  },
};
```

**1.3 Token Verification and Storage**
```typescript
// src/api/auth.ts
import * as Keychain from 'react-native-keychain';
import apiClient from './client';

export async function verifyMagicLink(token: string) {
  try {
    const response = await apiClient.get(`/auth/verify-magic-link?token=${token}`);
    const { sessionToken, user } = response.data;

    // Store session token securely
    await Keychain.setGenericPassword('session_token', sessionToken);

    // Store user data
    await AsyncStorage.setItem('user_data', JSON.stringify(user));

    return { success: true, user };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function logout() {
  try {
    await apiClient.post('/auth/logout');
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    await Keychain.resetGenericPassword();
    await AsyncStorage.removeItem('user_data');
  }
}

export async function getCurrentUser() {
  try {
    const response = await apiClient.get('/auth/me');
    return response.data;
  } catch (error) {
    return null;
  }
}
```

**1.4 Auth State Management**
- [ ] Create auth context or Redux slice
- [ ] Persist auth state across app restarts
- [ ] Implement protected routes
- [ ] Show splash screen while checking auth

**Testing:**
- [ ] Request magic link sends email
- [ ] Deep link opens app correctly
- [ ] Token verification works
- [ ] Session persists after app restart
- [ ] Logout clears session
- [ ] 401 errors redirect to login

---

### 2. Inventory Browsing (Locations → Collections → Containers → Items)
**Status:** ⏳ NOT STARTED
**Estimated Time:** 3 weeks
**Priority:** CRITICAL - Core feature
**Impact:** Users can view their inventory

**Implementation Steps:**

**2.1 Data Models (TypeScript)**
```typescript
// src/types/inventory.ts
export interface Location {
  id: number;
  user_id: string;
  name: string;
  location_type: string;
  address?: string;
  city?: string;
  state?: string;
  lat?: number;
  lng?: number;
  item_count?: number;
  container_count?: number;
  collection_count?: number;
}

export interface Collection {
  id: number;
  user_id: string;
  location_id: number;
  name: string;
  description?: string;
  color_code?: string;
  icon?: string;
  item_count?: number;
  container_count?: number;
}

export interface Container {
  id: number;
  user_id: string;
  collection_id: number;
  name: string;
  box_number?: string;
  qr_code?: string;
  item_count?: number;
  sealed?: boolean;
}

export interface Item {
  id: number;
  user_id: string;
  collection_id: number;
  container_id?: number;
  name: string;
  description?: string;
  quantity?: number;
  picture_url?: string;
  estimated_value?: number;
  fragile?: boolean;
  tags?: string[];
}
```

**2.2 API Service Layer**
```typescript
// src/api/inventory.ts
import apiClient from './client';

export const inventoryApi = {
  getLocations: async (userId: string) => {
    const response = await apiClient.get(`/locations?user=${userId}`);
    return response.data;
  },

  getCollections: async (userId: string, locationId: number) => {
    const response = await apiClient.get(
      `/collections?user=${userId}&location=${locationId}`
    );
    return response.data;
  },

  getContainers: async (userId: string, collectionId: number) => {
    const response = await apiClient.get(
      `/containers?user=${userId}&collection=${collectionId}`
    );
    return response.data;
  },

  getItems: async (userId: string, params: {
    location?: number;
    collection?: number;
    container?: number;
  }) => {
    const queryString = new URLSearchParams({
      user: userId,
      ...params,
    }).toString();
    const response = await apiClient.get(`/items?${queryString}`);
    return response.data;
  },

  // Get complete inventory in one call
  getAllInventory: async (userId: string) => {
    const response = await apiClient.get(`/lists?user=${userId}`);
    return response.data;
  },
};
```

**2.3 Location List Screen**
```typescript
// src/screens/LocationsScreen.tsx
import React, { useEffect, useState } from 'react';
import { FlatList, View, Text, TouchableOpacity } from 'react-native';
import { inventoryApi } from '../api/inventory';

export default function LocationsScreen({ navigation }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLocations();
  }, []);

  const loadLocations = async () => {
    try {
      const data = await inventoryApi.getLocations(userId);
      setLocations(data);
    } catch (error) {
      Alert.alert('Error', 'Failed to load locations');
    } finally {
      setLoading(false);
    }
  };

  const renderLocation = ({ item }) => (
    <TouchableOpacity
      onPress={() => navigation.navigate('Collections', { locationId: item.id })}
    >
      <View>
        <Text>{item.name}</Text>
        <Text>{item.item_count} items in {item.collection_count} rooms</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <FlatList
      data={locations}
      renderItem={renderLocation}
      keyExtractor={(item) => item.id.toString()}
      refreshing={loading}
      onRefresh={loadLocations}
    />
  );
}
```

**2.4 Collections, Containers, Items Screens**
- [ ] Create CollectionsScreen (similar pattern)
- [ ] Create ContainersScreen (similar pattern)
- [ ] Create ItemsScreen with image thumbnails
- [ ] Create ItemDetailScreen with full image

**2.5 Navigation Structure**
```typescript
// src/navigation/AppNavigator.tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Locations" component={LocationsScreen} />
      <Stack.Screen name="Collections" component={CollectionsScreen} />
      <Stack.Screen name="Containers" component={ContainersScreen} />
      <Stack.Screen name="Items" component={ItemsScreen} />
      <Stack.Screen name="ItemDetail" component={ItemDetailScreen} />
    </Stack.Navigator>
  );
}
```

**Testing:**
- [ ] Locations load and display correctly
- [ ] Navigation between screens works
- [ ] Pull-to-refresh updates data
- [ ] Item counts are accurate
- [ ] Images load efficiently
- [ ] Empty states display properly

---

### 3. Camera Integration and Photo Upload
**Status:** ⏳ NOT STARTED
**Estimated Time:** 2 weeks
**Priority:** CRITICAL - Key mobile feature
**Impact:** Users can photograph items

**Implementation Steps:**

**3.1 Camera Component**
```typescript
// src/components/CameraCapture.tsx
import React, { useState } from 'react';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import ImageResizer from 'react-native-image-resizer';

interface Props {
  onPhotoTaken: (uri: string) => void;
}

export default function CameraCapture({ onPhotoTaken }: Props) {
  const openCamera = async () => {
    const result = await launchCamera({
      mediaType: 'photo',
      quality: 0.8,
      saveToPhotos: false,
    });

    if (result.assets?.[0]) {
      const compressed = await compressImage(result.assets[0].uri);
      onPhotoTaken(compressed);
    }
  };

  const openGallery = async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
    });

    if (result.assets?.[0]) {
      const compressed = await compressImage(result.assets[0].uri);
      onPhotoTaken(compressed);
    }
  };

  const compressImage = async (uri: string) => {
    const resized = await ImageResizer.createResizedImage(
      uri,
      800,  // max width
      800,  // max height
      'JPEG',
      80,   // quality
      0,    // rotation
    );
    return resized.uri;
  };

  return (
    <View>
      <Button title="Take Photo" onPress={openCamera} />
      <Button title="Choose from Gallery" onPress={openGallery} />
    </View>
  );
}
```

**3.2 Image Upload Service**
```typescript
// src/api/images.ts
import apiClient from './client';
import RNFS from 'react-native-fs';

export async function uploadImage(uri: string): Promise<string> {
  try {
    // Read file as base64
    const base64 = await RNFS.readFile(uri, 'base64');

    // Upload to server
    const response = await apiClient.post('/file/upload', {
      image: `data:image/jpeg;base64,${base64}`,
    });

    return response.data.url;
  } catch (error) {
    throw new Error('Image upload failed');
  }
}

export async function deleteImage(url: string): Promise<void> {
  await apiClient.delete(`/file/delete?file=${encodeURIComponent(url)}`);
}
```

**3.3 Integration with Item Creation**
```typescript
// src/screens/AddItemScreen.tsx
import React, { useState } from 'react';
import CameraCapture from '../components/CameraCapture';
import { uploadImage } from '../api/images';

export default function AddItemScreen() {
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const handlePhotoTaken = async (uri: string) => {
    setPhotoUri(uri);
    setUploading(true);

    try {
      const uploadedUrl = await uploadImage(uri);
      // Save URL to item
      setItemData({ ...itemData, picture_url: uploadedUrl });
    } catch (error) {
      Alert.alert('Upload Failed', error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <View>
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={{ width: 200, height: 200 }} />
      ) : (
        <CameraCapture onPhotoTaken={handlePhotoTaken} />
      )}
      {uploading && <ActivityIndicator />}
    </View>
  );
}
```

**3.4 Permission Handling**
```typescript
// src/utils/permissions.ts
import { PermissionsAndroid, Platform } from 'react-native';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';

export async function requestCameraPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } else {
    const result = await request(PERMISSIONS.IOS.CAMERA);
    return result === RESULTS.GRANTED;
  }
}
```

**Testing:**
- [ ] Camera opens correctly
- [ ] Gallery picker works
- [ ] Images compress to <2MB
- [ ] Upload completes successfully
- [ ] Progress indicator shows during upload
- [ ] Permissions requested appropriately
- [ ] Works on both iOS and Android

---

### 4. Item Creation and Editing
**Status:** ⏳ NOT STARTED
**Estimated Time:** 2 weeks
**Priority:** CRITICAL - Core functionality
**Impact:** Users can add and edit items

**Implementation Steps:**

**4.1 Add Item Screen**
```typescript
// src/screens/AddItemScreen.tsx
import React, { useState } from 'react';
import { ScrollView, TextInput, Button, Picker } from 'react-native';
import apiClient from '../api/client';

export default function AddItemScreen({ route, navigation }) {
  const { collectionId, containerId } = route.params;

  const [itemData, setItemData] = useState({
    name: '',
    description: '',
    collection_id: collectionId,
    container_id: containerId || null,
    quantity: 1,
    picture_url: null,
    estimated_value: null,
    fragile: false,
  });

  const createItem = async () => {
    try {
      const response = await apiClient.post('/items/post', itemData);
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', 'Failed to create item');
    }
  };

  return (
    <ScrollView>
      <TextInput
        placeholder="Item name"
        value={itemData.name}
        onChangeText={(name) => setItemData({ ...itemData, name })}
      />
      <TextInput
        placeholder="Description"
        value={itemData.description}
        onChangeText={(description) => setItemData({ ...itemData, description })}
        multiline
      />
      <TextInput
        placeholder="Quantity"
        value={itemData.quantity?.toString()}
        onChangeText={(quantity) => setItemData({ ...itemData, quantity: parseInt(quantity) })}
        keyboardType="numeric"
      />
      <TextInput
        placeholder="Estimated value ($)"
        value={itemData.estimated_value?.toString()}
        onChangeText={(value) => setItemData({ ...itemData, estimated_value: parseFloat(value) })}
        keyboardType="decimal-pad"
      />
      <Switch
        value={itemData.fragile}
        onValueChange={(fragile) => setItemData({ ...itemData, fragile })}
      />
      <Text>Fragile</Text>

      <CameraCapture onPhotoTaken={(url) => setItemData({ ...itemData, picture_url: url })} />

      <Button title="Create Item" onPress={createItem} />
    </ScrollView>
  );
}
```

**4.2 Edit Item Screen**
- [ ] Load existing item data
- [ ] Allow updating all fields
- [ ] Handle image replacement
- [ ] Delete old image when replacing

**4.3 AI Vision Integration (Optional for MVP)**
```typescript
// src/api/vision.ts
export async function analyzeItemPhoto(imageUrl: string): Promise<{
  name: string;
  description: string;
  material?: string;
  primary_color?: string;
  tags?: string[];
}> {
  const response = await apiClient.post('/vision/analyze-item', {
    image: imageUrl,
  });
  return response.data;
}
```

**Testing:**
- [ ] Can create item with all fields
- [ ] Can edit existing item
- [ ] Photo upload works
- [ ] AI analysis works (if implemented)
- [ ] Validation errors display correctly
- [ ] Item appears in list immediately after creation

---

### 5. QR Code Generation and Display
**Status:** ⏳ NOT STARTED
**Estimated Time:** 1 week
**Priority:** HIGH - Important for move day
**Impact:** Users can generate QR codes for boxes

**Implementation Steps:**

**5.1 QR Code Generation**
```typescript
// src/components/QRCodeDisplay.tsx
import React, { useEffect, useState } from 'react';
import QRCode from 'react-native-qrcode-svg';
import apiClient from '../api/client';

interface Props {
  containerId?: number;
  itemId?: number;
}

export default function QRCodeDisplay({ containerId, itemId }: Props) {
  const [qrData, setQrData] = useState<{ token: string; url: string } | null>(null);

  useEffect(() => {
    generateQR();
  }, [containerId, itemId]);

  const generateQR = async () => {
    try {
      const endpoint = containerId
        ? `/containers/${containerId}/qr`
        : `/items/${itemId}/qr`;

      const response = await apiClient.post(endpoint);
      setQrData(response.data);
    } catch (error) {
      Alert.alert('Error', 'Failed to generate QR code');
    }
  };

  if (!qrData) return <ActivityIndicator />;

  return (
    <View>
      <QRCode
        value={qrData.url}
        size={250}
        backgroundColor="white"
      />
      <Text>{qrData.token}</Text>
      <Button title="Share QR Code" onPress={() => {/* Share functionality */}} />
    </View>
  );
}
```

**5.2 QR Code in Item/Container Detail**
- [ ] Add "Show QR Code" button
- [ ] Display QR in modal or full screen
- [ ] Allow sharing/saving QR code image

**Testing:**
- [ ] QR code generates correctly
- [ ] QR code is scannable
- [ ] Token displays correctly
- [ ] Can share/save QR image

---

### 6. Offline Support (Read-Only)
**Status:** ⏳ NOT STARTED
**Estimated Time:** 2 weeks
**Priority:** HIGH - Essential for mobile
**Impact:** App works without internet

**Implementation Steps:**

**6.1 SQLite Database Setup**
```typescript
// src/database/schema.ts
import SQLite from 'react-native-sqlite-storage';

const db = SQLite.openDatabase({ name: 'movetrack.db' });

export async function initDatabase() {
  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY,
      user_id TEXT,
      name TEXT,
      location_type TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      lat REAL,
      lng REAL,
      data TEXT -- JSON blob for other fields
    );
  `);

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY,
      user_id TEXT,
      location_id INTEGER,
      name TEXT,
      description TEXT,
      color_code TEXT,
      icon TEXT,
      data TEXT
    );
  `);

  // Similar tables for containers, items, etc.
}
```

**6.2 Sync Service**
```typescript
// src/services/syncService.ts
import { inventoryApi } from '../api/inventory';
import { saveToDatabase, getFromDatabase } from '../database';

export async function syncInventory(userId: string) {
  try {
    // Fetch full inventory from API
    const inventory = await inventoryApi.getAllInventory(userId);

    // Save to local database
    await saveToDatabase('locations', inventory.locations);
    await saveToDatabase('collections', inventory.collections);
    await saveToDatabase('containers', inventory.containers);
    await saveToDatabase('items', inventory.items);

    // Update last sync timestamp
    await AsyncStorage.setItem('last_sync', new Date().toISOString());

    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
}

export async function getInventoryOffline(userId: string) {
  // Try to load from local database
  return {
    locations: await getFromDatabase('locations', { user_id: userId }),
    collections: await getFromDatabase('collections', { user_id: userId }),
    containers: await getFromDatabase('containers', { user_id: userId }),
    items: await getFromDatabase('items', { user_id: userId }),
  };
}
```

**6.3 Network Detection**
```typescript
// src/utils/network.ts
import NetInfo from '@react-native-community/netinfo';

export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected && state.isInternetReachable;
}

export function subscribeToNetworkChanges(callback: (isOnline: boolean) => void) {
  return NetInfo.addEventListener((state) => {
    callback(state.isConnected && state.isInternetReachable);
  });
}
```

**6.4 Data Loading Strategy**
```typescript
// src/api/inventory.ts (updated)
export const inventoryApi = {
  getLocations: async (userId: string) => {
    const online = await isOnline();

    if (online) {
      try {
        const response = await apiClient.get(`/locations?user=${userId}`);
        // Cache to database
        await saveToDatabase('locations', response.data);
        return response.data;
      } catch (error) {
        // Fall back to offline data
        return await getFromDatabase('locations', { user_id: userId });
      }
    } else {
      // Load from database
      return await getFromDatabase('locations', { user_id: userId });
    }
  },
  // Similar pattern for other methods
};
```

**Testing:**
- [ ] Data syncs on app start
- [ ] Data loads from cache when offline
- [ ] Network status indicator shows correctly
- [ ] Manual sync button works
- [ ] Last sync timestamp displays

---

## 🟠 HIGH PRIORITY (Phase 2 - Move Features - Months 5-7)

### 7. QR Code Scanning
**Status:** ⏳ NOT STARTED
**Estimated Time:** 1 week
**Priority:** HIGH - Essential for move day
**Impact:** Users can scan boxes during move

**Implementation Steps:**

**7.1 QR Scanner Component**
```typescript
// src/components/QRScanner.tsx
import React from 'react';
import { RNCamera } from 'react-native-camera';

interface Props {
  onScan: (data: string) => void;
}

export default function QRScanner({ onScan }: Props) {
  const handleBarCodeRead = ({ data }: { data: string }) => {
    // Parse QR code URL
    // Expected format: https://reloprep.com/qr/container/ct_xxxxx
    const match = data.match(/\/(container|item)\/([a-z0-9_]+)$/);
    if (match) {
      onScan(match[2]); // Return token
    }
  };

  return (
    <RNCamera
      style={{ flex: 1 }}
      onBarCodeRead={handleBarCodeRead}
      barCodeTypes={[RNCamera.Constants.BarCodeType.qr]}
    />
  );
}
```

**7.2 Scanner Screen**
```typescript
// src/screens/ScanQRScreen.tsx
export default function ScanQRScreen({ navigation }) {
  const handleScan = async (token: string) => {
    // Look up container or item by token
    const type = token.startsWith('ct_') ? 'container' : 'item';
    const id = await lookupByToken(token);

    if (id) {
      navigation.navigate(type === 'container' ? 'ContainerDetail' : 'ItemDetail', { id });
    } else {
      Alert.alert('Not Found', 'Could not find item with this QR code');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <QRScanner onScan={handleScan} />
      <Button title="Cancel" onPress={() => navigation.goBack()} />
    </View>
  );
}
```

**Testing:**
- [ ] Scanner opens camera
- [ ] QR codes are detected
- [ ] Correct item/container is loaded
- [ ] Invalid QR codes show error
- [ ] Camera permissions handled

---

### 8. Move Planning UI
**Status:** ⏳ NOT STARTED
**Estimated Time:** 3 weeks
**Priority:** HIGH - Key feature
**Impact:** Users can plan moves

**Implementation Steps:**

**8.1 Move List Screen**
- [ ] Display all saved moves
- [ ] Create new move button
- [ ] Show move details (origin, destination, date)
- [ ] Delete move option

**8.2 Create Move Screen**
```typescript
// src/screens/CreateMoveScreen.tsx
export default function CreateMoveScreen() {
  const [moveData, setMoveData] = useState({
    name: '',
    origin_location_id: null,
    destination_location_id: null,
    move_date: null,
  });

  const createMove = async () => {
    const response = await apiClient.post('/api/saved-moves', moveData);
    navigation.navigate('MoveDetail', { moveId: response.data.id });
  };

  return (
    <ScrollView>
      <TextInput placeholder="Move name" />
      <LocationPicker
        label="Origin"
        onSelect={(id) => setMoveData({ ...moveData, origin_location_id: id })}
      />
      <LocationPicker
        label="Destination"
        onSelect={(id) => setMoveData({ ...moveData, destination_location_id: id })}
      />
      <DatePicker
        value={moveData.move_date}
        onChange={(date) => setMoveData({ ...moveData, move_date: date })}
      />
      <Button title="Create Move" onPress={createMove} />
    </ScrollView>
  );
}
```

**8.3 Move Detail Screen**
- [ ] Show origin and destination
- [ ] Display route on map
- [ ] Show waypoints
- [ ] Edit move details
- [ ] Start move session button

**8.4 Google Maps Integration**
```typescript
// src/components/MoveMap.tsx
import MapView, { Marker, Polyline } from 'react-native-maps';

export default function MoveMap({ origin, destination, waypoints }) {
  return (
    <MapView
      style={{ flex: 1 }}
      initialRegion={{
        latitude: origin.lat,
        longitude: origin.lng,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5,
      }}
    >
      <Marker coordinate={origin} title="Origin" pinColor="green" />
      <Marker coordinate={destination} title="Destination" pinColor="red" />
      {waypoints.map((wp, idx) => (
        <Marker key={idx} coordinate={wp} title={`Stop ${idx + 1}`} />
      ))}
      <Polyline coordinates={[origin, ...waypoints, destination]} strokeWidth={3} />
    </MapView>
  );
}
```

**Testing:**
- [ ] Can create move
- [ ] Map displays correctly
- [ ] Route shows all waypoints
- [ ] Can edit move
- [ ] Can delete move

---

### 9. Move Day Session Tracking
**Status:** ⏳ NOT STARTED
**Estimated Time:** 2 weeks
**Priority:** HIGH - Critical for move day
**Impact:** Real-time move tracking

**Implementation Steps:**

**9.1 Move Session Screen**
```typescript
// src/screens/MoveSessionScreen.tsx
export default function MoveSessionScreen({ route }) {
  const { sessionId } = route.params;
  const [session, setSession] = useState(null);
  const [scans, setScans] = useState([]);

  const loadSession = async () => {
    const response = await apiClient.get(`/api/move-day/session/${sessionId}`);
    setSession(response.data);

    const scansResponse = await apiClient.get(`/api/move-day/session/${sessionId}/scans`);
    setScans(scansResponse.data);
  };

  const handleScan = async (token: string) => {
    // Record box scan
    await apiClient.post(`/api/move-day/session/${sessionId}/scan`, {
      container_token: token,
      scan_type: 'loaded',
      loading_zone: selectedZone,
    });

    // Reload scans
    await loadSession();
  };

  return (
    <View>
      <Text>{session?.session_name}</Text>
      <Text>Status: {session?.status}</Text>

      <Button title="Scan Box" onPress={() => navigation.navigate('ScanQR', { onScan: handleScan })} />

      <Text>Loaded: {scans.filter(s => s.scan_type === 'loaded').length} boxes</Text>

      <FlatList
        data={scans}
        renderItem={({ item }) => (
          <View>
            <Text>{item.container_name}</Text>
            <Text>{item.scan_type} - {item.scanned_at}</Text>
          </View>
        )}
      />
    </View>
  );
}
```

**9.2 Loading Zone Selector**
- [ ] Show truck zones (front, middle, rear)
- [ ] Allow selecting zone before scan
- [ ] Display boxes by zone

**9.3 Complete Session**
```typescript
const completeSession = async () => {
  await apiClient.post(`/api/move-day/session/${sessionId}/complete`);
  navigation.navigate('MoveCompleted', { sessionId });
};
```

**Testing:**
- [ ] Can scan boxes
- [ ] Scans are recorded
- [ ] Progress updates in real-time
- [ ] Zones work correctly
- [ ] Can complete session

---

### 10. Offline Write Operations (Sync Queue)
**Status:** ⏳ NOT STARTED
**Estimated Time:** 2 weeks
**Priority:** HIGH - Essential for move day offline
**Impact:** Can make changes without internet

**Implementation Steps:**

**10.1 Operation Queue**
```typescript
// src/database/operationQueue.ts
interface QueuedOperation {
  id: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: 'item' | 'container' | 'scan' | 'location';
  data: any;
  timestamp: string;
}

export async function queueOperation(operation: QueuedOperation) {
  const queue = await AsyncStorage.getItem('operation_queue');
  const operations = queue ? JSON.parse(queue) : [];
  operations.push(operation);
  await AsyncStorage.setItem('operation_queue', JSON.stringify(operations));
}

export async function processQueue() {
  const queue = await AsyncStorage.getItem('operation_queue');
  if (!queue) return;

  const operations: QueuedOperation[] = JSON.parse(queue);
  const failed: QueuedOperation[] = [];

  for (const op of operations) {
    try {
      await executeOperation(op);
    } catch (error) {
      failed.push(op);
    }
  }

  // Keep failed operations in queue
  await AsyncStorage.setItem('operation_queue', JSON.stringify(failed));
}

async function executeOperation(op: QueuedOperation) {
  switch (op.type) {
    case 'CREATE':
      await apiClient.post(`/${op.entity}s/post`, op.data);
      break;
    case 'UPDATE':
      await apiClient.put(`/${op.entity}s/update?${op.entity}_id=${op.data.id}`, op.data);
      break;
    case 'DELETE':
      await apiClient.delete(`/${op.entity}s/delete?${op.entity}_id=${op.data.id}`);
      break;
  }
}
```

**10.2 Optimistic Updates**
```typescript
// Example: Create item offline
export async function createItemOffline(itemData) {
  const tempId = `temp_${Date.now()}`;
  const item = { ...itemData, id: tempId };

  // Save to local database immediately
  await db.executeSql('INSERT INTO items VALUES (?)', [JSON.stringify(item)]);

  // Queue for sync
  await queueOperation({
    id: tempId,
    type: 'CREATE',
    entity: 'item',
    data: itemData,
    timestamp: new Date().toISOString(),
  });

  return item;
}
```

**10.3 Sync on Reconnect**
```typescript
// src/App.tsx
useEffect(() => {
  const unsubscribe = subscribeToNetworkChanges(async (isOnline) => {
    if (isOnline) {
      await processQueue();
      await syncInventory(userId);
    }
  });

  return unsubscribe;
}, []);
```

**Testing:**
- [ ] Can create items offline
- [ ] Changes sync when online
- [ ] Queue persists across app restarts
- [ ] Conflicts are handled
- [ ] Sync indicator shows status

---

## 🟡 MEDIUM PRIORITY (Phase 3 - Advanced Features - Months 8-10)

### 11. Push Notifications
**Status:** ⏳ NOT STARTED
**Estimated Time:** 1 week
**Priority:** MEDIUM
**Impact:** Move day reminders and alerts

**Use Cases:**
- Move day reminder (1 day before)
- Move starting soon (2 hours before)
- Crew member update
- Damage report filed

**Libraries:**
- `@react-native-firebase/messaging`
- `react-native-push-notification`

---

### 12. AI Vision Integration (Multi-Item Detection)
**Status:** ⏳ NOT STARTED
**Estimated Time:** 2 weeks
**Priority:** MEDIUM
**Impact:** Faster inventory creation

**Features:**
- Take photo of multiple items
- AI detects and creates separate items
- Review and edit detected items

---

### 13. Barcode Scanning (Product Recognition)
**Status:** ⏳ NOT STARTED
**Estimated Time:** 1 week
**Priority:** MEDIUM
**Impact:** Auto-fill item details

**Features:**
- Scan product barcode
- Look up product details from API
- Auto-populate name, description, image

---

### 14. Share Inventory
**Status:** ⏳ NOT STARTED
**Estimated Time:** 1 week
**Priority:** MEDIUM
**Impact:** Collaboration with movers/family

**Features:**
- Generate shareable link
- View-only access
- PDF export

---

### 15. Damage Reporting
**Status:** ⏳ NOT STARTED
**Estimated Time:** 1 week
**Priority:** MEDIUM
**Impact:** Track damage during move

**Features:**
- Report damaged item/box
- Take photo of damage
- Add notes
- Track in move timeline

---

## 🟢 NICE-TO-HAVE (Phase 4 - Future - Months 11+)

### 16. Apple Watch / Wear OS Support
**Status:** ⏳ NOT STARTED
**Estimated Time:** 3 weeks
**Priority:** LOW
**Impact:** Quick item lookup on wrist

---

### 17. Widgets (iOS 14+ / Android 12+)
**Status:** ⏳ NOT STARTED
**Estimated Time:** 1 week
**Priority:** LOW
**Impact:** Home screen quick access

---

### 18. AR Furniture Preview
**Status:** ⏳ NOT STARTED
**Estimated Time:** 4 weeks
**Priority:** LOW
**Impact:** Visualize items in new space

---

### 19. Siri / Google Assistant Shortcuts
**Status:** ⏳ NOT STARTED
**Estimated Time:** 1 week
**Priority:** LOW
**Impact:** Voice commands

---

### 20. Apple CarPlay / Android Auto
**Status:** ⏳ NOT STARTED
**Estimated Time:** 2 weeks
**Priority:** LOW
**Impact:** Move day navigation

---

## 📊 Progress Tracking

### Status Legend
- ✅ **COMPLETED** - Implemented and tested
- 🚧 **IN PROGRESS** - Currently being worked on
- ⏳ **NOT STARTED** - Planned but not started
- ❌ **BLOCKED** - Cannot proceed due to dependency

### Overall Progress
- **Critical Priority (Phase 1):** 0/6 completed (0%) - **MVP**
- **High Priority (Phase 2):** 0/4 completed (0%) - **Move Features**
- **Medium Priority (Phase 3):** 0/5 completed (0%) - **Advanced**
- **Nice-to-Have (Phase 4):** 0/5 completed (0%) - **Future**

**Total Progress:** 0/20 features completed (0%)

---

## 💰 Cost Estimation

### Development Costs

**Team (React Native Approach):**
- 2 React Native Developers: $80-120k each x 6 months = $80-120k total
- 1 Backend Developer (part-time): $40k x 3 months = $10k
- 1 QA Engineer: $60k x 4 months = $20k
- 1 UI/UX Designer: $70k x 2 months = $12k
- 1 Project Manager (part-time): $50k x 6 months = $25k

**Total Team Cost:** ~$147k - $187k

**Third-Party Services:**
- Apple Developer Program: $99/year
- Google Play Developer: $25 one-time
- Firebase (push notifications, analytics): $0-50/month
- Additional AI API usage: $200-500/month
- Google Cloud (increased traffic): +$50-100/month

**Total Annual Services:** ~$2,500 - $5,000

### Infrastructure Costs (Incremental)

**Additional Monthly Costs:**
- API bandwidth (mobile traffic): +$50-100/month
- Image storage (more uploads): +$20-40/month
- Database (more connections): +$30-50/month
- Push notification service: $0-50/month

**Total Additional Infrastructure:** +$100-240/month (~$1,200-$2,880/year)

### Total First Year Cost
**Development:** $147k - $187k
**Services & Infrastructure:** $3,700 - $7,880

**Grand Total:** ~$150k - $195k

---

## 📅 Timeline

### Phase 1: MVP (Months 1-4)
**Deliverables:**
- iOS and Android apps published to App Store / Play Store
- Authentication (magic link)
- Inventory browsing (locations → items)
- Camera photo capture
- Item creation/editing
- QR code generation
- Offline viewing (read-only)

**Milestone:** Beta launch with 50 users

### Phase 2: Move Features (Months 5-7)
**Deliverables:**
- QR code scanning
- Move planning UI
- Move session tracking
- Offline write operations (sync queue)

**Milestone:** Full feature parity with web app

### Phase 3: Advanced Features (Months 8-10)
**Deliverables:**
- Push notifications
- Multi-item AI detection
- Barcode scanning
- Share inventory
- Damage reporting

**Milestone:** v2.0 launch

### Phase 4: Future Enhancements (Months 11+)
**Deliverables:**
- Wearables (Apple Watch, Wear OS)
- Widgets
- AR features
- Voice assistants
- CarPlay/Android Auto

**Milestone:** Premium feature set

---

## 🚀 Deployment Strategy

### Beta Testing

**Internal Testing (2 weeks):**
- TestFlight (iOS) - team members only
- Play Internal Testing (Android) - team members only
- Fix critical bugs

**Closed Beta (4 weeks):**
- Invite 50-100 existing web users
- Collect feedback via in-app survey
- Monitor crash reports (Firebase Crashlytics)

**Open Beta (4 weeks):**
- Public TestFlight / Play Beta signup
- Promote on website and social media
- Target 500-1000 beta users

### Production Launch

**Soft Launch (2 weeks):**
- Launch in 1-2 countries (e.g., US, Canada)
- Monitor performance and crash rates
- Fix any critical issues

**Global Launch:**
- Submit final builds to App Store / Play Store
- Press release and marketing campaign
- Email all web users
- Monitor reviews and ratings

---

## 📱 App Store Optimization (ASO)

### App Metadata

**App Name:** MoveTrack - Moving & Inventory
**Subtitle:** Smart Inventory for Your Move

**Keywords (iOS):**
- moving, inventory, relocation, packing, boxes, QR code, moving checklist, home inventory

**Description:**
```
Plan your move with confidence using MoveTrack - the smart inventory app for moving day.

✓ Photograph and catalog your entire home
✓ Generate QR codes for boxes
✓ Track loading and unloading in real-time
✓ Plan routes with Google Maps
✓ Works offline during your move

Perfect for:
- Residential moves
- Storage management
- Insurance inventory
- Moving companies

[More details...]
```

**Screenshots (Required):**
- 6.5" iPhone (iPhone 14 Pro Max)
- 5.5" iPhone (iPhone 8 Plus)
- iPad Pro 12.9"
- Android phones (various sizes)
- Android tablets

**Privacy Policy URL:** https://movetrack.app/privacypolicy

---

## 🔒 Security Considerations

### Session Token Storage
✅ Use `react-native-keychain` (iOS Keychain / Android KeyStore)
❌ NEVER store in AsyncStorage

### Image URLs
✅ Only accept Google Cloud Storage URLs
❌ No arbitrary URL loading

### API Communication
✅ HTTPS only
✅ Certificate pinning (optional, advanced)
✅ Token expiration handling

### Permissions
✅ Request only when needed
✅ Explain why (permission rationale)
✅ Handle denials gracefully

---

## 📝 Notes and Decisions

### Framework Selection
**Decision:** React Native (recommended)
**Rationale:** Single codebase, faster development, large ecosystem
**Alternative:** Native iOS + Android (best performance, double time)

### Offline Strategy
**Decision:** SQLite for local storage, optimistic updates with sync queue
**Rationale:** Works without internet, essential for move day

### Camera Library
**Decision:** react-native-image-picker
**Rationale:** Supports both camera and gallery, good compression options

### Maps Integration
**Decision:** react-native-maps (Google Maps)
**Rationale:** Reuses existing Google Maps API key, familiar to users

---

## 🔗 Related Documents

- [Security Action Plan](./SECURITY-ACTION-PLAN.md)
- [Token Hashing Implementation](./TOKEN-HASHING-IMPLEMENTATION.md)
- API Documentation (to be created)
- Design System (to be created)

---

## 📞 Project Contact

For mobile development questions:
- Technical Lead: TBD
- Project Manager: TBD
- Email: dev@movetrack.app

---

**Last Updated:** December 26, 2025
**Next Review:** January 26, 2026 (monthly)
