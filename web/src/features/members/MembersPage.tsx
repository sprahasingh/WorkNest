import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/auth/auth-context";
import { Modal } from "@/components/Modal";
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
    toast.error("Can't do that — an organization needs at least one admin", {
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
      await removeMemberMutation.mutateAsync(member._id);
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

  return (
    <div className="min-h-screen bg-slate-100 px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-bold text-slate-800">Members</h1>

        <div className="mt-6 overflow-x-auto rounded-lg bg-white shadow">
          {isPending && (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded bg-slate-200"
                />
              ))}
            </div>
          )}

          {isError && (
            <p className="p-4 text-sm text-red-600">
              Couldn&apos;t load members.
            </p>
          )}

          {!isPending && !isError && members && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
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
                    <tr key={member._id} className="border-b border-slate-100">
                      <td className="px-4 py-3 text-slate-800">
                        {member.userId.name}
                        {isSelf && (
                          <span className="ml-2 text-xs text-slate-400">
                            (you)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {member.userId.email}
                      </td>
                      <td className="px-4 py-3">
                        {canManage ? (
                          <select
                            value={member.role}
                            onChange={(event) =>
                              handleRoleChange(
                                member,
                                event.target.value as Role,
                              )
                            }
                            className="rounded border border-slate-300 px-2 py-1"
                          >
                            {ROLE_OPTIONS.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-mono text-slate-600">
                            {member.role}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(member.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(isSelf || canManage) && (
                          <button
                            type="button"
                            onClick={() => setRemoveTarget({ member, isSelf })}
                            className={
                              isSelf
                                ? "text-sm font-medium text-slate-600 hover:underline"
                                : "text-sm font-medium text-red-600 hover:underline"
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
          )}
        </div>

        <div className="mt-10">
          <InvitesPanel />
        </div>
      </div>

      <Modal
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title={removeTarget?.isSelf ? "Leave organization?" : "Remove member?"}
      >
        <p className="text-sm text-slate-600">
          {removeTarget?.isSelf
            ? "You'll lose access to this organization immediately. You can only rejoin if someone invites you again."
            : `"${removeTarget?.member.userId.name}" will lose access to this organization immediately.`}
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setRemoveTarget(null)}
            className="rounded px-4 py-2 text-sm font-medium text-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleRemoveConfirm()}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white"
          >
            {removeTarget?.isSelf ? "Leave" : "Remove"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
