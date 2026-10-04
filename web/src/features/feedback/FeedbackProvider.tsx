import { useMemo, useState, type ReactNode } from "react";
import { FeedbackContext } from "./feedbackContext";
import { FeedbackModal } from "./FeedbackModal";

// Keeps the feedback form above the page, so it stays open when the menu that
// opened it closes.
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ from?: string } | null>(null);
  const value = useMemo(
    () => ({ openFeedback: (from?: string) => setState({ from }) }),
    [],
  );
  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <FeedbackModal
        open={state !== null}
        from={state?.from}
        onClose={() => setState(null)}
      />
    </FeedbackContext.Provider>
  );
}
