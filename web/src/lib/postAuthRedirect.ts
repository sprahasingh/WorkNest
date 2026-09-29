import type { OrgMembership } from "@/api/auth";

export function resolvePostAuthPath(memberships: OrgMembership[]): string {
  if (memberships.length === 1) {
    return `/orgs/${memberships[0]!.tenantId.id}/dashboard`;
  }
  return "/orgs";
}
