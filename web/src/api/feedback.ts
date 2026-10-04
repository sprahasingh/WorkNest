import { apiClient } from "./client";

// Whether feedback can be sent from the app. When it can't, the app shows an
// email link instead.
export async function getFeedbackEnabled(): Promise<boolean> {
  const response = await apiClient.get<{ enabled: boolean }>("/feedback");
  return response.data.enabled;
}

export interface FeedbackInput {
  message: string;
  email?: string;
  page?: string;
  website?: string;
}

export async function sendFeedback(input: FeedbackInput): Promise<void> {
  await apiClient.post("/feedback", input);
}
