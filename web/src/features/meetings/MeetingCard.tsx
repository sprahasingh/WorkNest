import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import type { Meeting } from "./api";
import {
  describeTiming,
  formatTimeRange,
  meetingPhase,
  RSVP_LABEL,
} from "./meetingUtils";

const PHASE_STYLES = {
  live: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  soon: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  upcoming: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  ended: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
} as const;

interface MeetingCardProps {
  meeting: Meeting;
  now: number;
  onOpen: () => void;
}

export function MeetingCard({ meeting, now, onOpen }: MeetingCardProps) {
  const phase = meetingPhase(meeting, now);
  const inactive = phase === "cancelled" || phase === "ended";
  const needsReply = meeting.myResponse === "pending" && !inactive;
  const shown = meeting.attendees.slice(0, 4);
  const extra = meeting.attendees.length - shown.length;

  return (
    <div
      className={cn(
        "flex items-stretch gap-3 rounded-xl border bg-white p-3 shadow-sm transition-colors dark:bg-slate-800 sm:gap-4 sm:p-4",
        phase === "live"
          ? "border-emerald-300 dark:border-emerald-700"
          : "border-slate-200 dark:border-slate-700",
        inactive && "opacity-75",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-stretch gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-600 sm:gap-4"
      >
        <span
          aria-hidden="true"
          className={cn(
            "w-1 shrink-0 rounded-full",
            phase === "live"
              ? "bg-emerald-500"
              : phase === "cancelled"
                ? "bg-red-400"
                : inactive
                  ? "bg-slate-300 dark:bg-slate-600"
                  : "bg-teal-500",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "truncate text-sm font-semibold text-slate-900 dark:text-slate-50",
                phase === "cancelled" && "line-through",
              )}
            >
              {meeting.title}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                PHASE_STYLES[phase],
              )}
            >
              {phase === "upcoming"
                ? "Scheduled"
                : describeTiming(meeting, now)}
            </span>
            {needsReply && (
              <span className="rounded-full bg-teal-600 px-2 py-0.5 text-xs font-semibold text-white">
                Reply needed
              </span>
            )}
          </span>
          <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">
            {formatTimeRange(meeting.startsAt, meeting.endsAt)}
            {meeting.location && (
              <span className="text-slate-500 dark:text-slate-400">
                {" "}
                · {meeting.location}
              </span>
            )}
            {meeting.series?.frequency && (
              <span
                className="text-slate-500 dark:text-slate-400"
                title={`Repeats ${meeting.series.frequency}`}
              >
                {" "}
                · ↻ {meeting.series.frequency}
              </span>
            )}
            {meeting.link?.taskTitle || meeting.link?.projectName ? (
              <span className="text-slate-500 dark:text-slate-400">
                {" "}
                · {meeting.link.taskTitle ?? meeting.link.projectName}
              </span>
            ) : null}
          </span>
          <span className="mt-2 flex items-center gap-2">
            <span className="flex -space-x-1" aria-hidden="true">
              {shown.map((attendee) => (
                <Avatar
                  key={attendee.userId}
                  name={attendee.name}
                  seed={attendee.userId}
                  size="sm"
                  className="rounded-full ring-2 ring-white dark:ring-slate-800"
                />
              ))}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {extra > 0 && `+${extra} · `}
              {meeting.attendees.length}{" "}
              {meeting.attendees.length === 1 ? "person" : "people"}
              {meeting.isOrganizer
                ? " · You're organizing"
                : ` · ${meeting.organizer.name}`}
              {meeting.myResponse &&
                !meeting.isOrganizer &&
                meeting.myResponse !== "pending" &&
                ` · ${RSVP_LABEL[meeting.myResponse]}`}
            </span>
          </span>
        </span>
      </button>

      {meeting.joinUrl && !inactive && (
        <a
          href={meeting.joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "hidden h-9 shrink-0 items-center self-center rounded-lg px-3.5 text-sm font-semibold sm:inline-flex",
            phase === "live" || phase === "soon"
              ? "bg-teal-600 text-white hover:bg-teal-700"
              : "border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700",
          )}
        >
          Join
        </a>
      )}
    </div>
  );
}
