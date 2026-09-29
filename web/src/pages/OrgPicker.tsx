import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { createOrg } from "@/api/orgs";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

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
  const { memberships, logout, refreshMemberships } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

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
    <div className="min-h-screen bg-slate-50 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-lg space-y-8">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">
              W
            </span>
            <span className="text-lg font-bold text-slate-900">
              WorkNest
            </span>
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm font-medium text-slate-500 hover:text-slate-700 hover:underline"
          >
            Log out
          </button>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Your organizations
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Pick a workspace to continue, or create a new one below.
          </p>
        </div>

        <div className="space-y-2">
          {memberships && memberships.length > 0 ? (
            memberships.map((membership) => (
              <Link
                key={membership._id}
                to={`/orgs/${membership.tenantId.id}/dashboard`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50/40"
              >
                <div>
                  <p className="font-medium text-slate-800">
                    {membership.tenantId.name}
                  </p>
                  <p className="text-sm text-slate-500">
                    {membership.role} · {membership.tenantId.plan}
                  </p>
                </div>
                <span className="text-slate-300">&rarr;</span>
              </Link>
            ))
          ) : (
            <Card className="text-center text-sm text-slate-500 shadow-sm">
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
            <h2 className="font-medium text-slate-800">
              Create a new organization
            </h2>

            <ErrorBanner message={formError} />

            <Field label="Organization name" htmlFor="name" error={errors.name?.message}>
              <input
                id="name"
                type="text"
                {...register("name")}
                className={inputStyles}
              />
            </Field>

            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Creating…" : "Create organization"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
