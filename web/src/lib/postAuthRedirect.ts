import type { OrgMembership } from "@/api/auth";

export function resolvePostAuthPath(memberships: OrgMembership[]): string {
  if (memberships.length === 1) {
    return `/orgs/${memberships[0]!.tenantId.id}/dashboard`;
  }
  return "/orgs";
}

// A same-site path from ?next=, e.g. an invite link to return to after login.
export function safeNextPath(search: string): string | null {
  const next = new URLSearchParams(search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}
