import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useOrgDetails, useUpdateOrg, useChangePlan } from "@/features/org/queries";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
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
      <div className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
          <div className="h-32 animate-pulse rounded-xl bg-slate-200" />
        </div>
      </div>
    );
  }

  if (isError || !org) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6 sm:py-10">
        <p className="mx-auto max-w-2xl text-sm text-red-600">
          Couldn&apos;t load organization settings.
        </p>
      </div>
    );
  }

  const otherPlan: Plan = org.plan === "free" ? "pro" : "free";
  const isDowngrade = otherPlan === "free";

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>

        <Card>
          <h2 className="font-medium text-slate-800">Organization name</h2>

          <div className="mt-3">
            <ErrorBanner message={formError} />
          </div>

          <form
            onSubmit={(event) => void handleSubmit(onRenameSubmit)(event)}
            noValidate
            className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <Field label="Name" htmlFor="name" error={errors.name?.message}>
                <input
                  id="name"
                  type="text"
                  disabled={!canUpdateOrg}
                  {...register("name")}
                  className={inputStyles}
                />
              </Field>
            </div>

            {canUpdateOrg && (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save"}
              </Button>
            )}
          </form>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-slate-800">Plan</h2>
            <span className="rounded-full bg-teal-50 px-2.5 py-0.5 font-mono text-sm text-teal-700">
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
            <Button
              onClick={() => void handlePlanChange(otherPlan)}
              disabled={changePlan.isPending}
              className="mt-4 w-full sm:w-auto"
            >
              {changePlan.isPending
                ? "Changing…"
                : isDowngrade
                  ? `Downgrade to ${otherPlan} (${PLAN_LIMITS[otherPlan].seatLimit} seats, ${PLAN_LIMITS[otherPlan].projectLimit} projects)`
                  : `Upgrade to ${otherPlan} (${PLAN_LIMITS[otherPlan].seatLimit} seats, ${PLAN_LIMITS[otherPlan].projectLimit} projects)`}
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}
