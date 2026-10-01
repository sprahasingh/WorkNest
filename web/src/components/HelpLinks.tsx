import { Link } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { feedbackMailto } from "@/lib/feedback";

const linkStyles =
  "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200";

function FeedbackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// "How to use" and "Send feedback", shown at the bottom of the app sidebar
// and the landing page's phone menu.
export function HelpLinks({
  from,
  onNavigate,
}: {
  // The page to return to from the guide, and to mention in feedback.
  from?: string;
  onNavigate?: () => void;
}) {
  const auth = useAuth();
  const sender = auth.status === "authenticated" ? auth.user : null;

  return (
    <div className="space-y-0.5">
      <Link
        to="/how-to-use"
        state={from ? { from } : undefined}
        onClick={onNavigate}
        className={linkStyles}
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold dark:border-slate-600">
          ?
        </span>
        How to use
      </Link>
      <a
        href={feedbackMailto(from, sender)}
        onClick={onNavigate}
        className={linkStyles}
      >
        <FeedbackIcon />
        Send feedback
      </a>
    </div>
  );
}
