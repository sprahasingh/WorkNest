import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { useRemoveMember } from "@/features/members/queries";
import { parseApiError } from "@/lib/apiError";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/Modal";
import { MeetingHandover } from "@/features/members/MeetingHandover";
import {
  DEFAULT_MEETING_CHOICE,
  isMeetingChoiceReady,
  toMeetingChoice,
  type MeetingChoiceState,
} from "@/features/members/meetingChoice";
import { InfoButton, InfoPanel } from "@/components/ui/InfoToggle";

// Leaving only ends this membership: the account and any other
// organizations stay as they are.
export function LeaveOrganizationCard({
  orgId,
  orgName,
}: {
  orgId: string;
  orgName: string;
}) {
  const { user, memberships, refreshMemberships } = useAuth();
  const navigate = useNavigate();
  const removeMember = useRemoveMember(orgId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [meetingChoice, setMeetingChoice] = useState<MeetingChoiceState>(
    DEFAULT_MEETING_CHOICE,
  );
  const infoId = useId();

  const membership = memberships?.find((entry) => entry.tenantId.id === orgId);
  if (!membership) return null;

  const handleLeave = async () => {
    try {
      await removeMember.mutateAsync({
        memberId: membership._id,
        meetings: toMeetingChoice(meetingChoice),
      });
      setConfirmOpen(false);
      toast.success(`You left ${orgName}`);
      await refreshMemberships();
      navigate("/orgs", { replace: true });
    } catch (error) {
      setConfirmOpen(false);
      const parsed = parseApiError(error);
      if (parsed.code === "LAST_ADMIN") {
        toast.error("You're the only admin here.", {
          description:
            "Make another member an admin on the Members page first, then you can leave.",
        });
        return;
      }
      toast.error(parsed.message);
    }
  };

  return (
    <Card>
      <h2 className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
        Leave organization
        <InfoButton
          open={infoOpen}
          onToggle={() => setInfoOpen((open) => !open)}
          label="About leaving"
          controls={infoId}
        />
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Stop being a member of {orgName}.
      </p>
      <InfoPanel id={infoId} open={infoOpen} onClose={() => setInfoOpen(false)}>
        You&apos;ll lose access right away and be unassigned from its tasks.
        Your account and other organizations stay as they are, and you can
        rejoin if someone invites you again.
        {membership.role === "admin" &&
          " If you're the only admin, make someone else an admin first."}
      </InfoPanel>
      <Button
        variant="secondary"
        onClick={() => {
          setMeetingChoice(DEFAULT_MEETING_CHOICE);
          setConfirmOpen(true);
        }}
        className="mt-4 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-950/20"
      >
        Leave {orgName}
      </Button>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Leave ${orgName}?`}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          You&apos;ll lose access to {orgName} immediately and be unassigned
          from its tasks. Your account and other organizations stay as they are.
        </p>
        {confirmOpen && user && (
          <MeetingHandover
            orgId={orgId}
            memberId={membership._id}
            departingUserId={user.id}
            isSelf
            name="You"
            value={meetingChoice}
            onChange={setMeetingChoice}
          />
        )}
        <div className="mt-4 flex justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => void handleLeave()}
            loading={removeMember.isPending}
            disabled={!isMeetingChoiceReady(meetingChoice)}
          >
            Leave
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
