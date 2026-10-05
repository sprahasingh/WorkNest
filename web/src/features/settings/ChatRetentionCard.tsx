import { useId, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { inputControlStyles } from "@/components/ui/Field";
import { parseApiError } from "@/lib/apiError";
import { useUpdateOrg } from "@/features/org/queries";
import type { Organization } from "@/features/org/api";
import { retentionPhrase } from "./retention";
import { InfoButton, InfoPanel } from "@/components/ui/InfoToggle";
import { PasswordInput } from "@/components/ui/PasswordInput";

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
  const [currentPassword, setCurrentPassword] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const infoId = useId();

  const apply = () => {
    update.mutate(
      {
        currentPassword,
        chatRetentionDays:
          choice === "forever" ? null : (Number(choice) as 90 | 180 | 365),
      },
      {
        onSuccess: () => {
          setConfirming(false);
          setCurrentPassword("");
          toast.success(
            choice === "forever"
              ? "Chat messages will be kept"
              : "Chat retention updated",
          );
        },
        onError: (error) => {
          setConfirming(false);
          setCurrentPassword("");
          toast.error(parseApiError(error).message);
        },
      },
    );
  };

  const save = () => (choice === "forever" ? apply() : setConfirming(true));

  if (!canEdit) {
    return (
      <div id="chat-history" className="scroll-mt-24">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-slate-800 dark:text-slate-100">
            Chat history
          </h3>
          <InfoButton
            open={infoOpen}
            onToggle={() => setInfoOpen((open) => !open)}
            label="About chat history retention"
            controls={infoId}
          />
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {saved === "forever"
            ? "Messages are kept forever."
            : `Messages are kept for ${retentionPhrase(org.chatRetentionDays)}.`}
        </p>
        <InfoPanel
          id={infoId}
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
        >
          Older messages and their attached files are deleted automatically
          according to this organization-wide limit. Admins can change the limit
          in Organization settings.
        </InfoPanel>
      </div>
    );
  }

  return (
    <div id="chat-history" className="scroll-mt-24">
      <div className="flex items-center gap-2">
        <h3 className="font-medium text-slate-800 dark:text-slate-100">
          Chat history
        </h3>
        <InfoButton
          open={infoOpen}
          onToggle={() => setInfoOpen((open) => !open)}
          label="About chat history retention"
          controls={infoId}
        />
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {saved === "forever"
          ? "Messages are kept forever."
          : `Messages are kept for ${retentionPhrase(org.chatRetentionDays)}.`}
      </p>
      <InfoPanel id={infoId} open={infoOpen} onClose={() => setInfoOpen(false)}>
        Choose how long messages in Messages are kept. Older messages and their
        attached files are deleted automatically. The limit applies to everyone
        in the organization, and members can see it in Messages and Settings.
      </InfoPanel>
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
          disabled={choice === saved || !currentPassword}
          loading={update.isPending && !confirming}
        >
          Save
        </Button>
      </div>
      {choice !== saved && (
        <div className="mt-4 max-w-sm">
          <label
            htmlFor="retention-current-password"
            className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Current password (required to save)
          </label>
          <PasswordInput
            id="retention-current-password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className={inputControlStyles}
            required
          />
        </div>
      )}

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
          <Button
            variant="danger"
            onClick={apply}
            loading={update.isPending}
            disabled={!currentPassword}
          >
            Delete old messages
          </Button>
        </div>
      </Modal>
    </div>
  );
}
