// Things that live outside React Query (unsent chat drafts, for example) and
// must not outlast the person who was signed in. Each registers a function
// here; signing out runs them all.
const hooks = new Set<() => void>();

export function registerSignOutHook(hook: () => void): void {
  hooks.add(hook);
}

export function runSignOutHooks(): void {
  for (const hook of hooks) {
    try {
      hook();
    } catch {
      // One failing cleanup must not stop the rest.
    }
  }
}
