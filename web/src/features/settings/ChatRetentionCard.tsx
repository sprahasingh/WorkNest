import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { inputControlStyles } from "@/components/ui/Field";
import { parseApiError } from "@/lib/apiError";
import { useUpdateOrg } from "@/features/org/queries";
import type { Organization } from "@/features/org/api";
import { retentionPhrase } from "./retention";

type Retention = "forever" | "90" | "180" | "365";

const OPTIONS: { value: Retention; label: string }[] = [
  { value: "forever", label: "Keep forever" },
  { value: "365", label: "Delete after 1 year" },
  { value: "180", label: "Delete after 6 months" },
  { value: "90", label: "Delete after 90 days" },
];

const toValue = (days: number | null): Retention =>
  days === null ? "forever" : (String(days) as Retention);

// Admins decide how long chat history is kept, for everyone in the
// organization. Nothing is deleted unless a limit is chosen here. Members see
// the same card as a plain statement of what the admins chose.
export function ChatRetentionCard({
  orgId,
  org,
  canEdit,
}: {
  orgId: string;
  org: Organization;
  canEdit: boolean;
}) {
  const update = useUpdateOrg(orgId);
  const saved = toValue(org.chatRetentionDays ?? null);
  const [choice, setChoice] = useState<Retention>(saved);
  const [confirming, setConfirming] = useState(false);

  const apply = () => {
    update.mutate(
      {
        chatRetentionDays:
          choice === "forever" ? null : (Number(choice) as 90 | 180 | 365),
      },
      {
        onSuccess: () => {
          setConfirming(false);
          toast.success(
            choice === "forever"
              ? "Chat messages will be kept"
              : "Chat retention updated",
          );
        },
        onError: (error) => {
          setConfirming(false);
          toast.error(parseApiError(error).message);
        },
      },
    );
  };

  const save = () => (choice === "forever" ? apply() : setConfirming(true));

  if (!canEdit) {
    const limited = org.chatRetentionDays != null;
    return (
      <Card id="chat-history" className="scroll-mt-24">
        <h2 className="font-medium text-slate-800 dark:text-slate-100">
          Chat history
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {limited
            ? "Older messages and the files attached to them are deleted automatically, for everyone in the organization."
            : "Messages are not deleted automatically."}
        </p>
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <div className="min-w-0">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Messages are kept{" "}
              {limited
                ? `for ${retentionPhrase(org.chatRetentionDays)}`
                : retentionPhrase(null)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Set by your organization's admins. Only an admin can change it.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card id="chat-history" className="scroll-mt-24">
      <h2 className="font-medium text-slate-800 dark:text-slate-100">
        Chat history
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Choose how long messages in Messages are kept. Older messages and the
        files attached to them are deleted automatically. This applies to
        everyone in the organization, and members can see the limit in Messages
        and in their Settings.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="chat-retention">
          How long to keep chat messages
        </label>
        <select
          id="chat-retention"
          value={choice}
          onChange={(event) => setChoice(event.target.value as Retention)}
          className={`${inputControlStyles} w-auto min-w-52`}
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          onClick={save}
          disabled={choice === saved}
          loading={update.isPending && !confirming}
        >
          Save
        </Button>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete old messages?"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Every message and file older than{" "}
          {OPTIONS.find((o) => o.value === choice)?.label.replace(
            "Delete after ",
            "",
          )}{" "}
          will be deleted for everyone, including anything already older than
          that. It starts within the hour and can't be undone.
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={apply} loading={update.isPending}>
            Delete old messages
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
