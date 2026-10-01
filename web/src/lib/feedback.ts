export const FEEDBACK_EMAIL = "spraha.worknest@gmail.com";

export function feedbackMailto(
  fromPath?: string,
  sender?: { name?: string; email?: string } | null,
): string {
  const subject = "WorkNest feedback";
  const name = sender?.name?.trim();
  const email = sender?.email?.trim();
  const identity = name && email ? `${name} (${email})` : name || email;
  const source =
    identity ||
    (fromPath === "/" ? "Landing page (not signed in)" : "WorkNest");
  const page = fromPath && fromPath !== "/" ? `\nPage: ${fromPath}` : "";
  const body = `\n\n---\nSent from: ${source}${page}`;
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
