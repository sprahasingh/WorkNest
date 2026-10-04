import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Field, inputControlStyles } from "@/components/ui/Field";
import { cn } from "@/lib/cn";
import { parseApiError } from "@/lib/apiError";
import type { Meeting, Rsvp, Scope } from "./api";
import {
  useCancelMeeting,
  useProposalActions,
  useProposeTime,
  useRespondToMeeting,
  useUpdateMeeting,
} from "./queries";
import {
  describeTiming,
  downloadIcs,
  formatLongDate,
  formatTimeRange,
  fromInputs,
  meetingPhase,
  REPEAT_LABEL,
  RSVP_LABEL,
  timeZoneName,
  toDateInput,
  toTimeInput,
} from "./meetingUtils";

const RSVP_DOT: Record<Rsvp, string> = {
  accepted: "bg-emerald-500",
  tentative: "bg-amber-400",
  declined: "bg-red-500",
  pending: "bg-slate-300 dark:bg-slate-600",
};

interface MeetingDetailModalProps {
  meeting: Meeting | null;
  isLoading: boolean;
  isError: boolean;
  now: number;
  orgId: string;
  onClose: () => void;
  onEdit: (meeting: Meeting) => void;
}

export function MeetingDetailModal(props: MeetingDetailModalProps) {
  const open = props.meeting !== null || props.isLoading || props.isError;
  return (
    <Modal
      open={open}
      onClose={props.onClose}
      title={props.meeting?.title ?? "Meeting"}
      size="lg"
    >
      {props.meeting ? (
        <MeetingDetail
          key={props.meeting.id}
          {...props}
          meeting={props.meeting}
        />
      ) : props.isError ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This meeting isn't available. It may have been removed, or you're not
          invited.
        </p>
      ) : (
        <p className="text-sm text-slate-500">Loading…</p>
      )}
    </Modal>
  );
}

function MeetingDetail({
  meeting,
  now,
  orgId,
  onClose,
  onEdit,
}: MeetingDetailModalProps & { meeting: Meeting }) {
  const respond = useRespondToMeeting(orgId);
  const cancel = useCancelMeeting(orgId);
  const update = useUpdateMeeting(orgId, meeting.id);
  const propose = useProposeTime(orgId, meeting.id);
  const { accept, dismiss } = useProposalActions(orgId, meeting.id);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelScope, setCancelScope] = useState<Scope>("this");
  const [replyToAll, setReplyToAll] = useState(false);
  const [proposing, setProposing] = useState(false);
  const proposalDefaults = new Date(meeting.startsAt);
  const [proposalDate, setProposalDate] = useState(
    toDateInput(proposalDefaults),
  );
  const [proposalStart, setProposalStart] = useState(
    toTimeInput(proposalDefaults),
  );
  const [proposalEnd, setProposalEnd] = useState(
    toTimeInput(new Date(meeting.endsAt)),
  );
  const [proposalNote, setProposalNote] = useState("");
  // Invitees are only sent their own suggestion, so any there is theirs.
  const myProposal = meeting.isOrganizer ? undefined : meeting.proposals[0];
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(meeting.notes);

  const phase = meetingPhase(meeting, now);
  const finished = phase === "ended" || phase === "cancelled";
  const canRespond = !meeting.isOrganizer && !finished && meeting.myResponse;
  const fail = (error: unknown) => toast.error(parseApiError(error).message);

  const counts = meeting.attendees.reduce(
    (total, attendee) => ({
      ...total,
      [attendee.response]: total[attendee.response] + 1,
    }),
    { accepted: 0, tentative: 0, declined: 0, pending: 0 } as Record<
      Rsvp,
      number
    >,
  );

  const copyLink = () => {
    if (!meeting.joinUrl) return;
    void navigator.clipboard
      ?.writeText(meeting.joinUrl)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Couldn't copy the link"));
  };

  const sectionTitle =
    "text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-semibold",
              phase === "live" &&
                "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
              phase === "soon" &&
                "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
              phase === "upcoming" &&
                "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
              phase === "ended" &&
                "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
              phase === "cancelled" &&
                "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
            )}
          >
            {describeTiming(meeting, now)}
          </span>
        </div>
        <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-100">
          {formatLongDate(meeting.startsAt)}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {formatTimeRange(meeting.startsAt, meeting.endsAt)}{" "}
          <span className="text-slate-500 dark:text-slate-400">
            ({timeZoneName()})
          </span>
        </p>
        {meeting.location && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="text-slate-500 dark:text-slate-400">Where: </span>
            {meeting.location}
          </p>
        )}
        {meeting.series?.frequency && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="text-slate-500 dark:text-slate-400">
              Repeats:{" "}
            </span>
            {REPEAT_LABEL[meeting.series.frequency].toLowerCase()}
            {meeting.series.index && meeting.series.count
              ? ` · ${meeting.series.index} of ${meeting.series.count}`
              : ""}
          </p>
        )}
        {meeting.link &&
          (meeting.link.projectName || meeting.link.taskTitle) && (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="text-slate-500 dark:text-slate-400">
                About:{" "}
              </span>
              <Link
                to={`/orgs/${orgId}/projects/${meeting.link.projectId}${
                  meeting.link.taskId ? `?task=${meeting.link.taskId}` : ""
                }`}
                className="font-medium text-teal-700 hover:underline dark:text-teal-400"
              >
                {meeting.link.taskTitle
                  ? `${meeting.link.projectName ? `${meeting.link.projectName} / ` : ""}${meeting.link.taskTitle}`
                  : meeting.link.projectName}
              </Link>
            </p>
          )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {meeting.joinUrl && !finished ? (
          <>
            <a
              href={meeting.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold",
                phase === "live" || phase === "soon"
                  ? "bg-teal-600 text-white hover:bg-teal-700"
                  : "border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700",
              )}
            >
              Join meeting
            </a>
            <Button variant="secondary" onClick={copyLink}>
              Copy link
            </Button>
          </>
        ) : !finished && !meeting.location ? (
          <p className="text-sm text-slate-500">
            No join link or location was added.
          </p>
        ) : null}
        {phase !== "cancelled" && (
          <Button variant="ghost" onClick={() => downloadIcs(meeting)}>
            Add to calendar
          </Button>
        )}
      </div>

      {canRespond && (
        <section aria-labelledby="rsvp-title">
          <h3 id="rsvp-title" className={sectionTitle}>
            Your reply
          </h3>
          <div className="mt-2 inline-flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
            {(
              [
                ["accepted", "Accept"],
                ["tentative", "Maybe"],
                ["declined", "Decline"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={meeting.myResponse === value}
                disabled={respond.isPending}
                onClick={() =>
                  respond.mutate(
                    {
                      meetingId: meeting.id,
                      response: value,
                      scope: replyToAll ? "all" : "this",
                    },
                    { onError: fail },
                  )
                }
                className={cn(
                  "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600",
                  meeting.myResponse === value
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-50"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {meeting.series && (
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={replyToAll}
                onChange={(event) => setReplyToAll(event.target.checked)}
                className="accent-teal-600"
              />
              Use this reply for all upcoming meetings in the series
            </label>
          )}

          <div className="mt-3">
            {myProposal ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
                You suggested{" "}
                {formatTimeRange(myProposal.startsAt, myProposal.endsAt)} on{" "}
                {new Date(myProposal.startsAt).toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
                . Waiting for the organizer.{" "}
                <button
                  type="button"
                  className="font-medium text-teal-700 hover:underline dark:text-teal-400"
                  onClick={() =>
                    dismiss.mutate(myProposal.userId, { onError: fail })
                  }
                >
                  Withdraw
                </button>
              </p>
            ) : proposing ? (
              <form
                className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                onSubmit={(event) => {
                  event.preventDefault();
                  const starts = fromInputs(proposalDate, proposalStart);
                  const ends = fromInputs(proposalDate, proposalEnd);
                  if (!(ends > starts)) {
                    toast.error("The end time must be after the start time.");
                    return;
                  }
                  propose.mutate(
                    {
                      startsAt: starts.toISOString(),
                      endsAt: ends.toISOString(),
                      note: proposalNote.trim() || undefined,
                    },
                    {
                      onSuccess: () => {
                        setProposing(false);
                        toast.success("Suggestion sent to the organizer");
                      },
                      onError: fail,
                    },
                  );
                }}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Date" htmlFor="proposal-date">
                    <input
                      id="proposal-date"
                      type="date"
                      value={proposalDate}
                      onChange={(event) => setProposalDate(event.target.value)}
                      className={cn(inputControlStyles, "mt-1")}
                    />
                  </Field>
                  <Field label="Starts" htmlFor="proposal-start">
                    <input
                      id="proposal-start"
                      type="time"
                      value={proposalStart}
                      onChange={(event) => setProposalStart(event.target.value)}
                      className={cn(inputControlStyles, "mt-1")}
                    />
                  </Field>
                  <Field label="Ends" htmlFor="proposal-end">
                    <input
                      id="proposal-end"
                      type="time"
                      value={proposalEnd}
                      onChange={(event) => setProposalEnd(event.target.value)}
                      className={cn(inputControlStyles, "mt-1")}
                    />
                  </Field>
                </div>
                <Field label="Note (optional)" htmlFor="proposal-note">
                  <input
                    id="proposal-note"
                    value={proposalNote}
                    maxLength={500}
                    onChange={(event) => setProposalNote(event.target.value)}
                    placeholder="e.g. I have a clash at 2"
                    className={cn(inputControlStyles, "mt-1")}
                  />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setProposing(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" loading={propose.isPending}>
                    Send suggestion
                  </Button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setProposing(true)}
                className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
              >
                Suggest another time
              </button>
            )}
          </div>
        </section>
      )}

      {meeting.isOrganizer && meeting.proposals.length > 0 && !finished && (
        <section aria-labelledby="proposals-title">
          <h3 id="proposals-title" className={sectionTitle}>
            Suggested times · {meeting.proposals.length}
          </h3>
          <ul className="mt-2 space-y-2">
            {meeting.proposals.map((proposal) => (
              <li
                key={proposal.userId}
                className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-900/20"
              >
                <p className="font-medium text-slate-800 dark:text-slate-100">
                  {proposal.name} suggested{" "}
                  {new Date(proposal.startsAt).toLocaleDateString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                  , {formatTimeRange(proposal.startsAt, proposal.endsAt)}
                </p>
                {proposal.note && (
                  <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                    "{proposal.note}"
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    loading={accept.isPending}
                    onClick={() =>
                      accept.mutate(proposal.userId, {
                        onSuccess: () =>
                          toast.success(
                            "Meeting moved. Everyone will be asked to reply again.",
                          ),
                        onError: fail,
                      })
                    }
                  >
                    Move the meeting here
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={dismiss.isPending}
                    onClick={() =>
                      dismiss.mutate(proposal.userId, { onError: fail })
                    }
                  >
                    Keep the original time
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {meeting.agenda && (
        <section aria-labelledby="agenda-title">
          <h3 id="agenda-title" className={sectionTitle}>
            Agenda
          </h3>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200">
            {meeting.agenda}
          </p>
        </section>
      )}

      <section aria-labelledby="people-title">
        <h3 id="people-title" className={sectionTitle}>
          People · {meeting.attendees.length}
        </h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {counts.accepted} accepted · {counts.tentative} maybe ·{" "}
          {counts.declined} declined · {counts.pending} no reply
        </p>
        <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-700">
          {meeting.attendees.map((attendee) => (
            <li key={attendee.userId} className="flex items-center gap-3 py-2">
              <Avatar name={attendee.name} seed={attendee.userId} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  {attendee.name}
                  {attendee.userId === meeting.organizer.id && (
                    <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      Organizer
                    </span>
                  )}
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-2 w-2 rounded-full",
                    RSVP_DOT[attendee.response],
                  )}
                />
                {attendee.userId === meeting.organizer.id
                  ? "Accepted"
                  : RSVP_LABEL[attendee.response]}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {(meeting.isOrganizer || meeting.notes) && phase !== "cancelled" && (
        <section aria-labelledby="notes-title">
          <div className="flex items-center justify-between">
            <h3 id="notes-title" className={sectionTitle}>
              Notes
            </h3>
            {meeting.isOrganizer && !editingNotes && (
              <button
                type="button"
                onClick={() => setEditingNotes(true)}
                className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
              >
                {meeting.notes ? "Edit notes" : "Add notes"}
              </button>
            )}
          </div>
          {editingNotes ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={notes}
                rows={5}
                maxLength={8000}
                onChange={(event) => setNotes(event.target.value)}
                aria-label="Meeting notes"
                placeholder="Decisions, action items, links…"
                className={cn(inputControlStyles, "resize-y")}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setNotes(meeting.notes);
                    setEditingNotes(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  loading={update.isPending}
                  onClick={() =>
                    update.mutate(
                      { notes },
                      {
                        onSuccess: () => {
                          setEditingNotes(false);
                          toast.success("Notes saved");
                        },
                        onError: fail,
                      },
                    )
                  }
                >
                  Save notes
                </Button>
              </div>
            </div>
          ) : meeting.notes ? (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200">
              {meeting.notes}
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
              No notes yet.
            </p>
          )}
        </section>
      )}

      {meeting.isOrganizer && phase !== "cancelled" && (
        <div className="border-t border-slate-100 pt-4 dark:border-slate-700">
          {confirmCancel ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Cancel this meeting? Everyone invited will be notified.
              </p>
              {meeting.series && (
                <div className="flex flex-col gap-2 text-sm text-slate-700 dark:text-slate-200">
                  {(
                    [
                      ["this", "Just this meeting"],
                      ["all", "This and all upcoming ones"],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="cancel-scope"
                        checked={cancelScope === value}
                        onChange={() => setCancelScope(value)}
                        className="accent-teal-600"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setConfirmCancel(false)}
                >
                  Keep it
                </Button>
                <Button
                  variant="danger"
                  loading={cancel.isPending}
                  onClick={() =>
                    cancel.mutate(
                      { meetingId: meeting.id, scope: cancelScope },
                      {
                        onSuccess: () => {
                          toast.success("Meeting cancelled");
                          onClose();
                        },
                        onError: fail,
                      },
                    )
                  }
                >
                  Cancel meeting
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap justify-between gap-2">
              {phase !== "ended" ? (
                <Button variant="secondary" onClick={() => onEdit(meeting)}>
                  Edit meeting
                </Button>
              ) : (
                <span />
              )}
              <Button
                variant="ghost"
                className="text-red-600! dark:text-red-400!"
                onClick={() => setConfirmCancel(true)}
              >
                Cancel meeting
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
