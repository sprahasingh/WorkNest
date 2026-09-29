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

            <Button type="submit" disabled={isSubmitting} loading={isSubmitting}>
              {isSubmitting ? "Sending…" : "Send invite"}
            </Button>

            {revealed && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/10">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  Invite link for {revealed.email}
                </p>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  This link is shown once. Only its hash is stored, so it
                  can&apos;t be displayed again — copy it now, or revoke and
                  send a new invite later if it&apos;s lost.
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    readOnly
                    value={revealed.url}
                    className="flex-1 rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs dark:border-amber-900/40 dark:bg-slate-800 dark:text-slate-200"
                    onFocus={(event) => event.target.select()}
                  />
                  <button
                    type="button"
                    onClick={() => void handleCopy(revealed.url)}
                    className="shrink-0 rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}
          </form>
        </Card>
      )}

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
                    <span className="font-mono">{invite.role}</span> ·
                    Expires{" "}
                    {new Date(invite.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void handleRevoke(invite._id)}
                    disabled={
                      revokeInvite.isPending &&
                      revokeInvite.variables === invite._id
                    }
                    className="self-start text-sm font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400 sm:self-auto"
                  >
                    {revokeInvite.isPending &&
                    revokeInvite.variables === invite._id
                      ? "Revoking…"
                      : "Revoke"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
