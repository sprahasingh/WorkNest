import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";

interface ActivityConfirmationProps {
  open: boolean;
  title: string;
  message: string;
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
  mentions = [],
  confirmLabel,
  isPending = false,
  onCancel,
  onConfirm,
}: ActivityConfirmationProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
          {message}
        </p>
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
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
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
