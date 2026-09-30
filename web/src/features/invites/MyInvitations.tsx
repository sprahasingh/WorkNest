import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { MyInvite } from "@/api/invites";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { parseApiError } from "@/lib/apiError";
import { formatFullTime, formatRelativeTime } from "@/lib/time";
import { useAcceptMyInvite, useDeclineMyInvite } from "./myInvites";

const ROLE_LABELS = { admin: "Admin", manager: "Manager", member: "Member" };

function OrgInitial({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-sm font-bold text-teal-800 dark:bg-teal-900/50 dark:text-teal-300"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

// Join or decline invitations to other organizations, without needing the
// invite link. Joining opens the new organization.
export function MyInvitations({
  invites,
  onJoined,
  className,
}: {
  invites: MyInvite[];
  onJoined?: () => void;
  className?: string;
}) {
  const navigate = useNavigate();
  const acceptInvite = useAcceptMyInvite();
  const declineInvite = useDeclineMyInvite();
  const [busy, setBusy] = useState<{
    id: string;
    action: "join" | "decline";
  }>();

  const join = async (invite: MyInvite) => {
    setBusy({ id: invite._id, action: "join" });
    try {
      await acceptInvite.mutateAsync(invite._id);
      toast.success(`You joined ${invite.organization.name}`);
      onJoined?.();
      void navigate(`/orgs/${invite.organization.id}/dashboard`);
    } catch (error) {
      toast.error(parseApiError(error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const decline = async (invite: MyInvite) => {
    setBusy({ id: invite._id, action: "decline" });
    try {
      await declineInvite.mutateAsync(invite._id);
      toast(`Declined the invite to ${invite.organization.name}`);
    } catch (error) {
      toast.error(parseApiError(error).message);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <ul className={cn("space-y-2", className)}>
      {invites.map((invite) => {
        const isBusy = busy?.id === invite._id;
        return (
          <li
            key={invite._id}
            className="rounded-xl border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-900/60 dark:bg-teal-950/30"
          >
            <div className="flex items-start gap-3">
              <OrgInitial name={invite.organization.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900 dark:text-slate-50">
                  {invite.organization.name}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {invite.invitedBy
                    ? `${invite.invitedBy.name} invited you`
                    : "You're invited"}{" "}
                  to join as {ROLE_LABELS[invite.role].toLowerCase()}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  <time
                    dateTime={invite.createdAt}
                    title={formatFullTime(invite.createdAt)}
                  >
                    {formatRelativeTime(invite.createdAt)}
                  </time>
                </p>
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isBusy}
                loading={isBusy && busy.action === "decline"}
                onClick={() => void decline(invite)}
              >
                Decline
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isBusy}
                loading={isBusy && busy.action === "join"}
                onClick={() => void join(invite)}
              >
                Join
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
