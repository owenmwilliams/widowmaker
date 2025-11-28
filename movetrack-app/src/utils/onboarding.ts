export type OnboardingUser = {
  user_id?: string;
  userId?: string;
  email?: string;
  onboarding_completed?: boolean;
} | null | undefined;

const getUserIdentifier = (user?: OnboardingUser) => {
  if (!user) {
    return null;
  }
  return user.user_id || user.userId || user.email || null;
};

const getStoredUser = (): OnboardingUser => {
  try {
    const raw = localStorage.getItem('user_data');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[onboarding] Failed to parse user_data', error);
    return null;
  }
};

export const getOnboardingKey = (user?: OnboardingUser) => {
  const identifier = getUserIdentifier(user ?? getStoredUser());
  return identifier ? `onboarding_completed:${identifier}` : 'onboarding_completed';
};

const flagFromUser = (user?: OnboardingUser) => {
  if (!user) return null;
  if (typeof user === 'object' && user !== null && 'onboarding_completed' in user) {
    return typeof user.onboarding_completed === 'boolean' ? user.onboarding_completed : null;
  }
  return null;
};

export const hasCompletedOnboarding = (user?: OnboardingUser) => {
  const reference = user ?? getStoredUser();
  const serverFlag = flagFromUser(reference);
  if (serverFlag !== null) {
    return serverFlag;
  }
  return localStorage.getItem(getOnboardingKey(reference)) === 'true';
};

export const markOnboardingComplete = (user?: OnboardingUser) => {
  const reference = user ?? getStoredUser();
  if (reference && typeof reference === 'object') {
    reference.onboarding_completed = true;
    try {
      localStorage.setItem('user_data', JSON.stringify(reference));
    } catch (error) {
      console.warn('[onboarding] Failed to persist user_data update', error);
    }
  }
  localStorage.setItem(getOnboardingKey(reference), 'true');
};
