import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useOrgDetails } from "@/features/org/queries";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import { useCreateInvite, useInvites, useRevokeInvite } from "./queries";

const inviteFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email"),
  role: z.enum(["admin", "manager", "member"]),
});

type InviteFormValues = z.infer<typeof inviteFormSchema>;

const INVITE_FIELDS = ["email", "role"] as const;

interface RevealedInvite {
  email: string;
  url: string;
}

export function InvitesPanel() {
  const { orgId } = useOrg();
  const navigate = useNavigate();
  const canManage = useCan("invite:manage");

  const [formError, setFormError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: org } = useOrgDetails(orgId);
  const { data: invites, isPending, isError } = useInvites(orgId);
  const createInvite = useCreateInvite(orgId);
  const revokeInvite = useRevokeInvite(orgId);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { role: "member" },
  });

  const onSubmit = async (values: InviteFormValues) => {
    setFormError(null);
    try {
      const { inviteUrl } = await createInvite.mutateAsync(values);
      setRevealed({ email: values.email, url: inviteUrl });
      reset({ email: "", role: "member" });
    } catch (error) {
      const parsed = parseApiError(error);

      if (parsed.code === "SEAT_LIMIT_REACHED") {
        toast.error("No seats remaining", {
          description: "Upgrade your plan to invite more people.",
          action: {
            label: "Settings",
            onClick: () => navigate(`/orgs/${orgId}/settings`),
          },
        });
        return;
      }

      if (parsed.code === "ALREADY_MEMBER") {
        setError("email", { message: parsed.message });
        return;
      }

      if (Object.keys(parsed.fieldErrors).length === 0) {
        setFormError(parsed.message);
        return;
      }

      const unmatched = applyFieldErrors(
        parsed.fieldErrors,
        INVITE_FIELDS,
        setError,
      );
      if (unmatched.length > 0) {
        setFormError(unmatched.join(" "));
      }
    }
  };

  const handleCopy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (inviteId: string) => {
    try {
      await revokeInvite.mutateAsync(inviteId);
    } catch (error) {
      const parsed = parseApiError(error);
      toast.error(parsed.message);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-800">Invites</h2>

      {org && (
        <div className="rounded-lg bg-white p-4 shadow">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">Seats used</span>
            <span className="text-slate-500">
              {org.seatsUsed} / {org.seatLimit}
            </span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-slate-200">
            <div
              className="h-2 rounded-full bg-slate-700"
              style={{
                width: `${Math.min(100, (org.seatsUsed / org.seatLimit) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {canManage && (
        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          noValidate
          className="space-y-4 rounded-lg bg-white p-6 shadow"
        >
          <h2 className="font-medium text-slate-800">Invite someone</h2>

          {formError && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}

          <div className="flex gap-3">
            <div className="flex-1">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                {...register("email")}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="role"
                className="block text-sm font-medium text-slate-700"
              >
                Role
              </label>
              <select
                id="role"
                {...register("role")}
                className="mt-1 rounded border border-slate-300 px-3 py-2"
              >
                <option value="member">Member</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSubmitting ? "Sending…" : "Send invite"}
          </button>

          {revealed && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-800">
                Invite link for {revealed.email}
              </p>
              <p className="mt-1 text-xs text-amber-700">
                This link is shown once. Only its hash is stored, so it
                can&apos;t be displayed again — copy it now, or revoke and send
                a new invite later if it&apos;s lost.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  readOnly
                  value={revealed.url}
                  className="flex-1 rounded border border-amber-300 bg-white px-2 py-1 text-xs"
                  onFocus={(event) => event.target.select()}
                />
                <button
                  type="button"
                  onClick={() => void handleCopy(revealed.url)}
                  className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      <div className="rounded-lg bg-white shadow">
        <h2 className="border-b border-slate-200 px-4 py-3 font-medium text-slate-800">
          Pending invites
        </h2>

        {isPending && (
          <div className="space-y-2 p-4">
            {[0, 1].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-slate-200" />
            ))}
          </div>
        )}

        {isError && (
          <p className="p-4 text-sm text-red-600">
            Couldn&apos;t load invites.
          </p>
        )}

        {!isPending && !isError && invites?.length === 0 && (
          <p className="p-4 text-sm text-slate-500">No pending invites.</p>
        )}

        {!isPending && !isError && invites && invites.length > 0 && (
          <table className="w-full text-left text-sm">
            <tbody>
              {invites.map((invite) => (
                <tr
                  key={invite._id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-800">{invite.email}</td>
                  <td className="px-4 py-3 font-mono text-slate-500">
                    {invite.role}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    Expires {new Date(invite.expiresAt).toLocaleDateString()}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void handleRevoke(invite._id)}
                        className="text-sm font-medium text-red-600 hover:underline"
                      >
                        Revoke
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
