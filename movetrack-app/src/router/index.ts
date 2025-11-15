import { createRouter, createWebHistory, type NavigationGuardNext, type RouteLocationNormalized } from 'vue-router'

import Home from '../views/Home.vue'
import Profile from '../components/Profile.vue'
import Login from '../components/Login.vue'
import PrivacyPolicy from '../views/PrivacyPolicy.vue'
import TermsAndConditions from '../views/TermsAndConditions.vue'
import LearningCenter from '../views/LearningCenter.vue'
import Items from '../components/Items.vue'
import NotFound from '../views/NotFound.vue'

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
    // Fall back component for pages not found
    {
      path: "/:catchAll(.*)",
      name: "notfound",
      component: NotFound
    }
  ],
});

export default router;
