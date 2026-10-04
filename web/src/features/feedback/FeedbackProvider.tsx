import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FeedbackContext } from "./feedbackContext";
import { FeedbackModal } from "./FeedbackModal";
import { feedbackEnabledQuery } from "./queries";

// Keeps the feedback form above the page, so it stays open when the menu that
// opened it closes.
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ from?: string } | null>(null);
  const queryClient = useQueryClient();
  // Look it up once the app is idle, so the form opens already knowing.
  useEffect(() => {
    void queryClient.prefetchQuery(feedbackEnabledQuery);
  }, [queryClient]);
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
