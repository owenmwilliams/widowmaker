import { defineStore } from "pinia";
import axios from "axios";
import { hasCompletedOnboarding, markOnboardingComplete } from "../utils/onboarding";
import { inventoryStore } from "./InventoryStore";

const core_url =
  import.meta.env.MODE === "development"
    ? "http://localhost:3050"
    : "https://movetrack-api-7hwn7ggbiq-uc.a.run.app";

export type OnboardingGoal =
  | "move"
  | "organize"
  | "insurance"
  | "multi_home"
  | null;
export type PropertyType = "apartment" | "single_family" | "townhouse" | null;

type OnboardingDraft = {
  name?: string;
  goal?: OnboardingGoal;
  propertyType?: PropertyType | null;
  bedroomCount?: number | null;
  locationName?: string;
  locationAddress?: string;
  locationAddressTwo?: string;
  locationCity?: string;
  locationState?: string;
  locationZip?: string;
  locationLat?: number | null;
  locationLng?: number | null;
  locationId?: string | null;
  selectedRooms?: string[];
  importDraft?: Record<string, any>;
};

const DRAFT_KEY = "onboarding_draft";

const getCurrentUserId = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("user_data");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.user_id || parsed?.userId || null;
  } catch (error) {
    console.warn("[OnboardingStore] Failed to read user_data", error);
    return null;
  }
};

const loadDraft = (): OnboardingDraft => {
  if (typeof window === "undefined") return {};
  try {
    const value = localStorage.getItem(DRAFT_KEY);
    if (!value) return {};
    const parsed = JSON.parse(value);
    const currentUserId = getCurrentUserId();
    if (currentUserId && parsed?.user_id && parsed.user_id !== currentUserId) {
      localStorage.removeItem(DRAFT_KEY);
      return {};
    }
    return parsed;
  } catch (error) {
    console.warn("[OnboardingStore] Failed to load draft", error);
    return {};
  }
};

export const onboardingStore = defineStore("onboarding", {
  state: () => {
    const draft = loadDraft();
    return {
      name: draft.name ?? "",
      goal: (draft.goal ?? null) as OnboardingGoal,
      propertyType: (draft.propertyType ?? null) as PropertyType,
      bedroomCount: draft.bedroomCount ?? null,
      locationName: draft.locationName ?? "",
      locationAddress: draft.locationAddress ?? "",
      locationAddressTwo: draft.locationAddressTwo ?? "",
      locationCity: draft.locationCity ?? "",
      locationState: draft.locationState ?? "",
      locationZip: draft.locationZip ?? "",
      locationLat: draft.locationLat ?? null,
      locationLng: draft.locationLng ?? null,
      locationId: draft.locationId ?? null,
      selectedRooms: draft.selectedRooms ?? [],
      importDraft: draft.importDraft ?? {},
      completed: hasCompletedOnboarding(),
      // Progress tracking for item creation
      uploadProgress: {
        current: 0,
        total: 0,
        phase: '' as 'containers' | 'items' | 'complete' | '',
        percentage: 0,
      },
    };
  },
  actions: {
    persistDraft() {
      if (typeof window === "undefined") return;
      const payload: OnboardingDraft = {
        name: this.name,
        goal: this.goal,
        propertyType: this.propertyType,
        bedroomCount: this.bedroomCount,
        locationName: this.locationName,
        locationAddress: this.locationAddress,
        locationAddressTwo: this.locationAddressTwo,
        locationCity: this.locationCity,
        locationState: this.locationState,
        locationZip: this.locationZip,
        locationLat: this.locationLat,
        locationLng: this.locationLng,
        locationId: this.locationId,
        selectedRooms: this.selectedRooms,
        importDraft: this.importDraft,
        user_id: getCurrentUserId(),
      };
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
      } catch (error) {
        console.warn("[OnboardingStore] Failed to persist draft", error);
      }
    },
    setProfile(payload: { name: string; goal: OnboardingGoal }) {
      this.name = payload.name;
      this.goal = payload.goal;
      this.persistDraft();
    },
    setHomeContext(payload: { propertyType: PropertyType; bedroomCount: number }) {
      this.propertyType = payload.propertyType;
      this.bedroomCount = payload.bedroomCount;
      this.persistDraft();
    },
    toggleRoom(room: string) {
      if (this.selectedRooms.includes(room)) {
        this.selectedRooms = this.selectedRooms.filter((r) => r !== room);
      } else {
        this.selectedRooms = [...this.selectedRooms, room];
      }
      this.persistDraft();
    },
    setRooms(rooms: string[]) {
      this.selectedRooms = rooms;
      this.persistDraft();
    },
    setLocation(payload: {
      name: string;
      address: string;
      addressTwo?: string;
      city: string;
      state: string;
      zip: string;
      lat?: number | null;
      lng?: number | null;
    }) {
      this.locationName = payload.name;
      this.locationAddress = payload.address;
      this.locationAddressTwo = payload.addressTwo ?? "";
      this.locationCity = payload.city;
      this.locationState = payload.state;
      this.locationZip = payload.zip;
      this.locationLat = payload.lat ?? null;
      this.locationLng = payload.lng ?? null;
      this.persistDraft();
    },
    setLocationId(value: string | null) {
      this.locationId = value;
      this.persistDraft();
    },
    setImportDraft(payload: Record<string, unknown>) {
      this.importDraft = { ...this.importDraft, ...payload };
      this.persistDraft();
    },
    async markCompleted(options?: { skipRemote?: boolean }) {
      const skipRemote = options?.skipRemote === true;
      const token = typeof window !== "undefined" ? localStorage.getItem("session_token") : null;
      let cachedUser: any = null;
      if (typeof window !== "undefined") {
        try {
          const raw = localStorage.getItem("user_data");
          cachedUser = raw ? JSON.parse(raw) : null;
        } catch (error) {
          console.warn("[OnboardingStore] Failed to parse user_data", error);
        }
      }

      if (token && !skipRemote) {
        try {
          await axios.put(
            `${core_url}/users/onboarding`,
            {},
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          );
          if (cachedUser && typeof cachedUser === "object") {
            cachedUser.onboarding_completed = true;
            localStorage.setItem("user_data", JSON.stringify(cachedUser));
          }
        } catch (error) {
          console.error("[OnboardingStore] Failed to persist onboarding completion", error);
        }
      }

      markOnboardingComplete(cachedUser || undefined);
      if (typeof window !== "undefined") {
        localStorage.removeItem(DRAFT_KEY);
      }
      this.completed = true;
    },
    buildProfilePayload() {
      const trimmed = (this.name || "").trim();
      if (!trimmed) return null;
      const parts = trimmed.split(/\s+/);
      const firstName = parts.shift() || trimmed;
      const lastName = parts.length ? parts.join(" ") : null;
      return { first_name: firstName, last_name: lastName, goal: this.goal };
    },
    buildLocationPayload() {
      return {
        id: this.locationId,
        name: this.locationName,
        address: this.locationAddress,
        address2: this.locationAddressTwo,
        city: this.locationCity,
        state: this.locationState,
        zip: this.locationZip,
      };
    },
    async persistQueuedItems() {
      const queued =
        Array.isArray(this.importDraft?.items) && this.importDraft.items.length
          ? (this.importDraft.items as any[])
          : [];
      if (!queued.length) return;
      const userId = getCurrentUserId();
      if (!userId) return;

      const inventory = inventoryStore();
      await inventory.loadInventory(userId);

      // Calculate total work units (containers + items)
      const uniqueContainers = new Set<string>();
      for (const item of queued) {
        const roomLabel =
          typeof item.room === "string" ? item.room.trim().toLowerCase() : "";
        const containerName =
          typeof item.container === "string" ? item.container.trim() : "";
        if (roomLabel && containerName) {
          uniqueContainers.add(`${roomLabel}:${containerName.toLowerCase()}`);
        }
      }

      const totalContainers = uniqueContainers.size;
      const totalItems = queued.length;
      const totalWork = totalContainers + totalItems;

      // Initialize progress
      this.uploadProgress = {
        current: 0,
        total: totalWork,
        phase: 'containers',
        percentage: 0,
      };

      // Step 1: Create all unique containers first
      // Map: room -> container name -> container ID
      const containerMap = new Map<string, Map<string, string>>();

      for (const item of queued) {
        const roomLabel =
          typeof item.room === "string" ? item.room.trim().toLowerCase() : "";
        const containerName =
          typeof item.container === "string" ? item.container.trim() : "";

        if (!roomLabel || !containerName) continue;

        // Find matching collection
        const collection = inventory.collections.find(
          (col) => (col.label || "").trim().toLowerCase() === roomLabel,
        );
        if (!collection) continue;

        // Initialize room map if needed
        if (!containerMap.has(roomLabel)) {
          containerMap.set(roomLabel, new Map());
        }

        const roomContainers = containerMap.get(roomLabel)!;

        // Check if container already exists or was just created
        const existingContainer = inventory.containers.find(
          (cont) =>
            cont.collection === collection.value &&
            cont.label.trim().toLowerCase() === containerName.toLowerCase(),
        );

        if (existingContainer) {
          roomContainers.set(containerName.toLowerCase(), existingContainer.value);
        } else if (!roomContainers.has(containerName.toLowerCase())) {
          // Create new container
          try {
            await inventory.createContainer(
              userId,
              containerName,
              collection.value,
            );

            // Reload inventory to get the newly created container
            await inventory.loadInventory(userId);

            // Find the container we just created
            const newContainer = inventory.containers.find(
              (cont) =>
                cont.collection === collection.value &&
                cont.label.trim().toLowerCase() === containerName.toLowerCase(),
            );

            if (newContainer) {
              roomContainers.set(containerName.toLowerCase(), newContainer.value);
              console.log(`[OnboardingStore] Created container: ${containerName} in ${collection.label}`);
            }

            // Update progress
            this.uploadProgress.current++;
            this.uploadProgress.percentage = Math.round(
              (this.uploadProgress.current / this.uploadProgress.total) * 100
            );
          } catch (error) {
            console.error(
              `[OnboardingStore] Failed to create container ${containerName}`,
              error,
            );
          }
        }
      }

      // Step 2: Create items with proper container references
      this.uploadProgress.phase = 'items';

      for (const item of queued) {
        const roomLabel =
          typeof item.room === "string" ? item.room.trim().toLowerCase() : "";
        const containerName =
          typeof item.container === "string" ? item.container.trim() : "";

        const collection =
          inventory.collections.find(
            (col) => (col.label || "").trim().toLowerCase() === roomLabel,
          ) || inventory.collections[0];
        if (!collection) continue;

        // Find container ID if specified
        let containerId: string | undefined = undefined;
        if (containerName && containerMap.has(roomLabel)) {
          containerId = containerMap.get(roomLabel)!.get(containerName.toLowerCase());
        }

        let imageBlob: Blob | undefined;
        if (item.picture_url) {
          try {
            const response = await fetch(item.picture_url);
            imageBlob = await response.blob();
          } catch (error) {
            console.warn("[OnboardingStore] Unable to read image blob", error);
          }
        }

        try {
          await inventory.createItem(
            userId,
            item.name || "New Item",
            item.description || "",
            item.quantity || 1,
            collection.value, // collection.value is the collection ID (string)
            containerId, // Now properly references created container
            imageBlob,
            null,
            item.fragile || false,
            undefined,
            item.weight_lbs ?? null,
            item.length_in ?? null,
            item.width_in ?? null,
            item.height_in ?? null,
            item.notes || undefined,
            item.material || undefined,
            item.primary_color || undefined,
            Array.isArray(item.tags) ? item.tags : [],
            { skipRedirect: true }, // Don't redirect during bulk onboarding item creation
          );

          // Update progress
          this.uploadProgress.current++;
          this.uploadProgress.percentage = Math.round(
            (this.uploadProgress.current / this.uploadProgress.total) * 100
          );
        } catch (error) {
          console.error("[OnboardingStore] Failed to persist queued item", error);
        }
      }

      // Mark as complete
      this.uploadProgress.phase = 'complete';
      this.uploadProgress.percentage = 100;
    },
    async finalizeOnboarding() {
      const token = typeof window !== "undefined" ? localStorage.getItem("session_token") : null;
      if (!token) {
        console.error("[OnboardingStore] No session token found in localStorage");
        throw new Error("Not authenticated - please log in again");
      }

      const profile = this.buildProfilePayload();
      const location = this.buildLocationPayload();
      if (!location.name || !location.address || !location.city || !location.state || !location.zip) {
        console.error("[OnboardingStore] Incomplete location data:", location);
        throw new Error("Location information is incomplete");
      }

      const payload = {
        profile,
        location,
        rooms: this.selectedRooms,
      };

      console.log("[OnboardingStore] Sending onboarding completion request");
      const response = await axios.post(`${core_url}/onboarding/complete`, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      await this.persistQueuedItems();
      await this.markCompleted({ skipRemote: true });
      this.importDraft = {};
      this.persistDraft();
      return response.data;
    },
    reset() {
      this.name = "";
      this.goal = null;
      this.propertyType = null;
      this.bedroomCount = null;
      this.locationName = "";
      this.locationAddress = "";
      this.locationAddressTwo = "";
      this.locationCity = "";
      this.locationState = "";
      this.locationZip = "";
      this.locationId = null;
      this.selectedRooms = [];
      this.importDraft = {};
      this.completed = false;
      if (typeof window !== "undefined") {
        localStorage.removeItem(DRAFT_KEY);
      }
    },
  },
});
