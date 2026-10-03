import { useEffect } from "react";
import { useLocation } from "react-router";
import { setPageTitle } from "@/lib/pageTitle";

const TITLES: [RegExp, string][] = [
  [/^\/$/, ""],
  [/^\/how-to-use/, "How to use"],
  [/^\/login/, "Log in"],
  [/^\/register/, "Create your account"],
  [/^\/forgot-password/, "Forgot password"],
  [/^\/reset-password/, "Reset password"],
  [/^\/verify-email-change/, "Confirm email change"],
  [/^\/verify-email/, "Verify your email"],
  [/^\/invite\//, "Join an organization"],
  [/^\/orgs\/?$/, "Your organizations"],
  [/^\/orgs\/[^/]+\/dashboard/, "Dashboard"],
  [/^\/orgs\/[^/]+\/projects\/[^/]+/, "Project board"],
  [/^\/orgs\/[^/]+\/projects/, "Projects"],
  [/^\/orgs\/[^/]+\/messages/, "Messages"],
  [/^\/orgs\/[^/]+\/meetings/, "Meetings"],
  [/^\/orgs\/[^/]+\/members/, "Members"],
  [/^\/orgs\/[^/]+\/audit/, "Audit log"],
  [/^\/orgs\/[^/]+\/settings/, "Settings"],
];

// Two small things that make moving around feel right: each page gets its own
// tab title, and a new page starts at the top instead of keeping the scroll
// position of the last one. Query changes (opening a task, say) leave the
// scroll alone.
export function RouteEffects() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    const match = TITLES.find(([pattern]) => pattern.test(pathname));
    setPageTitle(match ? match[1] : "Page not found");
  }, [pathname]);

  useEffect(() => {
    if (hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, hash]);

  return null;
}
