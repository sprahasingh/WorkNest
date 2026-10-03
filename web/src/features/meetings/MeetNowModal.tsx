import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { MemberPicker } from "@/components/MemberPicker";
import { Button } from "@/components/ui/Button";
import { Field, inputStyles } from "@/components/ui/Field";
import { parseApiError } from "@/lib/apiError";
import { useMembers } from "@/features/members/queries";
import { useCreateMeeting } from "./queries";
import { generateJitsiLink } from "./meetingUtils";

interface MeetNowModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  myId: string;
}

export function MeetNowModal(props: MeetNowModalProps) {
  return (
    <Modal open={props.open} onClose={props.onClose} title="Meet now">
      <MeetNowForm {...props} />
    </Modal>
  );
}

// Starts a 30 minute meeting right away: it makes a Jitsi room, invites the
// people chosen (they get a notification) and opens the room in a new tab.
function MeetNowForm({ onClose, orgId, myId }: MeetNowModalProps) {
  const [title, setTitle] = useState("Quick meeting");
  const [selected, setSelected] = useState<string[]>([]);
  const members = useMembers(orgId);
  const create = useCreateMeeting(orgId);

  const everyone = (members.data ?? [])
    .map((member) => member.userId.id)
    .filter((id) => id !== myId);

  const start = () => {
    // Open the tab straight away, as browsers only allow that from a click.
    const tab = window.open("", "_blank");
    const url = generateJitsiLink();
    const startsAt = new Date();
    create.mutate(
      {
        title: title.trim() || "Quick meeting",
        agenda: "",
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
        joinUrl: url,
        location: "",
        attendeeIds: selected,
        projectId: null,
        taskId: null,
      },
      {
        onSuccess: () => {
          if (tab) tab.location.href = url;
          else toast.success("Meeting started", { description: url });
          onClose();
        },
        onError: (error) => {
          tab?.close();
          toast.error(parseApiError(error).message);
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <Field label="Title" htmlFor="meet-now-title">
        <input
          id="meet-now-title"
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          className={inputStyles}
        />
      </Field>

      <div>
        <div className="flex items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-300">
          <span>
            Who should join?{" "}
            <span className="font-normal text-slate-400">
              ({selected.length} selected)
            </span>
          </span>
          <button
            type="button"
            className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
            onClick={() =>
              setSelected(selected.length === everyone.length ? [] : everyone)
            }
          >
            {selected.length === everyone.length && everyone.length > 0
              ? "Clear"
              : "Select everyone"}
          </button>
        </div>
        <div className="mt-2">
          <MemberPicker
            members={members.data}
            isPending={members.isPending}
            excludeIds={[myId]}
            selectedIds={selected}
            multiple
            onToggle={(userId) =>
              setSelected((current) =>
                current.includes(userId)
                  ? current.filter((id) => id !== userId)
                  : [...current, userId],
              )
            }
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-400">
          They're notified straight away. You can also start a meeting from any
          chat with its Meet now button.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={start} loading={create.isPending}>
          Start meeting
        </Button>
      </div>
    </div>
  );
}
