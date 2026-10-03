import type { OrgMembership } from "@/api/auth";

const LAST_ORG_KEY = "worknest.lastOrg";

// Remembered on this device so "Open WorkNest" and login return you to the
// organization you were just in, instead of the picker.
export function rememberLastOrg(orgId: string): void {
  try {
    localStorage.setItem(LAST_ORG_KEY, orgId);
  } catch {
    // Storage can be unavailable (private mode); the picker is the fallback.
  }
}

function readLastOrg(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}

export function resolvePostAuthPath(memberships: OrgMembership[]): string {
  if (memberships.length === 1) {
    return `/orgs/${memberships[0]!.tenantId.id}/dashboard`;
  }
  // Only an organization this account still belongs to counts.
  const last = readLastOrg();
  if (last && memberships.some((m) => m.tenantId.id === last)) {
    return `/orgs/${last}/dashboard`;
  }
  return "/orgs";
}

// A same-site path from ?next=, e.g. an invite link to return to after login.
export function safeNextPath(search: string): string | null {
  const next = new URLSearchParams(search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}
