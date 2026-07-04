import { createRouter, createWebHistory, type NavigationGuardNext, type RouteLocationNormalized } from 'vue-router'
import { isMobileViewport } from '../utils/viewport'

import Home from '../views/Home.vue'
import Profile from '../views/Profile.vue'
import Login from '../views/Login.vue'
import PrivacyPolicy from '../views/PrivacyPolicy.vue'
import TermsAndConditions from '../views/TermsAndConditions.vue'
import Pricing from '../views/Pricing.vue'
import Items from '../views/Items.vue'
import MobileLocations from '../views/MobileLocations.vue'
import MobileMoves from '../views/MobileMoves.vue'
import MobileSettingsPage from '../views/MobileSettingsPage.vue'
import NotFound from '../views/NotFound.vue'
import OnboardingWelcome from '../views/onboarding/OnboardingWelcome.vue'
import OnboardingProfile from '../views/onboarding/OnboardingProfile.vue'
import OnboardingSpaces from '../views/onboarding/OnboardingSpaces.vue'
import OnboardingFirstItem from '../views/onboarding/OnboardingFirstItem.vue'
import OnboardingNextSteps from '../views/onboarding/OnboardingNextSteps.vue'
import OnboardingMobileCapture from '../views/onboarding/OnboardingMobileCapture.vue'
import DesktopInventoryUpload from '../views/onboarding/DesktopInventoryUpload.vue'
import VisionLab from '../experimental/vision/VisionLab.vue'
import ProgressButtonTest from '../views/ProgressButtonTest.vue'
import PdfInventoryTest from '../views/PdfInventoryTest.vue'
import { hasCompletedOnboarding } from '../utils/onboarding'
import { validateSessionToken, clearAuthData } from '../utils/auth'

// Custom auth guard using session tokens
const authGuard = (to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext) => {
  const sessionToken = localStorage.getItem('session_token');
  const isDevelopment = import.meta.env.MODE === 'development';

  if (sessionToken) {
    // User is logged in
    next();
  } else {
    // In development, log a helpful message
    if (isDevelopment) {
      console.log('[Auth Guard] No session token found, redirecting to login');
      console.log('[Auth Guard] If you just made a code change, your session may have been cleared by a full page reload');
    }
    // User is not logged in, redirect to login page
    next('/login');
  }
};

const adminGuard = (to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext) => {
  const sessionToken = localStorage.getItem('session_token');
  if (!sessionToken) {
    return next('/login');
  }
  try {
    const raw = localStorage.getItem('user_data');
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.is_admin) {
      return next();
    }
  } catch (error) {
    console.warn('[Admin Guard] Failed to parse user_data', error);
  }
  console.warn('[Admin Guard] Non-admin attempted to access admin route');
  return next({ name: 'items' });
};

const BASE_URL = import.meta.env.BASE_URL;
const router = createRouter({
  history: createWebHistory(BASE_URL),
  routes: [

    {
      path: "/items",
      name: "items",
      component: Items,
      beforeEnter: authGuard
    },
    {
      path: "/mobile",
      redirect: { name: 'mobile-locations' }
    },
    {
      path: "/mobile/locations/:locationId?",
      name: "mobile-locations",
      component: MobileLocations,
      beforeEnter: authGuard
    },
    {
      path: "/mobile/moves/:moveId?",
      name: "mobile-moves",
      component: MobileMoves,
      beforeEnter: authGuard
    },
    {
      path: "/mobile/settings",
      name: "mobile-settings",
      component: MobileSettingsPage,
      beforeEnter: authGuard
    },
    {
      path: "/mobile/nexus",
      name: "mobile-nexus",
      component: () => import('../views/MobileNexus.vue'),
      beforeEnter: authGuard
    },
    {
      path: "/nexus",
      name: "desktop-nexus",
      component: () => import('../views/DesktopNexus.vue'),
      beforeEnter: authGuard
    },
    {
      path: "/onboarding",
      name: "onboarding-welcome",
      component: OnboardingWelcome
    },
    {
      path: "/onboarding/profile",
      name: "onboarding-profile",
      component: OnboardingProfile
    },
    {
      path: "/onboarding/spaces",
      name: "onboarding-spaces",
      component: OnboardingSpaces
    },
    {
      path: "/onboarding/first-item",
      name: "onboarding-first-item",
      component: OnboardingFirstItem
    },
    {
      path: "/onboarding/capture",
      name: "onboarding-capture-mobile",
      component: OnboardingMobileCapture
    },
    {
      path: "/vision-lab",
      name: "vision-lab",
      component: VisionLab,
      beforeEnter: adminGuard,
    },
    // Experimental features - admin only
    {
      path: "/vision-lab-video",
      name: "vision-lab-video",
      component: () => import('../experimental/vision/VisionLabVideo.vue'),
      beforeEnter: adminGuard
    },
    {
      path: "/video-capture",
      name: "video-capture",
      component: () => import('../features/vision/video/GeminiVideoCapture.vue'),
      beforeEnter: authGuard
    },
    {
      path: "/model-selection",
      name: "model-selection",
      component: () => import('../experimental/vision/ModelSelection.vue'),
      beforeEnter: adminGuard
    },
    {
      path: "/mobile-live-scan",
      name: "mobile-live-scan",
      component: () => import('../experimental/vision/MobileLiveScan.vue'),
      beforeEnter: adminGuard
    },
    // Test pages - only available in development
    ...(import.meta.env.MODE === 'development'
      ? [
          {
            path: "/progress-button",
            name: "progress-button-test",
            component: ProgressButtonTest
          },
          {
            path: "/pdf-inventory-test",
            name: "pdf-inventory-test",
            component: PdfInventoryTest,
            beforeEnter: authGuard
          }
        ]
      : []),
    {
      path: "/onboarding/import",
      name: "onboarding-import",
      component: DesktopInventoryUpload
    },
    {
      path: "/onboarding/next",
      name: "onboarding-next",
      component: OnboardingNextSteps
    },
    {
      path: "/move-session",
      redirect: { name: 'mobile-moves' }
    },
    {
      path: "/",
      name: "home",
      component: Home
    },
    {
      path: "/login",
      name: "login",
      component: Login
    },
    {
      path: "/profile",
      name: "profile",
      component: Profile,
      beforeEnter: authGuard
    },
    {
      path: "/privacypolicy",
      name: "privacypolicy",
      component: PrivacyPolicy
    },
    {
      path: "/terms",
      name: "terms",
      component: TermsAndConditions
    },
    {
      path: "/pricing",
      name: "pricing",
      component: Pricing
    },
    {
      // Public, unauthenticated mover-facing inventory view (token-scoped).
      path: "/share/:token",
      name: "share",
      component: () => import('../views/ShareView.vue')
    },
    // Fall back component for pages not found
    {
      path: "/:catchAll(.*)",
      name: "notfound",
      component: NotFound
    }
  ],
});

router.beforeEach(async (to, from, next) => {
  // Public mover-facing share view is always reachable, logged in or not.
  if (to.path.startsWith('/share/')) {
    return next();
  }

  const sessionToken = localStorage.getItem('session_token');
  const isOnboardingRoute = to.path.startsWith('/onboarding');
  const isNexusRoute = to.path === '/mobile/nexus' || to.path === '/nexus';
  const isLoginRoute = to.path === '/login';

  console.log('[Router Guard] Navigation:', {
    to: to.path,
    from: from.path,
    hasToken: !!sessionToken,
    isOnboardingRoute,
    isNexusRoute,
    isLoginRoute
  });

  // No token - allow navigation
  if (!sessionToken) {
    console.log('[Router Guard] No token, allowing navigation');
    return next();
  }

  // Validate the session token before checking onboarding
  // This prevents infinite loops when token is expired
  console.log('[Router Guard] Validating session token...');
  const isValidToken = await validateSessionToken();
  console.log('[Router Guard] Token validation result:', isValidToken);

  if (!isValidToken) {
    console.log('[Router] Session token is invalid or expired, redirecting to login');
    clearAuthData();

    // Only redirect to login if not already going there
    if (!isLoginRoute) {
      return next('/login');
    }
    return next();
  }

  // Token is valid - check onboarding completion
  const completed = hasCompletedOnboarding();
  console.log('[Router Guard] Onboarding completed:', completed);

  if (!completed && !isOnboardingRoute && !isNexusRoute) {
    console.log('[Router Guard] Onboarding not completed, redirecting to Nexus agent');
    return next(isMobileViewport() ? { name: 'mobile-nexus' } : { path: '/nexus' });
  }

  if (completed && to.name === 'onboarding-welcome' && from.name && !from.path.startsWith('/onboarding')) {
    // allow onboarding revisit, but if navigating from elsewhere and already complete, continue
    console.log('[Router Guard] Onboarding completed, allowing revisit');
    return next();
  }

  console.log('[Router Guard] Allowing navigation');
  return next();
});

export default router;
