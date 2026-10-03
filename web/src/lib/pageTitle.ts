// The tab title is a page name plus an optional unread count, set from two
// places (the route and the chat), so both go through here.
const SUFFIX = "WorkNest";
let page = "";
let unread = 0;

function apply(): void {
  const base = page ? `${page} · ${SUFFIX}` : SUFFIX;
  const badge = unread > 0 ? `(${unread > 99 ? "99+" : unread}) ` : "";
  document.title = `${badge}${base}`;
}

export function setPageTitle(next: string): void {
  page = next;
  apply();
}

export function setUnreadInTitle(count: number): void {
  unread = count;
  apply();
}
