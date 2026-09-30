export const FEEDBACK_EMAIL = "sprahasinghwork@gmail.com";

// Opens the person's email app with a feedback message started, noting which
// page they were on so it's easier to follow up.
export function feedbackMailto(fromPath?: string): string {
  const subject = "WorkNest feedback";
  const body = fromPath ? `\n\n---\nSent from: ${fromPath}` : "";
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}${
    body ? `&body=${encodeURIComponent(body)}` : ""
  }`;
}
