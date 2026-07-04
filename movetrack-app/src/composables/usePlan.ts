import { computed, ref } from "vue";
import axios from "axios";

export type Plan = "basic" | "pro";

// Module-level singletons: every component that calls usePlan() shares the
// same plan state, so the admin preview toggle, the x-plan-preview header,
// and plan-gated UI can never disagree with each other.

const readUserData = (): any => {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem("user_data") || "{}");
  } catch {
    return {};
  }
};

const readStoredPreview = (): Plan | null => {
  if (typeof window === "undefined") return null;
  const value = localStorage.getItem("plan_preview");
  return value === "basic" || value === "pro" ? value : null;
};

const userData = ref<any>(readUserData());
const planPreview = ref<Plan | null>(readStoredPreview());

const basePlan = computed<Plan>(() =>
  (userData.value?.plan || "basic").toLowerCase() === "pro" ? "pro" : "basic",
);
const isAdmin = computed(() => !!userData.value?.is_admin);

// The preview is an admin testing tool; non-admins always get their real plan.
const effectivePlan = computed<Plan>(() =>
  isAdmin.value && planPreview.value ? planPreview.value : basePlan.value,
);
const isPro = computed(() => effectivePlan.value === "pro");

const applyPlanHeader = () => {
  if (isAdmin.value) {
    axios.defaults.headers.common["x-plan-preview"] =
      planPreview.value || basePlan.value;
  } else {
    delete axios.defaults.headers.common["x-plan-preview"];
  }
};

const setPlanPreview = (plan: Plan) => {
  planPreview.value = plan;
  localStorage.setItem("plan_preview", plan);
  applyPlanHeader();
  window.dispatchEvent(new CustomEvent("plan-preview-change", { detail: plan }));
};

// Refreshes user data after login/logout changes localStorage in this tab.
const refreshPlanUser = () => {
  userData.value = readUserData();
  applyPlanHeader();
};

if (typeof window !== "undefined") {
  // Cross-tab changes arrive via the storage event; the custom event exists
  // for any legacy same-tab dispatchers.
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key === "plan_preview") {
      planPreview.value =
        event.newValue === "basic" || event.newValue === "pro"
          ? event.newValue
          : null;
    } else if (event.key === "user_data") {
      refreshPlanUser();
    }
  });
  window.addEventListener("plan-preview-change", (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail === "basic" || detail === "pro") {
      planPreview.value = detail;
    }
  });
  applyPlanHeader();
}

export function usePlan() {
  return {
    basePlan,
    isAdmin,
    planPreview,
    effectivePlan,
    isPro,
    setPlanPreview,
    refreshPlanUser,
  };
}
