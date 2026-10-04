import { cn } from "@/lib/cn";
import { inputControlStyles } from "@/components/ui/Field";
import { useMembers } from "./queries";
import { useMeetingImpact } from "./queries";
import type { MeetingChoiceState } from "./meetingChoice";

interface MeetingHandoverProps {
  orgId: string;
  // The membership being ended, and the person it belongs to.
  memberId: string;
  departingUserId: string;
  isSelf: boolean;
  name: string;
  value: MeetingChoiceState;
  onChange: (value: MeetingChoiceState) => void;
}

// Shown when someone is removed (or leaves) while organizing upcoming
// meetings: cancel them, or hand them to someone who stays.
export function MeetingHandover({
  orgId,
  memberId,
  departingUserId,
  isSelf,
  name,
  value,
  onChange,
}: MeetingHandoverProps) {
  const impact = useMeetingImpact(orgId, memberId);
  const members = useMembers(orgId);

  if (!impact.data || impact.data.organizedUpcoming === 0) return null;

  const { organizedUpcoming, meetings } = impact.data;
  const others = (members.data ?? []).filter(
    (member) => member.userId.id !== departingUserId,
  );
  const subject = isSelf ? "You organize" : `${name} organizes`;

  return (
    <fieldset className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <legend className="px-1 text-sm font-medium text-slate-800 dark:text-slate-100">
        Their meetings
      </legend>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {subject} {organizedUpcoming} upcoming{" "}
        {organizedUpcoming === 1 ? "meeting" : "meetings"}
        {meetings && meetings.length > 0 ? ":" : "."}
      </p>
      {meetings && meetings.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-sm text-slate-600 dark:text-slate-300">
          {meetings.slice(0, 5).map((meeting) => (
            <li key={meeting.id}>
              {meeting.title}{" "}
              <span className="text-slate-500 dark:text-slate-400">
                ·{" "}
                {new Date(meeting.startsAt).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </li>
          ))}
          {meetings.length > 5 && <li>and {meetings.length - 5} more</li>}
        </ul>
      )}

      <div className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="meeting-handover"
            checked={value.action === "cancel"}
            onChange={() => onChange({ ...value, action: "cancel" })}
            className="mt-1 accent-teal-600"
          />
          <span>
            Cancel them
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Everyone invited is told they were cancelled.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="meeting-handover"
            checked={value.action === "handover"}
            onChange={() => onChange({ ...value, action: "handover" })}
            className="mt-1 accent-teal-600"
          />
          <span className="min-w-0 flex-1">
            Hand them over to someone
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              They become the organizer, and are told.
            </span>
          </span>
        </label>
        <div className={cn("pl-6", value.action !== "handover" && "hidden")}>
          <label className="sr-only" htmlFor="handover-person">
            New organizer
          </label>
          <select
            id="handover-person"
            value={value.userId}
            onChange={(event) =>
              onChange({ action: "handover", userId: event.target.value })
            }
            className={inputControlStyles}
          >
            <option value="">Choose a person</option>
            {others.map((member) => (
              <option key={member._id} value={member.userId.id}>
                {member.userId.name} ({member.role})
              </option>
            ))}
          </select>
        </div>
      </div>
    </fieldset>
  );
}
