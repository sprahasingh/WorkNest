// Remembers, on this device, that someone was signed in and where their
// workspace is, so the landing page can offer "Go to your workspace" at once
// instead of flashing Log in / Register while the session check runs. It holds
// no credentials; the real check still decides.
const KEY = "worknest.lastWorkspace";

export function readSignedInHint(): string | null {
  try {
    const path = localStorage.getItem(KEY);
    return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}

export function rememberSignedIn(workspacePath: string): void {
  try {
    localStorage.setItem(KEY, workspacePath);
  } catch {
    // Storage can be unavailable (private mode); the page just waits instead.
  }
}

export function forgetSignedIn(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
