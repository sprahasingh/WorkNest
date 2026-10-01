const STORAGE_KEY = "worknest.onboarding.seen";

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return true;
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // Ignore storage failures, such as private browsing. The tour just
    // reappears next visit, which is a harmless fallback.
  }
}
