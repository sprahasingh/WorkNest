import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/auth/auth-context";
import { useOrgDetails, useUpdateOrg, useChangePlan } from "@/features/org/queries";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Plan } from "@/api/auth";
import { cn } from "@/lib/cn";
import {
  PLAN_LIMITS,
  PLAN_NAMES,
  PLAN_ORDER,
  formatTaskLimit,
} from "@/lib/plans";

const DELETE_CONFIRMATION_TEXT = "delete my account";

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
  projectsOverTaskLimit?: number;
  targetSeatLimit: number;
  targetProjectLimit: number;
  targetActiveTaskLimit?: number | null;
}

export function SettingsPage() {
  const { orgId } = useOrg();
  const { logout, isLoggingOut, deleteAccount, isDeletingAccount } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
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
    const name = PLAN_NAMES[newPlan];
    try {
      await changePlan.mutateAsync(newPlan);
      toast.success(`You're now on the ${name} plan`);
    } catch (error) {
      const parsed = parseApiError(error);

      if (parsed.code === "PLAN_DOWNGRADE_BLOCKED" && parsed.details[0]) {
        const detail = parsed.details[0] as DowngradeBlockedDetail;
        const reasons: string[] = [];
        if (detail.seatsUsed > detail.targetSeatLimit) {
          reasons.push(
            `${detail.seatsUsed} seats in use (${name} allows ${detail.targetSeatLimit})`,
          );
        }
        if (detail.projectCount > detail.targetProjectLimit) {
          reasons.push(
            `${detail.projectCount} projects (${name} allows ${detail.targetProjectLimit})`,
          );
        }
        if (detail.projectsOverTaskLimit && detail.targetActiveTaskLimit) {
          const count = detail.projectsOverTaskLimit;
          reasons.push(
            `${count} ${count === 1 ? "project has" : "projects have"} more than ${detail.targetActiveTaskLimit} active tasks`,
          );
        }
        toast.error(`Can't switch to ${name} yet`, {
          description: `${reasons.join("; ")}. Reduce usage first.`,
        });
        return;
      }

      toast.error(parsed.message);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await deleteAccount();
      toast.success("Your account has been deleted");
    } catch (error) {
      toast.error(parseApiError(error).message);
    }
  };

  if (isPending) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-32 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
    );
  }

  if (isError || !org) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
        <p className="mx-auto max-w-2xl text-sm text-red-600 dark:text-red-400">
          Couldn&apos;t load organization settings.
        </p>
      </div>
    );
  }

  const currentPlan = org.plan as Plan;
  const currentRank = PLAN_ORDER.indexOf(currentPlan);
  const pendingPlan = changePlan.isPending ? changePlan.variables : null;

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Settings
        </h1>

        <Card>
          <h2 className="font-medium text-slate-800 dark:text-slate-100">
            Organization name
          </h2>

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
              <Button type="submit" disabled={isSubmitting} loading={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save"}
              </Button>
            )}
          </form>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-slate-800 dark:text-slate-100">
              Plan
            </h2>
            <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-sm font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
              {PLAN_NAMES[currentPlan]}
            </span>
          </div>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Seats</dt>
              <dd className="text-slate-700 dark:text-slate-300">
                {org.seatsUsed} / {org.seatLimit}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Projects</dt>
              <dd className="text-slate-700 dark:text-slate-300">
                {org.projectCount} / {org.projectLimit}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">
                Active tasks per project
              </dt>
              <dd className="text-slate-700 dark:text-slate-300">
                {formatTaskLimit(PLAN_LIMITS[currentPlan].activeTaskLimit)}
              </dd>
            </div>
          </dl>

          <ul
            aria-label="Plans"
            className="mt-5 grid gap-3 sm:grid-cols-3"
          >
            {PLAN_ORDER.map((plan, rank) => {
              const limits = PLAN_LIMITS[plan];
              const isCurrent = plan === currentPlan;
              const isUpgrade = rank > currentRank;
              return (
                <li
                  key={plan}
                  className={cn(
                    "flex flex-col rounded-xl border p-4",
                    isCurrent
                      ? "border-teal-500 bg-teal-50/50 dark:border-teal-500/70 dark:bg-teal-900/10"
                      : "border-slate-200 dark:border-slate-700",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900 dark:text-slate-50">
                      {PLAN_NAMES[plan]}
                    </p>
                    {isCurrent && (
                      <span className="rounded-full bg-teal-600 px-2 py-0.5 text-xs font-medium text-white">
                        Current
                      </span>
                    )}
                  </div>
                  <ul className="mt-3 flex-1 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                    <li>{limits.seatLimit} seats</li>
                    <li>{limits.projectLimit} projects</li>
                    <li>
                      {limits.activeTaskLimit === null
                        ? "Unlimited active tasks"
                        : `${limits.activeTaskLimit} active tasks per project`}
                    </li>
                  </ul>
                  {canChangePlan && !isCurrent && (
                    <Button
                      size="sm"
                      variant={isUpgrade ? "primary" : "secondary"}
                      onClick={() => void handlePlanChange(plan)}
                      disabled={changePlan.isPending}
                      loading={pendingPlan === plan}
                      className="mt-4 w-full"
                    >
                      {isUpgrade
                        ? `Upgrade to ${PLAN_NAMES[plan]}`
                        : `Switch to ${PLAN_NAMES[plan]}`}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          {!canChangePlan && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Only admins can change the plan.
            </p>
          )}
        </Card>

        <Card>
          <h2 className="font-medium text-slate-800 dark:text-slate-100">
            Session
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Sign out of WorkNest on this device.
          </p>
          <Button
            variant="secondary"
            onClick={() => void logout()}
            loading={isLoggingOut}
            className="mt-4"
          >
            {isLoggingOut ? "Logging out…" : "Log out"}
          </Button>
        </Card>

        <Card className="border-red-200 dark:border-red-900/40">
          <h2 className="font-medium text-red-700 dark:text-red-400">
            Danger zone
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Delete your account and leave every workspace you belong to.
            You&apos;ll be signed out, and your email is freed so you can sign
            up or accept an invite again later. If you&apos;re the only admin
            of a workspace with other people in it, make someone else an
            admin first.
          </p>

          {!showDeleteConfirm ? (
            <Button
              variant="secondary"
              onClick={() => setShowDeleteConfirm(true)}
              className="mt-4 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-950/20"
            >
              Delete account
            </Button>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Type{" "}
                <span className="font-mono font-semibold">
                  {DELETE_CONFIRMATION_TEXT}
                </span>{" "}
                to confirm.
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={DELETE_CONFIRMATION_TEXT}
                className={inputStyles}
              />
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmText("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleDeleteAccount()}
                  disabled={
                    deleteConfirmText !== DELETE_CONFIRMATION_TEXT ||
                    isDeletingAccount
                  }
                  loading={isDeletingAccount}
                  className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isDeletingAccount
                    ? "Deleting…"
                    : "Permanently delete account"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
