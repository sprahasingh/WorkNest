import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useOrgDetails, useUpdateOrg, useChangePlan } from "@/features/org/queries";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import type { Plan } from "@/api/auth";

const renameFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80),
});

type RenameFormValues = z.infer<typeof renameFormSchema>;

const RENAME_FIELDS = ["name"] as const;

interface DowngradeBlockedDetail {
  seatsUsed: number;
  projectCount: number;
  targetSeatLimit: number;
  targetProjectLimit: number;
}

const PLAN_LIMITS: Record<Plan, { seatLimit: number; projectLimit: number }> = {
  free: { seatLimit: 5, projectLimit: 3 },
  pro: { seatLimit: 25, projectLimit: 50 },
};

export function SettingsPage() {
  const { orgId } = useOrg();
  const canUpdateOrg = useCan("org:update");
  const canChangePlan = useCan("plan:change");

  const [formError, setFormError] = useState<string | null>(null);

  const { data: org, isPending, isError } = useOrgDetails(orgId);
  const updateOrg = useUpdateOrg(orgId);
  const changePlan = useChangePlan(orgId);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RenameFormValues>({
    resolver: zodResolver(renameFormSchema),
    values: org ? { name: org.name } : undefined,
  });

  const onRenameSubmit = async (values: RenameFormValues) => {
    setFormError(null);
    try {
      await updateOrg.mutateAsync(values);
      toast.success("Organization renamed");
    } catch (error) {
      const parsed = parseApiError(error);
      if (Object.keys(parsed.fieldErrors).length === 0) {
        setFormError(parsed.message);
        return;
      }
      const unmatched = applyFieldErrors(
        parsed.fieldErrors,
        RENAME_FIELDS,
        setError,
      );
      if (unmatched.length > 0) {
        setFormError(unmatched.join(" "));
      }
    }
  };

  const handlePlanChange = async (newPlan: Plan) => {
    try {
      await changePlan.mutateAsync(newPlan);
      toast.success(`Plan changed to ${newPlan}`);
    } catch (error) {
      const parsed = parseApiError(error);

      if (parsed.code === "PLAN_DOWNGRADE_BLOCKED" && parsed.details[0]) {
        const detail = parsed.details[0] as DowngradeBlockedDetail;
        const reasons: string[] = [];
        if (detail.seatsUsed > detail.targetSeatLimit) {
          reasons.push(
            `${detail.seatsUsed} seats used (${newPlan} allows ${detail.targetSeatLimit})`,
          );
        }
        if (detail.projectCount > detail.targetProjectLimit) {
          reasons.push(
            `${detail.projectCount} projects (${newPlan} allows ${detail.targetProjectLimit})`,
          );
        }
        toast.error("Can't downgrade yet", {
          description: `${reasons.join(" and ")} — reduce usage first.`,
        });
        return;
      }

      toast.error(parsed.message);
    }
  };

  if (isPending) {
    return (
      <div className="min-h-screen bg-slate-100 px-6 py-10">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
          <div className="h-32 animate-pulse rounded-lg bg-slate-200" />
        </div>
      </div>
    );
  }

  if (isError || !org) {
    return (
      <div className="min-h-screen bg-slate-100 px-6 py-10">
        <p className="mx-auto max-w-2xl text-sm text-red-600">
          Couldn&apos;t load organization settings.
        </p>
      </div>
    );
  }

  const otherPlan: Plan = org.plan === "free" ? "pro" : "free";
  const isDowngrade = otherPlan === "free";

  return (
    <div className="min-h-screen bg-slate-100 px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-slate-800">Settings</h1>

        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="font-medium text-slate-800">Organization name</h2>

          {formError && (
            <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}

          <form
            onSubmit={(event) => void handleSubmit(onRenameSubmit)(event)}
            noValidate
            className="mt-3 flex items-end gap-3"
          >
            <div className="flex-1">
              <label
                htmlFor="name"
                className="block text-sm font-medium text-slate-700"
              >
                Name
              </label>
              <input
                id="name"
                type="text"
                disabled={!canUpdateOrg}
                {...register("name")}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100 disabled:text-slate-400"
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.name.message}
                </p>
              )}
            </div>

            {canUpdateOrg && (
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {isSubmitting ? "Saving…" : "Save"}
              </button>
            )}
          </form>
        </div>

        <div className="rounded-lg bg-white p-6 shadow">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-slate-800">Plan</h2>
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-sm text-slate-700">
              {org.plan}
            </span>
          </div>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Seats</dt>
              <dd className="text-slate-700">
                {org.seatsUsed} / {org.seatLimit}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Projects</dt>
              <dd className="text-slate-700">
                {org.projectCount} / {org.projectLimit}
              </dd>
            </div>
          </dl>

          {canChangePlan && (
            <button
              type="button"
              onClick={() => void handlePlanChange(otherPlan)}
              disabled={changePlan.isPending}
              className="mt-4 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {changePlan.isPending
                ? "Changing…"
                : isDowngrade
                  ? `Downgrade to ${otherPlan} (${PLAN_LIMITS[otherPlan].seatLimit} seats, ${PLAN_LIMITS[otherPlan].projectLimit} projects)`
                  : `Upgrade to ${otherPlan} (${PLAN_LIMITS[otherPlan].seatLimit} seats, ${PLAN_LIMITS[otherPlan].projectLimit} projects)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
