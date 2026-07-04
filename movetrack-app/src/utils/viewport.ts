// Single definition of the mobile/desktop breakpoint used for routing
// between the desktop and mobile experiences.
export const MOBILE_BREAKPOINT_PX = 768;

export const isMobileViewport = (): boolean =>
  typeof window !== "undefined" &&
  (window.innerWidth < MOBILE_BREAKPOINT_PX ||
    screen.width < MOBILE_BREAKPOINT_PX);
