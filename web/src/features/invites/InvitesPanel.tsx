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
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
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
  existingUser: boolean;
  emailSent: boolean;
  inviteUrl?: string;
}

// An invite the admin tried to send while one was already pending.
interface PendingConflict {
  email: string;
  role: InviteFormValues["role"];
  invitedAt: string | null;
}

export function InvitesPanel() {
  const { orgId } = useOrg();
  const navigate = useNavigate();
  const canManage = useCan("invite:manage");

  const [formError, setFormError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedInvite | null>(null);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: org } = useOrgDetails(orgId);
  const { data: invites, isPending, isError } = useInvites(orgId, canManage);
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

  const sendInvite = async (
    values: InviteFormValues,
    replaceExisting = false,
  ) => {
    setFormError(null);
    setConflict(null);
    try {
      const { inviteUrl, existingUser, emailSent } =
        await createInvite.mutateAsync({
          ...values,
          replaceExisting,
        });
      setRevealed({
        email: values.email,
        existingUser,
        emailSent,
        inviteUrl,
      });
      setCopied(false);
      reset({ email: "", role: "member" });
    } catch (error) {
      const parsed = parseApiError(error);

      if (parsed.code === "INVITE_ALREADY_PENDING") {
        const detail = (parsed.details?.[0] ?? {}) as { invitedAt?: string };
        setConflict({
          email: values.email,
          role: values.role,
          invitedAt: detail.invitedAt ?? null,
        });
        return;
      }

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

  const onSubmit = (values: InviteFormValues) => sendInvite(values);

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
      <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">
        Invites
      </h2>

      {org && (
        <Card className="p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Seats used
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {org.seatsUsed} / {org.seatLimit}
            </span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className="h-2 rounded-full bg-teal-600"
              style={{
                width: `${Math.min(100, (org.seatsUsed / org.seatLimit) * 100)}%`,
              }}
            />
          </div>
        </Card>
      )}

      {canManage && (
        <Card>
          <form
            onSubmit={(event) => void handleSubmit(onSubmit)(event)}
            noValidate
            className="space-y-4"
          >
            <h2 className="font-medium text-slate-800 dark:text-slate-100">
              Invite someone
            </h2>

            <ErrorBanner message={formError} />

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1">
                <Field
                  label="Email"
                  htmlFor="email"
                  error={errors.email?.message}
                >
                  <input
                    id="email"
                    type="email"
                    {...register("email")}
                    className={inputStyles}
                  />
                </Field>
              </div>

              <div>
                <Field label="Role" htmlFor="role">
                  <select
                    id="role"
                    {...register("role")}
                    className={cn(inputStyles, "sm:w-36")}
                  >
                    <option value="member">Member</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </Field>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              loading={isSubmitting}
            >
              {isSubmitting ? "Sending…" : "Send invite"}
            </Button>

            {conflict && (
              <div
                role="alert"
                className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
              >
                <p className="font-medium text-slate-800 dark:text-slate-100">
                  {conflict.email} already has a pending invite
                </p>
                <p className="mt-1 text-slate-600 dark:text-slate-300">
                  {conflict.invitedAt
                    ? `Sent ${new Date(conflict.invitedAt).toLocaleDateString()}. `
                    : ""}
                  Send a new invitation if the old email was lost. The old link
                  will stop working, and no extra seat is used.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    loading={isSubmitting || createInvite.isPending}
                    onClick={() =>
                      void sendInvite(
                        { email: conflict.email, role: conflict.role },
                        true,
                      )
                    }
                  >
                    Send new invitation
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConflict(null)}
                  >
                    Keep the old one
                  </Button>
                </div>
              </div>
            )}

            {revealed && (
              <div
                role={revealed.emailSent ? "status" : "alert"}
                className={cn(
                  "rounded-lg border p-3",
                  revealed.emailSent
                    ? "border-teal-200 bg-teal-50 dark:border-teal-900/40 dark:bg-teal-900/10"
                    : "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/10",
                )}
              >
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {revealed.emailSent
                    ? `Invitation emailed to ${revealed.email}`
                    : `Invite created, but email could not be sent to ${revealed.email}`}
                </p>
                {revealed.emailSent && (
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    If it doesn&apos;t arrive, ask them to check their spam or
                    junk folder, then use Send again below.
                  </p>
                )}
                {revealed.existingUser && (
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    They already have a WorkNest account, so the invite is also
                    waiting in their app under the bell.
                  </p>
                )}
                {!revealed.emailSent && revealed.inviteUrl && (
                  <>
                    <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                      Share this one-time link manually. It expires in seven
                      days.
                    </p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <input
                        readOnly
                        aria-label="Invitation link fallback"
                        value={revealed.inviteUrl}
                        className="flex-1 rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs dark:border-amber-900/40 dark:bg-slate-800 dark:text-slate-200"
                        onFocus={(event) => event.target.select()}
                      />
                      <button
                        type="button"
                        onClick={() => void handleCopy(revealed.inviteUrl!)}
                        className="shrink-0 rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
                      >
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </form>
        </Card>
      )}

      {canManage && (
        <Card className="p-0">
          <h2 className="border-b border-slate-200 px-4 py-3 font-medium text-slate-800 dark:border-slate-700 dark:text-slate-100">
            Pending invites
          </h2>

          {isPending && (
            <div className="space-y-2 p-4">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-8 animate-pulse rounded bg-slate-200 dark:bg-slate-700"
                />
              ))}
            </div>
          )}

          {isError && (
            <p className="p-4 text-sm text-red-600 dark:text-red-400">
              Couldn&apos;t load invites.
            </p>
          )}

          {!isPending && !isError && invites?.length === 0 && (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              No pending invites.
            </p>
          )}

          {!isPending && !isError && invites && invites.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {invites.map((invite) => (
                <li
                  key={invite._id}
                  className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-slate-800 dark:text-slate-100">
                      {invite.email}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono">{invite.role}</span> · Expires{" "}
                      {new Date(invite.expiresAt).toLocaleDateString()}
                      {invite.existingUser && " · Has a WorkNest account"}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() =>
                        void sendInvite(
                          { email: invite.email, role: invite.role },
                          true,
                        )
                      }
                      disabled={createInvite.isPending}
                      className="text-sm font-medium text-teal-700 hover:underline disabled:opacity-50 dark:text-teal-400"
                    >
                      Send again
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRevoke(invite._id)}
                      disabled={
                        revokeInvite.isPending &&
                        revokeInvite.variables === invite._id
                      }
                      className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                    >
                      {revokeInvite.isPending &&
                      revokeInvite.variables === invite._id
                        ? "Revoking…"
                        : "Revoke"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
