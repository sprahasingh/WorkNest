import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { createOrg } from "@/api/orgs";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLink } from "@/components/BrandLink";
import { useMyInvites } from "@/features/invites/myInvites";
import { MyInvitations } from "@/features/invites/MyInvitations";

const createOrgFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters")
    .max(80),
});

type CreateOrgFormValues = z.infer<typeof createOrgFormSchema>;

const CREATE_ORG_FIELDS = ["name"] as const;

export function OrgPicker() {
  const { memberships, logout, isLoggingOut, refreshMemberships } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const invites = useMyInvites().data ?? [];
  const location = useLocation();
  const lostOrgName = (location.state as { lostOrgName?: unknown } | null)
    ?.lostOrgName;

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrgFormValues>({
    resolver: zodResolver(createOrgFormSchema),
  });

  const onSubmit = async (values: CreateOrgFormValues) => {
    setFormError(null);
    try {
      const { organization } = await createOrg(values);
      await refreshMemberships();
      reset();
      navigate(`/orgs/${organization.id}/dashboard`);
    } catch (error) {
      const parsed = parseApiError(error);
      if (Object.keys(parsed.fieldErrors).length === 0) {
        setFormError(parsed.message);
        return;
      }
      const unmatched = applyFieldErrors(
        parsed.fieldErrors,
        CREATE_ORG_FIELDS,
        setError,
      );
      if (unmatched.length > 0) {
        setFormError(unmatched.join(" "));
      }
    }
  };

  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-12 dark:bg-slate-950 sm:px-6">
      <div className="mx-auto max-w-lg space-y-8">
        <div className="flex items-center justify-between">
          <BrandLink />
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => void logout()}
              disabled={isLoggingOut}
              className="text-sm font-medium text-slate-500 hover:text-slate-700 hover:underline disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
            >
              {isLoggingOut ? "Logging out…" : "Log out"}
            </button>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Your organizations
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Pick a workspace to continue, or create a new one below.
          </p>
        </div>

        {typeof lostOrgName === "string" && (
          <p
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300"
          >
            You no longer have access to{" "}
            <span className="font-medium">{lostOrgName}</span>. An admin may
            have removed you. Your account and other organizations are
            unaffected.
          </p>
        )}

        {invites.length > 0 && (
          <section aria-labelledby="picker-invitations-title">
            <h2
              id="picker-invitations-title"
              className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200"
            >
              Invitations waiting for you
            </h2>
            <MyInvitations invites={invites} />
          </section>
        )}

        <div className="space-y-2">
          {memberships && memberships.length > 0 ? (
            memberships.map((membership) => (
              <Link
                key={membership._id}
                to={`/orgs/${membership.tenantId.id}/dashboard`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50/40 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-teal-700 dark:hover:bg-slate-800/60"
              >
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-100">
                    {membership.tenantId.name}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {membership.role} · {membership.tenantId.plan}
                  </p>
                </div>
                <span className="text-slate-300 dark:text-slate-600">
                  &rarr;
                </span>
              </Link>
            ))
          ) : (
            <Card className="text-center text-sm text-slate-500 shadow-sm dark:text-slate-400">
              You&apos;re not a member of any organization yet.
            </Card>
          )}
        </div>

        <Card className="shadow-sm">
          <form
            onSubmit={(event) => void handleSubmit(onSubmit)(event)}
            noValidate
            className="space-y-4"
          >
            <h2 className="font-medium text-slate-800 dark:text-slate-100">
              Create a new organization
            </h2>

            <ErrorBanner message={formError} />

            <Field
              label="Organization name"
              htmlFor="name"
              error={errors.name?.message}
            >
              <input
                id="name"
                type="text"
                {...register("name")}
                className={inputStyles}
              />
            </Field>

            <Button
              type="submit"
              disabled={isSubmitting}
              loading={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? "Creating…" : "Create organization"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
