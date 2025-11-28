import { createRouter, createWebHistory, type NavigationGuardNext, type RouteLocationNormalized } from 'vue-router'

import Home from '../views/Home.vue'
import Profile from '../components/Profile.vue'
import Login from '../components/Login.vue'
import PrivacyPolicy from '../views/PrivacyPolicy.vue'
import TermsAndConditions from '../views/TermsAndConditions.vue'
import LearningCenter from '../views/LearningCenter.vue'
import Pricing from '../views/Pricing.vue'
import Items from '../components/Items.vue'
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
import { hasCompletedOnboarding } from '../utils/onboarding'

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
      path: "/learn",
      name: "learn",
      component: LearningCenter,
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
    // Fall back component for pages not found
    {
      path: "/:catchAll(.*)",
      name: "notfound",
      component: NotFound
    }
  ],
});

router.beforeEach((to, from, next) => {
  const sessionToken = localStorage.getItem('session_token');
  const isOnboardingRoute = to.path.startsWith('/onboarding');
  if (!sessionToken) {
    return next();
  }

  const completed = hasCompletedOnboarding();
  if (!completed && !isOnboardingRoute) {
    return next({ name: 'onboarding-welcome' });
  }

  if (completed && to.name === 'onboarding-welcome' && from.name && !from.path.startsWith('/onboarding')) {
    // allow onboarding revisit, but if navigating from elsewhere and already complete, continue
    return next();
  }

  return next();
});

export default router;
