import { queryOptions } from "@tanstack/react-query";
import { getFeedbackEnabled } from "@/api/feedback";

// Whether the server can send feedback. Shared so the app can look it up in
// the background and the form already knows the answer when it opens.
export const feedbackEnabledQuery = queryOptions({
  queryKey: ["feedback", "enabled"],
  queryFn: getFeedbackEnabled,
  staleTime: 30 * 60 * 1000,
});
