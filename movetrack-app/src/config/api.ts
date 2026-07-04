// Single source of truth for the MoveTrack API base URL.
//
// Dev reads VITE_API_BASE_URL from .env; production images inject it via
// --build-arg in cloudbuild.yaml. The mode-based fallback keeps builds
// working when the variable is not set.
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.MODE === "development"
    ? "http://localhost:3050"
    : "https://movetrack-api-7hwn7ggbiq-uc.a.run.app");
