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
    // Ignore storage failures (private browsing, etc.) — the tour just
    // reappears next visit, which is a harmless fallback.
  }
}
