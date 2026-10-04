import { createContext, useContext } from "react";

export const FeedbackContext = createContext<{
  // Opens the feedback form. `from` is the page the person was on.
  openFeedback: (from?: string) => void;
} | null>(null);

export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("useFeedback needs a FeedbackProvider");
  return value;
}
