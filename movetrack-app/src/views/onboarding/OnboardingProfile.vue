<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import axios from "axios";
import { onboardingStore, type OnboardingGoal, type PropertyType } from "../../stores/OnboardingStore";

const emit = defineEmits<{ "app:loading": (value: boolean) => void }>();
emit("app:loading", false);

const store = onboardingStore();
const router = useRouter();
const $q = useQuasar();
const isMobile = $q.platform.is.mobile === true;
const core_url =
  import.meta.env.MODE === "development"
    ? "http://localhost:3050"
    : "https://movetrack-api-7hwn7ggbiq-uc.a.run.app";

const name = ref(store.name);
const goal = ref<OnboardingGoal>(store.goal);
const propertyType = ref<PropertyType>(store.propertyType ?? null);
const bedroomCount = ref<number | null>(store.bedroomCount ?? null);

const goalOptions = [
  { label: "I'm moving soon", value: "move" },
  { label: "I want to stay organized", value: "organize" },
  { label: "I need insurance documentation", value: "insurance" },
  { label: "I'm a professional organizer", value: "organizer" },
  { label: "Other", value: "other" },
];

const propertyTypeOptions = [
  { label: "Apartment", value: "apartment" },
  { label: "Single-family home", value: "single_family" },
  { label: "Townhouse", value: "townhouse" },
  { label: "Storage unit", value: "storage" },
];

const HOME_TYPES: PropertyType[] = ["apartment", "single_family", "townhouse"];
const showBedroomQuestion = computed(() =>
  propertyType.value != null && HOME_TYPES.includes(propertyType.value),
);

const bedroomOptions = [
  { label: "1 bedroom", value: 1 },
  { label: "2 bedrooms", value: 2 },
  { label: "3 bedrooms", value: 3 },
  { label: "4+ bedrooms", value: 4 },
];

const canContinue = computed(() => !!name.value.trim() && !!propertyType.value && !!bedroomCount.value);

const selectGoal = (value: OnboardingGoal) => {
  goal.value = value;
};

const selectPropertyType = (value: PropertyType) => {
  propertyType.value = value;
};

const selectBedroomCount = (value: number) => {
  bedroomCount.value = value;
};

const persistName = async () => {
  const trimmed = name.value.trim();
  if (!trimmed) return;
  let userId: string | null = null;
  let firstName = trimmed;
  let lastName = "";
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    firstName = parts.shift() ?? trimmed;
    lastName = parts.join(" ");
  }

  try {
    const raw = localStorage.getItem("user_data");
    if (raw) {
      const parsed = JSON.parse(raw);
      userId = parsed?.user_id || parsed?.userId || null;
      parsed.name = trimmed;
      parsed.first_name = firstName;
      parsed.last_name = lastName;
      localStorage.setItem("user_data", JSON.stringify(parsed));
    }
  } catch (error) {
    console.warn("[OnboardingProfile] Unable to update cached user", error);
  }

  const token = localStorage.getItem("session_token");
  if (!userId || !token) return;

  try {
    await axios.put(
      `${core_url}/users/name`,
      { user_id: userId, first_name: firstName, last_name: lastName },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (error) {
    console.error("[OnboardingProfile] Unable to persist name", error);
  }
};
const handleNext = async () => {
  store.setProfile({
    name: name.value.trim(),
    goal: goal.value ?? null,
  });
  store.setHomeContext({
    propertyType: propertyType.value ?? "apartment",
    bedroomCount: bedroomCount.value ?? 1,
  });

  await persistName();

  router.push({ name: "onboarding-spaces" });
};


</script>

<template>
  <q-layout view="lHh Lpr lFf">
    <q-page-container>
      <q-page :class="['onboarding-page', { 'onboarding-page--mobile': isMobile }]">
        <div :class="['onboarding-card', { 'onboarding-card--mobile': isMobile }]">
        <div class="eyebrow">Step 1 of 4</div>
        <h2>Tell us about you</h2>
        <q-input
          v-model="name"
          label="Name"
          outlined
          dense
          class="q-mt-md"
          autofocus
        />

      <div class="section">
        <div class="section-label">What brings you here?</div>
        <div class="pill-group">
          <q-btn
            v-for="option in goalOptions"
            :key="option.value"
            flat
            :label="option.label"
            :color="goal === option.value ? 'primary' : 'grey-6'"
            :text-color="goal === option.value ? 'white' : 'primary'"
            :class="['pill', { active: goal === option.value }]"
            @click="selectGoal(option.value as OnboardingGoal)"
          />
        </div>
      </div>

      <div class="section">
        <div class="section-label">What are we organizing?</div>
        <div class="pill-group">
          <q-btn
            v-for="option in propertyTypeOptions"
            :key="option.value"
            flat
            :label="option.label"
            :color="propertyType === option.value ? 'primary' : 'grey-6'"
            :text-color="propertyType === option.value ? 'white' : 'primary'"
            :class="['pill', { active: propertyType === option.value }]"
            @click="selectPropertyType(option.value as PropertyType)"
          />
        </div>
      </div>

      <div class="section" v-if="showBedroomQuestion">
        <div class="section-label">How many bedrooms?</div>
        <div class="pill-group">
          <q-btn
            v-for="option in bedroomOptions"
            :key="option.value"
            flat
            :label="option.label"
            :color="bedroomCount === option.value ? 'primary' : 'grey-6'"
            :text-color="bedroomCount === option.value ? 'white' : 'primary'"
            :class="['pill', { active: bedroomCount === option.value }]"
            @click="selectBedroomCount(option.value)"
          />
        </div>
      </div>

        <div class="actions">
          <q-btn
            class="fab-button fab-pill next-btn"
            label="Next"
            icon="arrow_forward"
            unelevated
            :disable="!canContinue"
            @click="handleNext"
          />
        </div>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped>

.onboarding-page {
  min-height: calc(100vh - 56px);
  padding: 32px 16px;
  background: #f8f9fd;
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

.section {
  margin-top: 24px;
}

.section-label {
  font-weight: 600;
  margin-bottom: 12px;
  color: #0f172a;
}

.pill-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pill {
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 999px;
  min-width: 110px;
  justify-content: center;
  font-weight: 600;
  background: rgba(99, 102, 241, 0.06);
}

.pill.active {
  background: #3b53ff;
  color: white;
}

.actions {
  margin-top: auto;
  padding-top: 24px;
  display: flex;
  justify-content: flex-end;
}

.next-btn {
  align-self: flex-end;
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
