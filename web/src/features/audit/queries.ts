import { useInfiniteQuery } from "@tanstack/react-query";
import { listAuditLogs, type AuditAction } from "./api";

export interface AuditFilters {
  action?: AuditAction;
  actorId?: string;
  entityType?: string;
}

export const auditKeys = {
  list: (orgId: string, filters: AuditFilters) =>
    ["orgs", orgId, "audit", "list", filters] as const,
};

export function useAuditLog(orgId: string, filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: auditKeys.list(orgId, filters),
    queryFn: ({ pageParam }) =>
      listAuditLogs(orgId, { ...filters, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
