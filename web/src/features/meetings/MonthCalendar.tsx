import { cn } from "@/lib/cn";
import type { Meeting } from "./api";
import { monthGrid, sameDay } from "./meetingUtils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface MonthCalendarProps {
  month: Date;
  meetings: Meeting[];
  selected: Date | null;
  onSelect: (day: Date) => void;
  onMonthChange: (month: Date) => void;
}

function Chevron({ direction }: { direction: "left" | "right" }) {
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
      <polyline
        points={direction === "left" ? "15 18 9 12 15 6" : "9 18 15 12 9 6"}
      />
    </svg>
  );
}

export function MonthCalendar({
  month,
  meetings,
  selected,
  onSelect,
  onMonthChange,
}: MonthCalendarProps) {
  const days = monthGrid(month);
  const today = new Date();
  const shift = (delta: number) =>
    onMonthChange(new Date(month.getFullYear(), month.getMonth() + delta, 1));

  const navButton =
    "flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:text-slate-400 dark:hover:bg-slate-700";

  return (
    <div>
      <div className="flex items-center justify-between pb-3">
        <h2
          className="text-base font-semibold text-slate-900 dark:text-slate-50"
          aria-live="polite"
        >
          {month.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              onMonthChange(new Date(today.getFullYear(), today.getMonth(), 1))
            }
            className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className={navButton}
          >
            <Chevron direction="left" />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className={navButton}
          >
            <Chevron direction="right" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
        {WEEKDAYS.map((day) => (
          <div key={day} className="pb-2">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 dark:border-slate-700 dark:bg-slate-700">
        {days.map((day) => {
          const inMonth = day.getMonth() === month.getMonth();
          const dayMeetings = meetings.filter((meeting) => {
            const start = new Date(meeting.startsAt);
            const end = new Date(meeting.endsAt);
            const dayStart = new Date(
              day.getFullYear(),
              day.getMonth(),
              day.getDate(),
            );
            const dayEnd = new Date(dayStart.getTime() + 86_400_000);
            return start < dayEnd && end > dayStart;
          });
          const active = dayMeetings.filter((m) => !m.cancelledAt);
          const isToday = sameDay(day, today);
          const isSelected = selected !== null && sameDay(day, selected);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelect(day)}
              aria-pressed={isSelected}
              aria-label={`${day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}, ${active.length} meeting${active.length === 1 ? "" : "s"}`}
              className={cn(
                "flex min-h-14 flex-col items-center gap-1 bg-white p-1.5 text-sm transition-colors hover:bg-slate-50 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-600 sm:min-h-20 sm:items-start dark:bg-slate-800 dark:hover:bg-slate-700/60",
                !inMonth && "bg-slate-50 text-slate-400 dark:bg-slate-800/50",
                isSelected && "!bg-teal-50 dark:!bg-teal-900/30",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                  isToday
                    ? "bg-teal-600 text-white"
                    : inMonth
                      ? "text-slate-700 dark:text-slate-200"
                      : "text-slate-500 dark:text-slate-400",
                )}
              >
                {day.getDate()}
              </span>
              <span className="hidden w-full flex-col gap-0.5 sm:flex">
                {active.slice(0, 2).map((meeting) => (
                  <span
                    key={meeting.id}
                    className="truncate rounded bg-teal-100 px-1 py-0.5 text-left text-[11px] font-medium leading-tight text-teal-800 dark:bg-teal-900/50 dark:text-teal-200"
                  >
                    {new Date(meeting.startsAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    {meeting.title}
                  </span>
                ))}
                {active.length > 2 && (
                  <span className="px-1 text-left text-[11px] text-slate-500">
                    +{active.length - 2} more
                  </span>
                )}
              </span>
              {active.length > 0 && (
                <span className="flex gap-0.5 sm:hidden" aria-hidden="true">
                  {active.slice(0, 3).map((meeting) => (
                    <span
                      key={meeting.id}
                      className="h-1.5 w-1.5 rounded-full bg-teal-600"
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
