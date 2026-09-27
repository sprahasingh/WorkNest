import { useSearchParams } from "react-router";
import { useOrg } from "@/hooks/useOrg";
import { useMembers } from "@/features/members/queries";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, type AuditAction } from "./api";
import { useAuditLog, type AuditFilters } from "./queries";
import { describeAuditEntry } from "./format";

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
    <div className="min-h-screen bg-slate-100 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-800">Audit log</h1>

        <div className="mt-4 flex flex-wrap gap-3">
          <select
            value={filters.action ?? ""}
            onChange={(event) =>
              setFilter("action", event.target.value || null)
            }
            className="rounded border border-slate-300 px-2 py-1 text-sm"
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
            className="rounded border border-slate-300 px-2 py-1 text-sm"
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
            className="rounded border border-slate-300 px-2 py-1 text-sm"
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
                className="h-12 animate-pulse rounded-lg bg-slate-200"
              />
            ))}

          {isError && (
            <p className="rounded bg-red-50 px-4 py-3 text-sm text-red-700">
              Couldn&apos;t load the audit log.
            </p>
          )}

          {!isPending && !isError && entries.length === 0 && (
            <p className="rounded-lg bg-white p-6 text-center text-sm text-slate-500 shadow">
              No matching activity yet.
            </p>
          )}

          {!isPending &&
            !isError &&
            entries.map((entry) => (
              <div key={entry._id} className="rounded-lg bg-white p-3 shadow">
                <p className="text-sm text-slate-800">
                  {describeAuditEntry(entry)}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {new Date(entry.createdAt).toLocaleString()}
                </p>
              </div>
            ))}

          {hasNextPage && (
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full rounded border border-slate-300 py-2 text-sm font-medium text-slate-600 disabled:opacity-50"
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
