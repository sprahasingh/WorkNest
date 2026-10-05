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
      className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/50"
    >
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          Test account
        </span>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {onFreePlan
            ? "Move the date the plan ended."
            : "Move the date the plan ends."}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="datetime-local"
          aria-label={onFreePlan ? "Date the plan ended" : "Date the plan ends"}
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        <Button
          size="sm"
          disabled={busy || !custom}
          onClick={() => void apply(field, new Date(custom))}
        >
          Set date
        </Button>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={run}
          onChange={(event) => setRun(event.target.checked)}
        />
        Run the expiry, grace period and reminder checks right away
      </label>
    </section>
  );
}
