import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { dashboardKeys } from "@/features/dashboard/queries";
import { notificationKeys } from "@/features/notifications/queries";
import { orgKeys } from "@/features/org/queries";
import { parseApiError } from "@/lib/apiError";
import { setTestPlanDates } from "./api";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Test accounts only (the server checks EMAIL_VERIFICATION_BYPASS_EMAILS).
// Moves the plan's end date so expiry, the grace period, reminders and
// archiving can be tried without waiting.
export function TestPlanDatesBox({
  orgId,
  onFreePlan,
}: {
  orgId: string;
  onFreePlan: boolean;
}) {
  const queryClient = useQueryClient();
  const [custom, setCustom] = useState("");
  const [run, setRun] = useState(true);
  const [busy, setBusy] = useState(false);

  const apply = async (field: "planExpiresAt" | "planExpiredAt", at: Date) => {
    setBusy(true);
    try {
      const result = await setTestPlanDates(orgId, {
        [field]: at.toISOString(),
        run,
      });
      toast.success(
        result.ran.length > 0
          ? `Date set. Ran: ${result.ran.join(", ")}`
          : "Date set",
      );
      void queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) });
      void queryClient.invalidateQueries({ queryKey: orgKeys.billing(orgId) });
      void queryClient.invalidateQueries({
        queryKey: notificationKeys.all(orgId),
      });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.all(orgId),
      });
    } catch (error) {
      toast.error("Couldn't set the date", {
        description: parseApiError(error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  // While on a paid plan the end date moves; once it has ended, the date it
  // ended moves instead.
  const field = onFreePlan ? "planExpiredAt" : "planExpiresAt";
  const presets = onFreePlan
    ? [
        { label: "Ended now", at: () => new Date() },
        {
          label: "Ended 5 days ago (grace period)",
          at: () => new Date(Date.now() - 5 * DAY),
        },
        {
          label: "Ended 11 days ago (archives extras)",
          at: () => new Date(Date.now() - 11 * DAY),
        },
      ]
    : [
        {
          label: "Ends in 6 days (7 day reminder)",
          at: () => new Date(Date.now() + 6 * DAY),
        },
        {
          label: "Ends in 20 hours (1 day reminder)",
          at: () => new Date(Date.now() + 20 * HOUR),
        },
        { label: "Ends now (expires)", at: () => new Date(Date.now() - 1000) },
      ];

  return (
    <section
      aria-label="Test plan dates"
      className="mt-4 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 shadow-sm dark:border-amber-900/60 dark:from-amber-950/30 dark:to-slate-900 sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Plan date controls
            </h3>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
              Test account
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {onFreePlan
              ? "Set when the plan ended to preview the grace period and archiving."
              : "Set when the plan ends to preview expiry and renewal reminders."}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Quick dates
        </p>
        <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void apply(field, preset.at())}
          >
            {preset.label}
          </Button>
        ))}
        </div>
      </div>

      <div className="mt-4 border-t border-amber-200/80 pt-4 dark:border-amber-900/50">
        <label
          htmlFor="test-plan-custom-date"
          className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          Choose a date and time
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            id="test-plan-custom-date"
            type="datetime-local"
            aria-label={onFreePlan ? "Date the plan ended" : "Date the plan ends"}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 sm:w-auto"
          />
          <Button
            size="sm"
            disabled={busy || !custom}
            onClick={() => void apply(field, new Date(custom))}
            className="w-full sm:w-auto"
          >
            Set date
          </Button>
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg bg-white/70 p-3 text-sm text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
        <input
          type="checkbox"
          checked={run}
          onChange={(event) => setRun(event.target.checked)}
          className="mt-0.5 accent-teal-600"
        />
        <span>
          <span className="block font-medium text-slate-700 dark:text-slate-200">
            Run checks immediately
          </span>
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
            Apply expiry, grace period, reminder and archive checks after setting the date.
          </span>
        </span>
      </label>
    </section>
  );
}
