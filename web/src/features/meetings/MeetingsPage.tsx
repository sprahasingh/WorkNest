import { useEffect, useMemo, useState } from "react";
import {
  useAccountPaused,
  PAUSED_HINT,
} from "@/features/billing/useAccountPaused";
import { useSearchParams } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ViewTabs } from "@/components/ui/ViewTabs";
import { cn } from "@/lib/cn";
import {
  useMarkNotificationsRead,
  useNotifications,
} from "@/features/notifications/queries";
import { useProjects } from "@/features/projects/queries";
import type { Meeting } from "./api";
import { MeetingCard } from "./MeetingCard";
import { MeetingDetailModal } from "./MeetingDetailModal";
import { MeetingFormModal } from "./MeetingFormModal";
import { MeetNowModal } from "./MeetNowModal";
import { MonthCalendar } from "./MonthCalendar";
import {
  useMeeting,
  useMeetings,
  useMeetingsInRange,
  useMeetingSummary,
} from "./queries";
import {
  dayHeading,
  describeTiming,
  meetingPhase,
  monthGrid,
  sameDay,
  useNow,
} from "./meetingUtils";

type Tab = "upcoming" | "past" | "calendar";

function groupByDay(meetings: Meeting[]): [string, Meeting[]][] {
  const groups = new Map<string, Meeting[]>();
  for (const meeting of meetings) {
    const key = new Date(meeting.startsAt).toDateString();
    groups.set(key, [...(groups.get(key) ?? []), meeting]);
  }
  return [...groups.values()].map((items) => [
    dayHeading(items[0].startsAt),
    items,
  ]);
}

export function MeetingsPage() {
  const { orgId } = useOrg();
  const paused = useAccountPaused();
  const { user } = useAuth();
  const myId = user!.id;
  const now = useNow();
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get("meeting");
  // ?project=<id> narrows the lists to meetings about one project.
  const projectFilter = searchParams.get("project");

  const [tab, setTab] = useState<Tab>("upcoming");
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selectedDay, setSelectedDay] = useState<Date | null>(new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [meetNowOpen, setMeetNowOpen] = useState(false);
  const [editing, setEditing] = useState<Meeting | undefined>();
  const [formDate, setFormDate] = useState<Date | null>(null);

  const filter = projectFilter ? { projectId: projectFilter } : {};
  const upcoming = useMeetings(orgId, "upcoming", filter);
  const past = useMeetings(orgId, "past", filter);
  const projects = useProjects(orgId);
  const filterName = projectFilter
    ? projects.data?.projects.find((p) => p._id === projectFilter)?.name
    : null;
  const summary = useMeetingSummary(orgId);

  const grid = useMemo(() => monthGrid(month), [month]);
  const rangeStart = grid[0];
  const rangeEnd = new Date(
    grid[grid.length - 1].getFullYear(),
    grid[grid.length - 1].getMonth(),
    grid[grid.length - 1].getDate() + 1,
  );
  const range = useMeetingsInRange(orgId, rangeStart, rangeEnd);

  const detail = useMeeting(orgId, openId);

  // Opening a meeting counts as reading what the bell said about it.
  const unreadNotifications = useNotifications(orgId, "unread");
  const { mutate: markRead } = useMarkNotificationsRead(orgId);
  useEffect(() => {
    if (!openId || !unreadNotifications.data) return;
    const ids = unreadNotifications.data.notifications
      .filter((n) => n.meetingId === openId)
      .map((n) => n._id);
    if (ids.length > 0) markRead(ids);
  }, [openId, unreadNotifications.data, markRead]);

  const setOpenId = (id: string | null) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set("meeting", id);
        else next.delete("meeting");
        return next;
      },
      { replace: true },
    );

  const startScheduling = (date: Date | null = null) => {
    setEditing(undefined);
    setFormDate(date);
    setFormOpen(true);
  };

  const next = summary.data?.next;
  const nextMeeting =
    next && upcoming.data?.find((meeting) => meeting.id === next.id);
  const pending = summary.data?.pendingInvites ?? 0;

  const listData = tab === "past" ? past : upcoming;
  const rangeMeetings = (range.data ?? []).filter(
    (meeting) => !projectFilter || meeting.link?.projectId === projectFilter,
  );
  const dayMeetings = selectedDay
    ? rangeMeetings.filter((meeting) => {
        const start = new Date(meeting.startsAt);
        const end = new Date(meeting.endsAt);
        const dayStart = new Date(
          selectedDay.getFullYear(),
          selectedDay.getMonth(),
          selectedDay.getDate(),
        );
        return (
          start < new Date(dayStart.getTime() + 86_400_000) && end > dayStart
        );
      })
    : [];

  const renderList = (meetings: Meeting[]) =>
    groupByDay(meetings).map(([heading, items]) => (
      <section key={heading} aria-label={heading} className="mt-6 first:mt-0">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {heading}
        </h2>
        <ul className="space-y-2">
          {items.map((meeting) => (
            <li key={meeting.id}>
              <MeetingCard
                meeting={meeting}
                now={now}
                onOpen={() => setOpenId(meeting.id)}
              />
            </li>
          ))}
        </ul>
      </section>
    ));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Meetings
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Only you and the people invited can see a meeting.
          </p>
        </div>
        <div data-tour="meetings-actions" className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setMeetNowOpen(true)}>
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
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            Meet now
          </Button>
          <Button
            onClick={() => startScheduling(selectedDay)}
            disabled={paused}
            title={paused ? PAUSED_HINT : undefined}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Schedule meeting
          </Button>
        </div>
      </div>

      {projectFilter && (
        <p
          role="status"
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <span>
            Showing meetings about{" "}
            <strong>{filterName ?? "this project"}</strong>
          </span>
          <button
            type="button"
            onClick={() =>
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  next.delete("project");
                  return next;
                },
                { replace: true },
              )
            }
            className="font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            Show all meetings
          </button>
        </p>
      )}

      {nextMeeting && (
        <Card
          className={cn(
            "mt-6 flex flex-wrap items-center justify-between gap-3 p-4",
            meetingPhase(nextMeeting, now) === "live" &&
              "border-emerald-300 dark:border-emerald-700",
          )}
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">
              {meetingPhase(nextMeeting, now) === "live"
                ? "Happening now"
                : "Next up"}
            </p>
            <p className="mt-0.5 truncate text-base font-semibold text-slate-900 dark:text-slate-50">
              {nextMeeting.title}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {describeTiming(nextMeeting, now)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => setOpenId(nextMeeting.id)}
            >
              Details
            </Button>
            {nextMeeting.joinUrl && (
              <a
                href={nextMeeting.joinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
              >
                Join
              </a>
            )}
          </div>
        </Card>
      )}

      <div className="mt-6">
        <div data-tour="meetings-tabs">
          <ViewTabs<Tab>
            label="Meeting views"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "upcoming", label: "Upcoming" },
              { value: "past", label: "Past" },
              { value: "calendar", label: "Calendar" },
            ]}
          />
        </div>
      </div>

      {tab !== "calendar" && pending > 0 && (
        <p
          role="status"
          className="mt-4 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800 dark:bg-teal-900/20 dark:text-teal-200"
        >
          You have {pending} invitation{pending > 1 ? "s" : ""} waiting for a
          reply.
        </p>
      )}

      <div data-tour="meetings-content" className="mt-4">
        {tab === "calendar" ? (
          <div className="space-y-6">
            <MonthCalendar
              month={month}
              meetings={rangeMeetings}
              selected={selectedDay}
              onSelect={setSelectedDay}
              onMonthChange={setMonth}
            />
            {selectedDay && (
              <section aria-label="Selected day">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {selectedDay.toLocaleDateString(undefined, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                    {sameDay(selectedDay, new Date()) && " (today)"}
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startScheduling(selectedDay)}
                  >
                    Schedule on this day
                  </Button>
                </div>
                {range.isPending ? (
                  <p className="text-sm text-slate-500">Loading…</p>
                ) : dayMeetings.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700">
                    Nothing scheduled.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {dayMeetings.map((meeting) => (
                      <li key={meeting.id}>
                        <MeetingCard
                          meeting={meeting}
                          now={now}
                          onOpen={() => setOpenId(meeting.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        ) : listData.isPending ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Loading meetings…
          </p>
        ) : listData.isError ? (
          <p className="py-10 text-center text-sm text-red-600 dark:text-red-400">
            Couldn't load meetings.{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => void listData.refetch()}
            >
              Try again
            </button>
          </p>
        ) : listData.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {tab === "upcoming"
                ? "No upcoming meetings"
                : "No past meetings yet"}
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {tab === "upcoming"
                ? "Schedule one and invite the people who need to be there."
                : "Meetings you attended or that were cancelled show up here."}
            </p>
            {tab === "upcoming" && (
              <Button className="mt-4" onClick={() => startScheduling()}>
                Schedule a meeting
              </Button>
            )}
          </div>
        ) : (
          renderList(listData.data)
        )}
      </div>

      <MeetingDetailModal
        meeting={detail.data ?? null}
        isLoading={openId !== null && detail.isPending}
        isError={openId !== null && detail.isError}
        now={now}
        orgId={orgId}
        onClose={() => setOpenId(null)}
        onEdit={(meeting) => {
          setOpenId(null);
          setEditing(meeting);
          setFormDate(null);
          setFormOpen(true);
        }}
      />

      <MeetNowModal
        open={meetNowOpen}
        onClose={() => setMeetNowOpen(false)}
        orgId={orgId}
        myId={myId}
      />

      <MeetingFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        orgId={orgId}
        myId={myId}
        meeting={editing}
        initialDate={formDate}
        onSaved={(meeting) => setOpenId(meeting.id)}
      />
    </div>
  );
}
