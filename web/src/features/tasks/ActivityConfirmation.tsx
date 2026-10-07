import { useId, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { InfoButton, InfoPanel } from "@/components/ui/InfoToggle";

interface ActivityConfirmationProps {
  open: boolean;
  title: string;
  message: string;
  summary?: string;
  mentions?: string[];
  confirmLabel: string;
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ActivityConfirmation({
  open,
  title,
  message,
  summary,
  mentions = [],
  confirmLabel,
  isPending = false,
  onCancel,
  onConfirm,
}: ActivityConfirmationProps) {
  const infoId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const close = () => {
    setDetailsOpen(false);
    onCancel();
  };
  const confirm = () => {
    setDetailsOpen(false);
    onConfirm();
  };
  return (
    <Modal open={open} onClose={close} title={title}>
      <div className="space-y-4">
        {summary ? (
          <div>
            <div className="flex items-start gap-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
              <p className="min-w-0 flex-1">{summary}</p>
              <InfoButton
                open={detailsOpen}
                onToggle={() => setDetailsOpen((open) => !open)}
                label="More about this request"
                controls={infoId}
              />
            </div>
            <InfoPanel
              id={infoId}
              open={detailsOpen}
              onClose={() => setDetailsOpen(false)}
            >
              <p>{message}</p>
            </InfoPanel>
          </div>
        ) : (
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        )}
        {mentions.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              Also notifying
            </p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {mentions.map((mention) => (
                <li
                  key={mention}
                  className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                >
                  {mention}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={close}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={confirm}
            loading={isPending}
            disabled={isPending}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
