import { Link } from "react-router";
import { useOrgDetails } from "@/features/org/queries";
import { retentionPhrase } from "@/features/settings/retention";

// A quiet line at the bottom of the chat list telling everyone how long
// messages are kept. It only appears when an admin has set a limit, because
// that is the case that affects what people can look back on.
export function RetentionNote({ orgId }: { orgId: string }) {
  const { data: org } = useOrgDetails(orgId);
  const days = org?.chatRetentionDays;
  if (!days) return null;

  return (
    <Link
      to={`/orgs/${orgId}/settings#chat-history`}
      className="mx-2 mb-2 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 hover:border-teal-300 hover:bg-teal-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-teal-700 dark:hover:bg-teal-950/30"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span className="min-w-0">
        <span className="block text-slate-700 dark:text-slate-200">
          Messages are kept for {retentionPhrase(days)}
        </span>
        <span className="block text-slate-500 dark:text-slate-400">
          Set by your organization's admins. Older messages and their files are
          deleted for everyone.
        </span>
      </span>
    </Link>
  );
}
