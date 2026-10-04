import { useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { Member } from "@/features/members/api";
import { inputStyles } from "@/components/ui/Field";
import { cn } from "@/lib/cn";

export type MentionRole = "admin" | "manager" | "member" | "assignee";

export interface ActivityMentions {
  memberIds: string[];
  roles: MentionRole[];
}

interface MentionTextareaProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  members: Member[];
  mentions: ActivityMentions;
  onMentionsChange: (mentions: ActivityMentions) => void;
  placeholder: string;
  rows?: number;
  maxLength?: number;
  // Whole-role mentions (@admin, @manager, @member) are for leads only.
  allowRoleMentions?: boolean;
}

type Suggestion =
  | { kind: "role"; role: MentionRole; label: string; detail: string }
  | { kind: "member"; id: string; label: string; email: string };

const ROLE_SUGGESTIONS: Suggestion[] = [
  { kind: "role", role: "admin", label: "All admins", detail: "@admin" },
  {
    kind: "role",
    role: "manager",
    label: "All managers",
    detail: "@manager",
  },
  { kind: "role", role: "member", label: "All members", detail: "@member" },
  {
    kind: "role",
    role: "assignee",
    label: "Task assignees",
    detail: "@assignee",
  },
];

export function MentionTextarea({
  id,
  value,
  onChange,
  members,
  mentions,
  onMentionsChange,
  placeholder,
  rows = 3,
  maxLength = 2000,
  allowRoleMentions = true,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{
    start: number;
    end: number;
    text: string;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const normalizedQuery = query?.text.toLocaleLowerCase() ?? "";
  const suggestions: Suggestion[] = [
    ...ROLE_SUGGESTIONS.filter(
      (item) =>
        item.kind === "role" &&
        (allowRoleMentions || item.role === "assignee") &&
        `${item.label} ${item.detail}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
    ),
    ...members
      .filter((member) =>
        `${member.userId.name} ${member.userId.email}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
      .map((member) => ({
        kind: "member" as const,
        id: member.userId.id,
        label: member.userId.name,
        email: member.userId.email,
      })),
  ];
  const optionsId = `${id}-mention-options`;

  const syncMentionsWithText = (nextValue: string) => {
    onMentionsChange({
      memberIds: mentions.memberIds.filter((memberId) => {
        const member = members.find((entry) => entry.userId.id === memberId);
        return (
          member &&
          nextValue.includes(`@${member.userId.name} (${member.userId.email})`)
        );
      }),
      roles: mentions.roles.filter((role) =>
        new RegExp(`(^|\\s)@${role}(?=$|\\s|[.,!?;:])`).test(nextValue),
      ),
    });
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    const caret = event.target.selectionStart;
    onChange(nextValue);
    syncMentionsWithText(nextValue);

    const beforeCaret = nextValue.slice(0, caret);
    const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/);
    if (!match) {
      setQuery(null);
      setActiveIndex(0);
      return;
    }
    const start = caret - match[2].length - 1;
    setQuery({ start, end: caret, text: match[2] });
    setActiveIndex(0);
  };

  const selectSuggestion = (suggestion: Suggestion) => {
    if (!query) return;
    const token =
      suggestion.kind === "role"
        ? `@${suggestion.role}`
        : `@${suggestion.label} (${suggestion.email})`;
    const nextValue =
      value.slice(0, query.start) + token + " " + value.slice(query.end);
    const caret = query.start + token.length + 1;
    onChange(nextValue);
    onMentionsChange({
      memberIds:
        suggestion.kind === "member"
          ? [...new Set([...mentions.memberIds, suggestion.id])]
          : mentions.memberIds,
      roles:
        suggestion.kind === "role"
          ? [...new Set([...mentions.roles, suggestion.role])]
          : mentions.roles,
    });
    setQuery(null);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!query || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        (index) => (index - 1 + suggestions.length) % suggestions.length,
      );
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      setQuery(null);
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        id={id}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => window.setTimeout(() => setQuery(null), 120)}
        maxLength={maxLength}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={query !== null && suggestions.length > 0}
        aria-controls={query ? optionsId : undefined}
        className={inputStyles}
      />
      {query && suggestions.length > 0 && (
        <div
          id={optionsId}
          role="listbox"
          aria-label="Mention a person or group"
          className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        >
          {suggestions.map((suggestion, index) => {
            const key =
              suggestion.kind === "role"
                ? `role-${suggestion.role}`
                : `member-${suggestion.id}`;
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(suggestion)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left",
                  activeIndex === index
                    ? "bg-teal-50 dark:bg-slate-700"
                    : "hover:bg-slate-50 dark:hover:bg-slate-700/70",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    {suggestion.label}
                  </span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                    {suggestion.kind === "role"
                      ? suggestion.detail
                      : suggestion.email}
                  </span>
                </span>
                {suggestion.kind === "role" && (
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                    Group
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
