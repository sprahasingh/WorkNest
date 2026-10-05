import { useId, useState } from "react";
import { inputControlStyles } from "@/components/ui/Field";
import { InfoButton, InfoPanel } from "@/components/ui/InfoToggle";
import type { Organization } from "@/features/org/api";
import { retentionPhrase } from "./retention";

type Retention = 90 | 180 | 365 | null;

const OPTIONS: { value: string; label: string }[] = [
  { value: "forever", label: "Keep forever" },
  { value: "365", label: "Delete after 1 year" },
  { value: "180", label: "Delete after 6 months" },
  { value: "90", label: "Delete after 90 days" },
];

export function ChatRetentionCard({
  org,
  canEdit,
  editing,
  value,
  onChange,
}: {
  org: Organization;
  canEdit: boolean;
  editing: boolean;
  value: Retention;
  onChange: (value: Retention) => void;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoId = useId();
  const saved = org.chatRetentionDays ?? null;

  return (
    <div id="chat-history" className="scroll-mt-24">
      <div className="flex items-center gap-1">
        <dt className="text-slate-500 dark:text-slate-400">Chat history</dt>
        <InfoButton
          open={infoOpen}
          onToggle={() => setInfoOpen((open) => !open)}
          label="About chat history retention"
          controls={infoId}
        />
      </div>
      <InfoPanel id={infoId} open={infoOpen} onClose={() => setInfoOpen(false)}>
        Older messages and their attached files are deleted automatically
        according to this organization-wide limit. Members can see the limit in
        Messages and Settings. Only admins can change it.
      </InfoPanel>
      {editing && canEdit ? (
        <label className="mt-1 block">
          <span className="sr-only">How long to keep chat messages</span>
          <select
            aria-label="How long to keep chat messages"
            value={value === null ? "forever" : String(value)}
            onChange={(event) => {
              const next = event.target.value;
              onChange(next === "forever" ? null : (Number(next) as Retention));
            }}
            className={inputControlStyles}
          >
            {OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <dd className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">
          {saved === null ? "Kept forever" : retentionPhrase(saved)}
        </dd>
      )}
    </div>
  );
}
