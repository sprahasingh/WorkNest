import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { inputControlStyles } from "@/components/ui/Field";
import type { Member } from "@/features/members/api";
import { Avatar } from "@/components/ui/Avatar";

interface MemberPickerProps {
  members: Member[] | undefined;
  isPending: boolean;
  excludeIds: string[];
  selectedIds: string[];
  // With multiple false, choosing a person calls onToggle straight away.
  multiple: boolean;
  online?: Set<string>;
  onToggle: (userId: string) => void;
}

export function MemberPicker({
  members,
  isPending,
  excludeIds,
  selectedIds,
  multiple,
  online,
  onToggle,
}: MemberPickerProps) {
  const [search, setSearch] = useState("");

  const people = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (members ?? [])
      .filter((member) => !excludeIds.includes(member.userId.id))
      .filter(
        (member) =>
          !term ||
          member.userId.name.toLowerCase().includes(term) ||
          member.userId.email.toLowerCase().includes(term),
      )
      .sort((a, b) => a.userId.name.localeCompare(b.userId.name));
  }, [members, excludeIds, search]);

  return (
    <div>
      <label className="sr-only" htmlFor="member-picker-search">
        Search people
      </label>
      <input
        id="member-picker-search"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by name or email"
        className={inputControlStyles}
      />
      <ul
        className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700"
        aria-label="People"
      >
        {isPending && (
          <li className="px-3 py-4 text-sm text-slate-500">Loading people…</li>
        )}
        {!isPending && people.length === 0 && (
          <li className="px-3 py-4 text-sm text-slate-500">
            {search.trim() ? "No one matches that search." : "No one to add."}
          </li>
        )}
        {people.map((member) => {
          const selected = selectedIds.includes(member.userId.id);
          return (
            <li key={member._id}>
              <button
                type="button"
                onClick={() => onToggle(member.userId.id)}
                aria-pressed={multiple ? selected : undefined}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-600 dark:hover:bg-slate-700/50",
                  selected && "bg-teal-50 dark:bg-teal-900/20",
                )}
              >
                <Avatar
                  name={member.userId.name}
                  seed={member.userId.id}
                  size="sm"
                  online={online ? online.has(member.userId.id) : undefined}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    {member.userId.name}
                  </span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                    {member.userId.email}
                  </span>
                </span>
                {multiple && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded border",
                      selected
                        ? "border-teal-600 bg-teal-600 text-white"
                        : "border-slate-300 dark:border-slate-600",
                    )}
                  >
                    {selected && (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3.5 w-3.5"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
