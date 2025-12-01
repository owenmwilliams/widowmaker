<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { onboardingStore } from "../../stores/OnboardingStore";
import { inventoryStore } from "../../stores/InventoryStore";
import LocationSearchInline from "../../components/location/LocationSearchInline.vue";

const emit = defineEmits<{ "app:loading": (value: boolean) => void }>();
emit("app:loading", false);

const store = onboardingStore();
const router = useRouter();

interface LocationForm {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  lat: number | null;
  lng: number | null;
  formattedAddress?: string | null;
}

const locationForm = ref<LocationForm>({
  name: store.locationName || "",
  address1: store.locationAddress || "",
  address2: store.locationAddressTwo || "",
  city: store.locationCity || "",
  state: store.locationState || "",
  zip: store.locationZip || "",
  country: "USA",
  lat: null,
  lng: null,
  formattedAddress: store.locationAddress || ""
});

const displayedBedrooms = ref(store.bedroomCount ?? 1);


const roomOptions = computed(() => {
  const base = [
    "Kitchen",
    "Living Room",
    "Garage",
    "Storage",
    "Office",
    "Dining",
  ];
  const bedrooms = Array.from({ length: displayedBedrooms.value }, (_, index) => `Bedroom ${index + 1}`);
  const custom = store.selectedRooms.filter((room) => !base.includes(room) && !bedrooms.includes(room));
  return [...base, ...bedrooms, ...custom];
});

const isSelected = (room: string) => store.selectedRooms.includes(room);
const toggle = (room: string) => store.toggleRoom(room);

const showRoomDialog = ref(false);
const customRoomName = ref("");

const openRoomDialog = () => {
  customRoomName.value = "";
  showRoomDialog.value = true;
};

const saveCustomRoom = () => {
  const label = customRoomName.value.trim();
  if (!label) return;
  if (!store.selectedRooms.includes(label)) {
    store.setRooms([...store.selectedRooms, label]);
  }
  customRoomName.value = "";
  showRoomDialog.value = false;
};

const canContinue = computed(() => {
  const form = locationForm.value;
  return (
    form.name.trim().length > 0 &&
    form.address1.trim().length > 0 &&
    form.city.trim().length > 0 &&
    form.state.trim().length > 0 &&
    form.zip.trim().length > 0
  );
});

const autopopulateRooms = () => {
  const defaults = new Set<string>();
  defaults.add("Kitchen");
  defaults.add("Living Room");
  const bedrooms = Math.max(1, store.bedroomCount ?? 1);
  for (let i = 0; i < bedrooms; i += 1) {
    defaults.add(`Bedroom ${i + 1}`);
  }
  if (store.propertyType === "single_family" || store.propertyType === "townhouse") {
    defaults.add("Garage");
  }
  if (bedrooms >= 3) {
    defaults.add("Office");
  }
  store.setRooms(Array.from(defaults));
};

onMounted(() => {
  if (!store.selectedRooms.length) {
    autopopulateRooms();
  }
});

const inventory = inventoryStore();
const $q = useQuasar();
const isMobile = $q.platform.is.mobile === true;
const isMobilePlatform = () => isMobile;
const userId = ref<string | null>(null);

if (typeof window !== "undefined") {
  try {
    const data = JSON.parse(localStorage.getItem("user_data") || "{}");
    userId.value = data?.user_id || data?.userId || null;
  } catch (error) {
    userId.value = null;
  }
}

const isSaving = ref(false);

const handleNext = async () => {
  if (isSaving.value) return;
  const form = locationForm.value;
  store.setLocation({
    name: form.name.trim(),
    address: form.address1.trim(),
    addressTwo: form.address2.trim(),
    city: form.city.trim(),
    state: form.state.trim(),
    zip: form.zip.trim(),
  });
  store.setRooms([...store.selectedRooms]);
  router.push({ name: "onboarding-first-item" });
};
</script>

<template>
  <q-layout view="lHh Lpr lFf">
    <q-page-container>
      <q-page :class="['onboarding-page', { 'onboarding-page--mobile': isMobile }]">
        <div :class="['onboarding-card', { 'onboarding-card--mobile': isMobile }]">        <div class="eyebrow">Step 2 of 4</div>
        <h2>Where are we starting?</h2>
      <p class="lede">
        We’ll use this location and room list to suggest the right boxes, truck zones, and scanning shortcuts.
      </p>

      <div class="form-grid">
        <LocationSearchInline v-model="locationForm" />
      </div>

      <div class="section">
        <div class="section-label">Rooms to track</div>
        <div class="room-grid">
          <q-chip
            v-for="room in roomOptions"
            :key="room"
            clickable
            :selected="isSelected(room)"
            :color="isSelected(room) ? 'primary' : 'grey-5'"
            text-color="white"
            @click="toggle(room)"
          >
            {{ room }}
          </q-chip>
          <q-chip
            clickable
            outline
            color="primary"
            text-color="primary"
            @click="openRoomDialog"
          >
            <q-icon name="add" size="16px" class="q-mr-xs" />
            Add room
          </q-chip>
        </div>
      </div>

      <div class="actions">
        <q-btn
          class="fab-button fab-pill"
          label="Next"
          icon="arrow_forward"
          unelevated
          :disable="!canContinue || isSaving"
          :loading="isSaving"
          @click="handleNext"
        />
      </div>
    </div>
  </q-page>
</q-page-container>
    <q-dialog v-model="showRoomDialog" persistent>
      <q-card class="custom-room-dialog">
        <q-card-section>
          <div class="text-h6">Add a room</div>
          <div class="text-subtitle2 text-grey-7">Name the space you want to track.</div>
          <q-input
            v-model="customRoomName"
            label="Room name"
            outlined
            dense
            autofocus
            @keyup.enter="saveCustomRoom"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey-7" @click="showRoomDialog = false" />
          <q-btn flat label="Add" color="primary" :disable="!customRoomName.trim()" @click="saveCustomRoom" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-layout>
</template>

<style scoped>
.onboarding-page {
  min-height: calc(100vh - 56px);
  padding: 32px 16px;
  background: #eef2ff;
  display: flex;
  justify-content: center;
  align-items: center;
}

.onboarding-page--mobile {
  align-items: flex-start;
  padding: 16px;
}

.onboarding-card {
  width: min(60vw, 900px);
  max-width: 900px;
  background: white;
  border-radius: 24px;
  padding: 28px 32px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  margin: 24px auto;
}

.onboarding-card--mobile {
  width: 100%;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  padding: 16px;
}

.onboarding-card h2 {
  font-size: 1.75rem;
  margin: 4px 0 12px;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.3em;
  font-size: 0.7rem;
  color: #94a3b8;
}

.lede {
  margin-top: 8px;
  color: #475569;
}

.section {
  margin-top: 32px;
}

.section-label {
  font-weight: 600;
  margin-bottom: 12px;
  color: #0f172a;
}

.room-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.actions {
  margin-top: auto;
  padding-top: 24px;
  display: flex;
  justify-content: flex-end;
}

.form-grid {
  margin-bottom: 24px;
}

.actions {
  margin-top: auto;
  padding-top: 24px;
  display: flex;
  justify-content: flex-end;
}

.fab-button {
  box-shadow: 0 10px 24px rgba(39, 70, 144, 0.28);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
  background: linear-gradient(135deg, #274690, #1ca1c1, #7dd3fc);
  background-size: 240% 240%;
  animation: fabShimmer 2.8s ease-in-out infinite;
  position: relative;
  overflow: hidden;
}

.fab-pill {
  border-radius: 999px;
  padding: 14px 28px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: white;
}

.fab-button :deep(.q-btn__content) {
  gap: 10px;
  font-size: 1rem;
}

.fab-button:hover {
  transform: scale(1.05);
  box-shadow: 0 12px 28px rgba(39, 70, 144, 0.32);
}

.fab-button:active {
  transform: scale(0.96);
  box-shadow: 0 8px 18px rgba(39, 70, 144, 0.25);
}

@keyframes fabShimmer {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
    box-shadow: 0 12px 28px rgba(39, 70, 144, 0.34);
  }
  100% {
    background-position: 0% 50%;
  }
}

.fab-button::after {
  content: "";
  position: absolute;
  inset: -12%;
  background:
    radial-gradient(
      10px 10px at 20% 30%,
      rgba(255, 255, 255, 0.6),
      transparent
    ),
    radial-gradient(
      6px 6px at 60% 40%,
      rgba(255, 255, 255, 0.4),
      transparent
    );
  opacity: 0.6;
  pointer-events: none;
}

</style>
