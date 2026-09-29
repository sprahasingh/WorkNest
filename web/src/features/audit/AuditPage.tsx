import { useSearchParams } from "react-router";
import { useOrg } from "@/hooks/useOrg";
import { useMembers } from "@/features/members/queries";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, type AuditAction } from "./api";
import { useAuditLog, type AuditFilters } from "./queries";
import { describeAuditEntry } from "./format";

const selectStyles =
  "rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30";

export function AuditPage() {
  const { orgId } = useOrg();
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: AuditFilters = {
    action: (searchParams.get("action") as AuditAction | null) ?? undefined,
    entityType: searchParams.get("entityType") ?? undefined,
    actorId: searchParams.get("actorId") ?? undefined,
  };

  const membersQuery = useMembers(orgId);
  const members = membersQuery.data ?? [];

  const {
    data,
    isPending,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAuditLog(orgId, filters);

  const entries = data?.pages.flatMap((page) => page.items) ?? [];

  const setFilter = (key: string, value: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!value) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-900">Audit log</h1>

        <div className="mt-4 flex flex-wrap gap-3">
          <select
            value={filters.action ?? ""}
            onChange={(event) =>
              setFilter("action", event.target.value || null)
            }
            className={selectStyles}
          >
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>

          <select
            value={filters.entityType ?? ""}
            onChange={(event) =>
              setFilter("entityType", event.target.value || null)
            }
            className={selectStyles}
          >
            <option value="">All types</option>
            {AUDIT_ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          <select
            value={filters.actorId ?? ""}
            onChange={(event) =>
              setFilter("actorId", event.target.value || null)
            }
            className={selectStyles}
          >
            <option value="">Everyone</option>
            {members.map((member) => (
              <option key={member._id} value={member.userId.id}>
                {member.userId.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-6 space-y-2">
          {isPending &&
            [0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-xl bg-slate-200"
              />
            ))}

          {isError && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              Couldn&apos;t load the audit log.
            </p>
          )}

          {!isPending && !isError && entries.length === 0 && (
            <Card className="text-center text-sm text-slate-500">
              No matching activity yet.
            </Card>
          )}

          {!isPending &&
            !isError &&
            entries.map((entry) => (
              <Card key={entry._id} className="p-3">
                <p className="text-sm text-slate-800">
                  {describeAuditEntry(entry)}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {new Date(entry.createdAt).toLocaleString()}
                </p>
              </Card>
            ))}

          {hasNextPage && (
            <Button
              variant="secondary"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full"
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
