import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { MemberPicker } from "@/components/MemberPicker";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Field, inputStyles } from "@/components/ui/Field";
import { parseApiError } from "@/lib/apiError";
import { useMembers } from "@/features/members/queries";
import { useProjects } from "@/features/projects/queries";
import type { Meeting, Recurrence, Scope } from "./api";
import {
  useCreateMeeting,
  useMeetings,
  useProjectTaskOptions,
  useUpdateMeeting,
} from "./queries";
import {
  formatTimeRange,
  fromInputs,
  generateJitsiLink,
  MAX_REPEATS,
  nextHalfHour,
  repeatDates,
  REPEAT_LABEL,
  toDateInput,
  toTimeInput,
} from "./meetingUtils";

const startHasPassed = (startsAt: Date) =>
  startsAt.getTime() < Date.now() - 5 * 60_000;

const DURATIONS = [
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "45 min", minutes: 45 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
];

interface MeetingFormModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  myId: string;
  // Present when editing; absent when scheduling a new meeting.
  meeting?: Meeting;
  // Pre-selected day when scheduling from the calendar.
  initialDate?: Date | null;
  // A project or task the meeting should start out linked to.
  preset?: { projectId: string | null; taskId: string | null };
  onSaved: (meeting: Meeting) => void;
}

export function MeetingFormModal(props: MeetingFormModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.meeting ? "Edit meeting" : "Schedule a meeting"}
      size="lg"
    >
      <MeetingForm {...props} />
    </Modal>
  );
}

function MeetingForm({
  onClose,
  orgId,
  myId,
  meeting,
  initialDate,
  preset,
  onSaved,
}: MeetingFormModalProps) {
  const defaults = useMemo(() => {
    if (meeting) {
      const start = new Date(meeting.startsAt);
      const end = new Date(meeting.endsAt);
      return { start, end };
    }
    const base = nextHalfHour();
    const start = initialDate
      ? new Date(
          initialDate.getFullYear(),
          initialDate.getMonth(),
          initialDate.getDate(),
          base.getHours(),
          base.getMinutes(),
        )
      : base;
    return { start, end: new Date(start.getTime() + 30 * 60_000) };
  }, [meeting, initialDate]);

  const [title, setTitle] = useState(meeting?.title ?? "");
  const [date, setDate] = useState(toDateInput(defaults.start));
  const [startTime, setStartTime] = useState(toTimeInput(defaults.start));
  const [endTime, setEndTime] = useState(toTimeInput(defaults.end));
  const [joinUrl, setJoinUrl] = useState(meeting?.joinUrl ?? "");
  const [location, setLocation] = useState(meeting?.location ?? "");
  const [agenda, setAgenda] = useState(meeting?.agenda ?? "");
  const [attendeeIds, setAttendeeIds] = useState<string[]>(
    meeting
      ? meeting.attendees
          .map((a) => a.userId)
          .filter((id) => id !== meeting.organizer.id)
      : [],
  );
  const [projectId, setProjectId] = useState(
    meeting?.link?.projectId ?? preset?.projectId ?? "",
  );
  const [taskId, setTaskId] = useState(
    meeting?.link?.taskId ?? preset?.taskId ?? "",
  );
  const [repeat, setRepeat] = useState<"none" | Recurrence>("none");
  const [endMode, setEndMode] = useState<"count" | "until">("count");
  const [repeatCount, setRepeatCount] = useState(8);
  const [repeatUntil, setRepeatUntil] = useState(() => {
    const later = new Date(defaults.start);
    later.setDate(later.getDate() + 56);
    return toDateInput(later);
  });
  const [editScope, setEditScope] = useState<Scope>("this");
  const [error, setError] = useState<string | null>(null);

  const projects = useProjects(orgId);
  const taskOptions = useProjectTaskOptions(orgId, projectId || null);
  const members = useMembers(orgId);
  const mine = useMeetings(orgId, "upcoming");
  const create = useCreateMeeting(orgId);
  const update = useUpdateMeeting(orgId, meeting?.id ?? "");
  const saving = create.isPending || update.isPending;

  const startsAt = fromInputs(date, startTime);
  const sameDayEnd = fromInputs(date, endTime);
  // An end time before the start means the meeting runs past midnight.
  const endsNextDay = sameDayEnd <= startsAt;
  const endsAt = endsNextDay
    ? new Date(sameDayEnd.getTime() + 24 * 60 * 60_000)
    : sameDayEnd;
  const validTimes =
    !Number.isNaN(startsAt.getTime()) &&
    !Number.isNaN(endsAt.getTime()) &&
    endsAt > startsAt;

  const repeatEnd =
    endMode === "count"
      ? { count: Math.max(2, Math.min(MAX_REPEATS, repeatCount || 2)) }
      : { until: new Date(`${repeatUntil}T23:59:59`) };
  const repeatStarts =
    repeat !== "none" && validTimes && !Number.isNaN(startsAt.getTime())
      ? repeatDates(startsAt, repeat, repeatEnd)
      : [];

  const conflict = validTimes
    ? mine.data?.find(
        (other) =>
          other.id !== meeting?.id &&
          !other.cancelledAt &&
          other.myResponse !== "declined" &&
          new Date(other.startsAt) < endsAt &&
          new Date(other.endsAt) > startsAt,
      )
    : undefined;

  const everyoneIds = (members.data ?? [])
    .map((member) => member.userId.id)
    .filter((id) => id !== myId);
  const nameById = new Map(
    (members.data ?? []).map((m) => [m.userId.id, m.userId.name]),
  );

  const setStart = (value: string) => {
    // Moving the start keeps the meeting the same length.
    const length = validTimes
      ? endsAt.getTime() - startsAt.getTime()
      : 30 * 60_000;
    const nextStart = fromInputs(date, value);
    setStartTime(value);
    if (!Number.isNaN(nextStart.getTime())) {
      setEndTime(toTimeInput(new Date(nextStart.getTime() + length)));
    }
  };

  const setDuration = (minutes: number) => {
    if (Number.isNaN(startsAt.getTime())) return;
    setEndTime(toTimeInput(new Date(startsAt.getTime() + minutes * 60_000)));
  };

  const toggle = (userId: string) =>
    setAttendeeIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );

  const submit = () => {
    setError(null);
    if (!title.trim()) return setError("Give the meeting a title.");
    if (!validTimes)
      return setError("The end time must be after the start time.");
    if (!meeting && startHasPassed(startsAt)) {
      return setError("Pick a start time that hasn't passed yet.");
    }
    const link = joinUrl.trim();
    if (link && !/^https?:\/\//i.test(link)) {
      return setError("The join link should start with http:// or https://");
    }

    if (!meeting && repeat !== "none" && repeatStarts.length < 2) {
      return setError("Pick an end date that gives at least two meetings.");
    }

    const input = {
      title: title.trim(),
      agenda: agenda.trim(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      joinUrl: link,
      location: location.trim(),
      attendeeIds,
      projectId: projectId || null,
      taskId: taskId || null,
    };
    const handlers = {
      onSuccess: (saved: Meeting) => {
        toast.success(meeting ? "Meeting updated" : "Meeting scheduled");
        onSaved(saved);
        onClose();
      },
      onError: (failure: unknown) => setError(parseApiError(failure).message),
    };
    if (meeting) update.mutate({ ...input, scope: editScope }, handlers);
    else {
      create.mutate(
        {
          ...input,
          ...(repeat !== "none"
            ? {
                repeat: {
                  freq: repeat,
                  starts: repeatStarts.map((d) => d.toISOString()),
                },
              }
            : {}),
        },
        handlers,
      );
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      noValidate
    >
      <ErrorBanner message={error} />

      {meeting?.series && (
        <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <legend className="px-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            This meeting repeats. Apply changes to
          </legend>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:gap-6">
            {(
              [
                ["this", "This meeting only"],
                ["all", "This and all upcoming ones"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"
              >
                <input
                  type="radio"
                  name="edit-scope"
                  checked={editScope === value}
                  onChange={() => setEditScope(value)}
                  className="accent-teal-600"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <Field label="Title" htmlFor="meeting-title">
        <input
          id="meeting-title"
          value={title}
          maxLength={120}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Sprint planning"
          className={inputStyles}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date" htmlFor="meeting-date">
          <input
            id="meeting-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={inputStyles}
          />
        </Field>
        <Field label="Starts" htmlFor="meeting-start">
          <input
            id="meeting-start"
            type="time"
            value={startTime}
            onChange={(event) => setStart(event.target.value)}
            className={inputStyles}
          />
        </Field>
        <Field label="Ends" htmlFor="meeting-end">
          <input
            id="meeting-end"
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            className={inputStyles}
          />
        </Field>
      </div>

      <div className="-mt-2 flex flex-wrap items-center gap-1.5">
        {DURATIONS.map((duration) => {
          const active =
            validTimes &&
            endsAt.getTime() - startsAt.getTime() === duration.minutes * 60_000;
          return (
            <button
              key={duration.minutes}
              type="button"
              onClick={() => setDuration(duration.minutes)}
              aria-pressed={active}
              className={
                active
                  ? "rounded-full bg-teal-600 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              }
            >
              {duration.label}
            </button>
          );
        })}
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {endsNextDay && validTimes
            ? "Ends the next day · times are in your time zone"
            : "Times are in your time zone"}
        </span>
      </div>

      {conflict && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200"
        >
          Heads up: you already have "{conflict.title}" at{" "}
          {formatTimeRange(conflict.startsAt, conflict.endsAt)}.
        </p>
      )}

      {!meeting && (
        <div className="space-y-3">
          <Field label="Repeat" htmlFor="meeting-repeat">
            <select
              id="meeting-repeat"
              value={repeat}
              onChange={(event) =>
                setRepeat(event.target.value as "none" | Recurrence)
              }
              className={inputStyles}
            >
              <option value="none">Does not repeat</option>
              {(Object.keys(REPEAT_LABEL) as Recurrence[]).map((freq) => (
                <option key={freq} value={freq}>
                  {REPEAT_LABEL[freq]}
                </option>
              ))}
            </select>
          </Field>
          {repeat !== "none" && (
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-700 dark:text-slate-200">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="repeat-end"
                    checked={endMode === "count"}
                    onChange={() => setEndMode("count")}
                    className="accent-teal-600"
                  />
                  Ends after
                  <input
                    type="number"
                    min={2}
                    max={MAX_REPEATS}
                    value={repeatCount}
                    onFocus={() => setEndMode("count")}
                    onChange={(event) =>
                      setRepeatCount(Number(event.target.value))
                    }
                    aria-label="Number of meetings"
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                  meetings
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="repeat-end"
                    checked={endMode === "until"}
                    onChange={() => setEndMode("until")}
                    className="accent-teal-600"
                  />
                  Ends on
                  <input
                    type="date"
                    value={repeatUntil}
                    onFocus={() => setEndMode("until")}
                    onChange={(event) => setRepeatUntil(event.target.value)}
                    aria-label="Last date"
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                </label>
              </div>
              <p
                className="mt-2 text-xs text-slate-500 dark:text-slate-400"
                role="status"
              >
                {repeatStarts.length >= 2
                  ? `${repeatStarts.length} meetings, the last on ${repeatStarts[
                      repeatStarts.length - 1
                    ].toLocaleDateString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}.${repeatStarts.length >= MAX_REPEATS ? ` Repeats are limited to ${MAX_REPEATS}.` : ""}`
                  : "That end date gives fewer than two meetings."}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project (optional)" htmlFor="meeting-project">
          <select
            id="meeting-project"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setTaskId("");
            }}
            className={inputStyles}
          >
            <option value="">No project</option>
            {projectId &&
              !projects.data?.projects.some((p) => p._id === projectId) && (
                <option value={projectId}>
                  {meeting?.link?.projectName ?? "Linked project"}
                </option>
              )}
            {projects.data?.projects.map((project) => (
              <option key={project._id} value={project._id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Task (optional)" htmlFor="meeting-task">
          <select
            id="meeting-task"
            value={taskId}
            disabled={!projectId}
            onChange={(event) => setTaskId(event.target.value)}
            className={inputStyles}
          >
            <option value="">
              {projectId ? "No specific task" : "Choose a project first"}
            </option>
            {taskId && !taskOptions.data?.some((t) => t._id === taskId) && (
              <option value={taskId}>
                {meeting?.link?.taskTitle ?? "Linked task"}
              </option>
            )}
            {taskOptions.data?.map((task) => (
              <option key={task._id} value={task._id}>
                {task.title}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label="Join link"
        htmlFor="meeting-link"
        hint="Paste a Zoom, Google Meet or Teams link, or create a free Jitsi room."
      >
        <div className="mt-1 flex gap-2">
          <input
            id="meeting-link"
            type="url"
            value={joinUrl}
            onChange={(event) => setJoinUrl(event.target.value)}
            placeholder="https://"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setJoinUrl(generateJitsiLink())}
          >
            Create room
          </Button>
        </div>
      </Field>

      <Field label="Location (optional)" htmlFor="meeting-location">
        <input
          id="meeting-location"
          value={location}
          maxLength={200}
          onChange={(event) => setLocation(event.target.value)}
          placeholder="e.g. Boardroom 2"
          className={inputStyles}
        />
      </Field>

      <Field label="Agenda (optional)" htmlFor="meeting-agenda">
        <textarea
          id="meeting-agenda"
          rows={3}
          maxLength={4000}
          value={agenda}
          onChange={(event) => setAgenda(event.target.value)}
          placeholder="What should people prepare or expect?"
          className={`${inputStyles} resize-y`}
        />
      </Field>

      <fieldset>
        <legend className="flex w-full items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-300">
          <span>
            Invite people{" "}
            <span className="font-normal text-slate-500 dark:text-slate-400">
              ({attendeeIds.length} selected)
            </span>
          </span>
          <span className="flex gap-3 text-xs">
            <button
              type="button"
              className="font-medium text-teal-700 hover:underline dark:text-teal-400"
              onClick={() => setAttendeeIds(everyoneIds)}
            >
              Select everyone
            </button>
            {attendeeIds.length > 0 && (
              <button
                type="button"
                className="font-medium text-slate-500 hover:underline"
                onClick={() => setAttendeeIds([])}
              >
                Clear
              </button>
            )}
          </span>
        </legend>
        {attendeeIds.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Invited">
            {attendeeIds.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  aria-label={`Remove ${nameById.get(id) ?? "person"}`}
                  className="flex items-center gap-1 rounded-full bg-teal-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-teal-800 hover:bg-teal-100 dark:bg-teal-900/40 dark:text-teal-200"
                >
                  {nameById.get(id) ?? "Former member"}
                  <span aria-hidden="true" className="text-sm leading-none">
                    ×
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <MemberPicker
            members={members.data}
            isPending={members.isPending}
            excludeIds={[myId]}
            selectedIds={attendeeIds}
            multiple
            onToggle={toggle}
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          Only you and the people you invite can see this meeting.
        </p>
      </fieldset>

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-700">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {meeting ? "Save changes" : "Schedule meeting"}
        </Button>
      </div>
    </form>
  );
}
