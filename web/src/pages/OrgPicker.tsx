import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { createOrg } from "@/api/orgs";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";

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
    <div className="min-h-screen bg-slate-100 px-4 py-12">
      <div className="mx-auto max-w-lg space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">
            Your organizations
          </h1>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm font-medium text-slate-600 underline"
          >
            Log out
          </button>
        </div>

        <div className="space-y-2">
          {memberships && memberships.length > 0 ? (
            memberships.map((membership) => (
              <Link
                key={membership._id}
                to={`/orgs/${membership.tenantId.id}/dashboard`}
                className="block rounded-lg bg-white p-4 shadow hover:bg-slate-50"
              >
                <p className="font-medium text-slate-800">
                  {membership.tenantId.name}
                </p>
                <p className="text-sm text-slate-500">
                  {membership.role} · {membership.tenantId.plan}
                </p>
              </Link>
            ))
          ) : (
            <p className="rounded-lg bg-white p-4 text-sm text-slate-500 shadow">
              You&apos;re not a member of any organization yet.
            </p>
          )}
        </div>

        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          noValidate
          className="space-y-4 rounded-lg bg-white p-6 shadow"
        >
          <h2 className="font-medium text-slate-800">
            Create a new organization
          </h2>

          {formError && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-slate-700"
            >
              Organization name
            </label>
            <input
              id="name"
              type="text"
              {...register("name")}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-600">
                {errors.name.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
          >
            {isSubmitting ? "Creating…" : "Create organization"}
          </button>
        </form>
      </div>
    </div>
  );
}
