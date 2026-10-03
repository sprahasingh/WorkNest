import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { useMeetings } from "@/features/meetings/queries";
import { formatTimeRange, dayHeading } from "@/features/meetings/meetingUtils";

interface TaskMeetingsProps {
  orgId: string;
  taskId: string;
  onSchedule: () => void;
}

// Meetings linked to this task. Each person only sees the ones they were
// invited to, so the list can differ from one person to the next.
export function TaskMeetings({ orgId, taskId, onSchedule }: TaskMeetingsProps) {
  const upcoming = useMeetings(orgId, "upcoming", { taskId });
  const past = useMeetings(orgId, "past", { taskId });

  const row = (
    meeting: NonNullable<typeof upcoming.data>[number],
    muted = false,
  ) => (
    <li key={meeting.id}>
      <Link
        to={`/orgs/${orgId}/meetings?meeting=${meeting.id}`}
        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40"
      >
        <span className="min-w-0">
          <span
            className={`block truncate text-sm font-medium ${
              muted
                ? "text-slate-500 line-through-none dark:text-slate-400"
                : "text-slate-900 dark:text-slate-50"
            } ${meeting.cancelledAt ? "line-through" : ""}`}
          >
            {meeting.title}
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            {dayHeading(meeting.startsAt)} ·{" "}
            {formatTimeRange(meeting.startsAt, meeting.endsAt)}
            {meeting.cancelledAt ? " · Cancelled" : ""}
          </span>
        </span>
        <span aria-hidden="true" className="text-slate-400">
          ›
        </span>
      </Link>
    </li>
  );

  const loading = upcoming.isPending || past.isPending;
  const none =
    !loading &&
    (upcoming.data?.length ?? 0) === 0 &&
    (past.data?.length ?? 0) === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Meetings about this task. You see the ones you're invited to.
        </p>
        <Button size="sm" onClick={onSchedule}>
          Schedule meeting
        </Button>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {none && (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">
          No meetings linked to this task yet.
        </p>
      )}
      {(upcoming.data?.length ?? 0) > 0 && (
        <section aria-label="Upcoming meetings">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Upcoming
          </h3>
          <ul className="space-y-2">{upcoming.data!.map((m) => row(m))}</ul>
        </section>
      )}
      {(past.data?.length ?? 0) > 0 && (
        <section aria-label="Past meetings">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Past
          </h3>
          <ul className="space-y-2">
            {past.data!.slice(0, 10).map((m) => row(m, true))}
          </ul>
        </section>
      )}
    </div>
  );
}
