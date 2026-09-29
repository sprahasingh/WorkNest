import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white p-6 shadow-xl sm:max-w-md sm:rounded-2xl dark:bg-slate-800"
      >
        <h2 id="modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {title}
        </h2>
        <div className="mt-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
