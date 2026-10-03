import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/auth/auth-context";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MeetingHandover } from "./MeetingHandover";
import {
  DEFAULT_MEETING_CHOICE,
  isMeetingChoiceReady,
  toMeetingChoice,
  type MeetingChoiceState,
} from "./meetingChoice";
import { parseApiError } from "@/lib/apiError";
import type { Role } from "@/api/auth";
import type { Member } from "./api";
import { useChangeMemberRole, useMembers, useRemoveMember } from "./queries";
import { InvitesPanel } from "@/features/invites/InvitesPanel";

const ROLE_OPTIONS: Role[] = ["admin", "manager", "member"];

interface RemoveTarget {
  member: Member;
  isSelf: boolean;
}

function showLastAdminOrGenericError(error: unknown): void {
  const parsed = parseApiError(error);
  if (parsed.code === "LAST_ADMIN") {
    toast.error("Can't do that. An organization needs at least one admin.", {
      description: "Promote another member to admin first.",
    });
    return;
  }
  toast.error(parsed.message);
}

export function MembersPage() {
  const { orgId } = useOrg();
  const { user, refreshMemberships } = useAuth();
  const navigate = useNavigate();
  const canManage = useCan("member:manage");

  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [meetingChoice, setMeetingChoice] = useState<MeetingChoiceState>(
    DEFAULT_MEETING_CHOICE,
  );
  const openRemove = (target: RemoveTarget) => {
    setMeetingChoice(DEFAULT_MEETING_CHOICE);
    setRemoveTarget(target);
  };

  const { data: members, isPending, isError } = useMembers(orgId);
  const changeRole = useChangeMemberRole(orgId);
  const removeMemberMutation = useRemoveMember(orgId);

  const handleRoleChange = (member: Member, role: Role) => {
    if (role === member.role) return;

    changeRole.mutate(
      { memberId: member._id, role },
      {
        onSuccess: () => {
          if (member.userId.id === user?.id) {
            void refreshMemberships();
          }
        },
        onError: showLastAdminOrGenericError,
      },
    );
  };

  const handleRemoveConfirm = async () => {
    if (!removeTarget) return;
    const { member, isSelf } = removeTarget;

    try {
      await removeMemberMutation.mutateAsync({
        memberId: member._id,
        meetings: toMeetingChoice(meetingChoice),
      });
      setRemoveTarget(null);

      if (isSelf) {
        await refreshMemberships();
        navigate("/orgs", { replace: true });
      }
    } catch (error) {
      showLastAdminOrGenericError(error);
      setRemoveTarget(null);
    }
  };

  const roleSelect = (member: Member) =>
    canManage ? (
      <select
        value={member.role}
        onChange={(event) =>
          handleRoleChange(member, event.target.value as Role)
        }
        className="rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      >
        {ROLE_OPTIONS.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    ) : (
      <span className="font-mono text-slate-600 dark:text-slate-300">
        {member.role}
      </span>
    );

  return (
    <div className="bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Members
        </h1>

        {isPending && (
          <div className="mt-6 space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800"
              />
            ))}
          </div>
        )}

        {isError && (
          <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            Couldn&apos;t load members.
          </p>
        )}

        {!isPending && !isError && members && (
          <>
            {/* Mobile: stacked cards */}
            <div className="mt-6 space-y-3 sm:hidden">
              {members.map((member) => {
                const isSelf = member.userId.id === user?.id;
                return (
                  <Card key={member._id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-800 dark:text-slate-100">
                          {member.userId.name}
                          {isSelf && (
                            <span className="ml-2 text-xs text-slate-400">
                              (you)
                            </span>
                          )}
                        </p>
                        <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                          {member.userId.email}
                        </p>
                      </div>
                      {(isSelf || canManage) && (
                        <button
                          type="button"
                          onClick={() => openRemove({ member, isSelf })}
                          className={
                            isSelf
                              ? "shrink-0 text-sm font-medium text-slate-600 hover:underline dark:text-slate-300"
                              : "shrink-0 text-sm font-medium text-red-600 hover:underline dark:text-red-400"
                          }
                        >
                          {isSelf ? "Leave" : "Remove"}
                        </button>
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      {roleSelect(member)}
                      <span className="text-xs text-slate-400">
                        Joined {new Date(member.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Desktop: table */}
            <div className="mt-6 hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Joined</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => {
                    const isSelf = member.userId.id === user?.id;

                    return (
                      <tr
                        key={member._id}
                        className="border-b border-slate-100 last:border-0 dark:border-slate-700"
                      >
                        <td className="px-4 py-3 text-slate-800 dark:text-slate-100">
                          {member.userId.name}
                          {isSelf && (
                            <span className="ml-2 text-xs text-slate-400">
                              (you)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {member.userId.email}
                        </td>
                        <td className="px-4 py-3">{roleSelect(member)}</td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                          {new Date(member.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(isSelf || canManage) && (
                            <button
                              type="button"
                              onClick={() => openRemove({ member, isSelf })}
                              className={
                                isSelf
                                  ? "text-sm font-medium text-slate-600 hover:underline dark:text-slate-300"
                                  : "text-sm font-medium text-red-600 hover:underline dark:text-red-400"
                              }
                            >
                              {isSelf ? "Leave" : "Remove"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="mt-10">
          <InvitesPanel />
        </div>
      </div>

      <Modal
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title={removeTarget?.isSelf ? "Leave organization?" : "Remove member?"}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {removeTarget?.isSelf
            ? "You'll lose access to this organization immediately and be unassigned from its tasks. Your account and other organizations stay as they are. You can rejoin if someone invites you again."
            : `${removeTarget?.member.userId.name} will lose access to this organization immediately and be unassigned from its tasks. Their WorkNest account and other organizations aren't affected, and you can invite them back later.`}
        </p>
        {removeTarget && (
          <MeetingHandover
            orgId={orgId}
            memberId={removeTarget.member._id}
            departingUserId={removeTarget.member.userId.id}
            isSelf={removeTarget.isSelf}
            name={removeTarget.member.userId.name}
            value={meetingChoice}
            onChange={setMeetingChoice}
          />
        )}
        <div className="mt-4 flex justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRemoveTarget(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => void handleRemoveConfirm()}
            loading={removeMemberMutation.isPending}
            disabled={!isMeetingChoiceReady(meetingChoice)}
          >
            {removeTarget?.isSelf ? "Leave" : "Remove"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
