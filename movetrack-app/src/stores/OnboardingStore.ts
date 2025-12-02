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
      locationId: draft.locationId ?? null,
      selectedRooms: draft.selectedRooms ?? [],
      importDraft: draft.importDraft ?? {},
      completed: hasCompletedOnboarding(),
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
    }) {
      this.locationName = payload.name;
      this.locationAddress = payload.address;
      this.locationAddressTwo = payload.addressTwo ?? "";
      this.locationCity = payload.city;
      this.locationState = payload.state;
      this.locationZip = payload.zip;
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

      for (const item of queued) {
        const roomLabel =
          typeof item.room === "string" ? item.room.trim().toLowerCase() : "";
        const collection =
          inventory.collections.find(
            (col) => (col.label || "").trim().toLowerCase() === roomLabel,
          ) || inventory.collections[0];
        if (!collection) continue;

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
            collection.value,
            undefined,
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
          );
        } catch (error) {
          console.error("[OnboardingStore] Failed to persist queued item", error);
        }
      }
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
