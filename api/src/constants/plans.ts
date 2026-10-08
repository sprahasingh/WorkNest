export const PLANS = ["free", "pro", "premium"] as const;
export type Plan = (typeof PLANS)[number];

export interface PlanLimits {
  seatLimit: number;
  projectLimit: number;
  // Per project; null means unlimited.
  activeTaskLimit: number | null;
}

// The single source of truth for what each plan allows. Keep in sync with
// web/src/lib/plans.ts.
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { seatLimit: 5, projectLimit: 3, activeTaskLimit: 10 },
  pro: { seatLimit: 30, projectLimit: 25, activeTaskLimit: 50 },
  premium: { seatLimit: 100, projectLimit: 50, activeTaskLimit: null },
};

export const PLAN_NAMES: Record<Plan, string> = {
  free: "Free",
  pro: "Pro",
  premium: "Premium",
};

export const BILLING_CYCLES = ["monthly", "yearly"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

// What each plan costs for a month or a year, in paise (INR 449 and 1,149 a
// month, 4,499 and 11,499 a year). Paying buys one period; nothing renews by
// itself. Keep in sync with web/src/lib/plans.ts.
export const PLAN_PRICE_PAISE: Record<Plan, Record<BillingCycle, number>> = {
  free: { monthly: 0, yearly: 0 },
  pro: { monthly: 44900, yearly: 449900 },
  premium: { monthly: 114900, yearly: 1149900 },
};

export function planRank(plan: Plan): number {
  return PLANS.indexOf(plan);
}

// The end of a paid period that starts at `from`.
export function addBillingPeriod(from: Date, cycle: BillingCycle): Date {
  const months = cycle === "yearly" ? 12 : 1;
  const end = new Date(from);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  ).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

export interface PlanQuote {
  // In paise.
  amount: number;
  // When the plan ends once this is paid.
  expiresAt: Date;
  // The prepaid coverage represented by this term. Its value is carried into
  // a later cycle change as a credit for the unused portion.
  creditStartedAt: Date;
  creditValuePaise: number;
  originalPricePaise: number;
  unusedCreditPaise: number;
  creditAppliedPaise: number;
  proratedChargePaise: number;
  completePeriods: number;
  partialPeriodMs: number;
  scheduled: boolean;
}

interface BillingState {
  plan: Plan;
  planExpiresAt?: Date | null;
  billingCycle?: BillingCycle | null;
  planCreditStartedAt?: Date | null;
  planCreditValuePaise?: number | null;
}

// What buying `target` for `cycle` costs this organization right now, or null
// when it can't be bought (a lower plan, or Free).
//   - Moving up while a paid plan of the same cycle is running costs the
//     difference for the remaining prepaid coverage and keeps the current end date.
//   - When the billing cycle changes during an active plan, the unused value
//     is credited toward the new cycle, which starts today.
//   - Renewing the same plan on the same cycle adds a period to the current
//     end date. An expired plan starts a new period today.
export function quotePlan(
  org: BillingState,
  target: Plan,
  cycle: BillingCycle,
  now = new Date(),
): PlanQuote | null {
  if (target === "free") return null;
  const full = PLAN_PRICE_PAISE[target][cycle];
  const running =
    org.plan !== "free" && org.planExpiresAt != null && org.planExpiresAt > now;
  const sameCycle = running && org.billingCycle === cycle;

  const remainingCredit = () => {
    if (!running || org.billingCycle == null || org.planExpiresAt == null) {
      return 0;
    }
    const expiresAt = org.planExpiresAt;
    const remainingMs = expiresAt.getTime() - now.getTime();
    const creditStartedAt = org.planCreditStartedAt;
    const creditValue = org.planCreditValuePaise;
    if (creditStartedAt && creditValue != null && expiresAt > creditStartedAt) {
      const coverageMs = expiresAt.getTime() - creditStartedAt.getTime();
      // All money stays in paise; ties round up to the nearest paise.
      return Math.max(0, Math.round((creditValue * remainingMs) / coverageMs));
    }
    // Older paid plans don't have credit tracking yet. Estimate their unused
    // value from the remaining time and the listed price of the current cycle.
    const cycleMs =
      addBillingPeriod(
        org.planCreditStartedAt ?? now,
        org.billingCycle,
      ).getTime() - (org.planCreditStartedAt ?? now).getTime();
    return Math.max(
      0,
      Math.round(
        (PLAN_PRICE_PAISE[org.plan][org.billingCycle] * remainingMs) / cycleMs,
      ),
    );
  };

  const createQuote = (
    amount: number,
    expiresAt: Date,
    creditStartedAt: Date,
    creditValuePaise: number,
    unusedCreditPaise = 0,
    creditAppliedPaise = 0,
    proratedChargePaise = amount,
    completePeriods = 1,
    partialPeriodMs = 0,
  ): PlanQuote => ({
    amount,
    expiresAt,
    creditStartedAt,
    creditValuePaise,
    originalPricePaise: full,
    unusedCreditPaise,
    creditAppliedPaise,
    proratedChargePaise,
    completePeriods,
    partialPeriodMs,
    scheduled: false,
  });

  // A lower paid plan is bought in advance and starts after the current paid
  // term. The active plan and its limits remain untouched until that date.
  if (running && planRank(target) < planRank(org.plan) && org.planExpiresAt) {
    const startsAt = org.planExpiresAt;
    const expiresAt = addBillingPeriod(startsAt, cycle);
    return {
      amount: full,
      expiresAt,
      creditStartedAt: startsAt,
      creditValuePaise: full,
      originalPricePaise: full,
      unusedCreditPaise: 0,
      creditAppliedPaise: 0,
      proratedChargePaise: full,
      completePeriods: 1,
      partialPeriodMs: 0,
      scheduled: true,
    };
  }
  if (planRank(target) < planRank(org.plan)) return null;

  const creditCoverage = (credit: number) => {
    let expiresAt = new Date(now);
    let remaining = credit;
    let completePeriods = 0;
    while (remaining >= full && completePeriods < 1200) {
      const next = addBillingPeriod(expiresAt, cycle);
      expiresAt = next;
      remaining -= full;
      completePeriods += 1;
    }
    let partialPeriodMs = 0;
    if (remaining > 0) {
      const periodMs =
        addBillingPeriod(expiresAt, cycle).getTime() - expiresAt.getTime();
      // The final fraction is stored at Date's millisecond precision, rounded
      // to the nearest millisecond (half milliseconds round up).
      partialPeriodMs = Math.round((periodMs * remaining) / full);
      expiresAt = new Date(expiresAt.getTime() + partialPeriodMs);
    }
    return { expiresAt, completePeriods, partialPeriodMs };
  };

  if (target === org.plan) {
    if (running && !sameCycle) {
      const credit = remainingCredit();
      const amount = Math.max(0, full - credit);
      const totalValue = credit + amount;
      const coverage = creditCoverage(totalValue);
      return createQuote(
        amount,
        coverage.expiresAt,
        now,
        totalValue,
        credit,
        credit,
        amount,
        coverage.completePeriods,
        coverage.partialPeriodMs,
      );
    }
    return createQuote(
      full,
      addBillingPeriod(running ? org.planExpiresAt! : now, cycle),
      now,
      (running ? remainingCredit() : 0) + full,
      0,
      0,
      full,
      1,
    );
  }
  if (running && sameCycle) {
    const currentPrice = PLAN_PRICE_PAISE[org.plan][cycle];
    const credit = remainingCredit();
    const amount = Math.max(
      0,
      Math.round((full * credit) / currentPrice) - credit,
    );
    return createQuote(
      amount,
      org.planExpiresAt!,
      now,
      credit + amount,
      credit,
      credit,
      amount,
      1,
    );
  }
  if (running) {
    const credit = remainingCredit();
    const amount = Math.max(0, full - credit);
    const totalValue = credit + amount;
    const coverage = creditCoverage(totalValue);
    return createQuote(
      amount,
      coverage.expiresAt,
      now,
      totalValue,
      credit,
      credit,
      amount,
      coverage.completePeriods,
      coverage.partialPeriodMs,
    );
  }
  return createQuote(full, addBillingPeriod(now, cycle), now, full);
}

// After a paid plan ends, the workspace has this long to renew or cut its
// usage before the extra projects and tasks are archived.
export const GRACE_PERIOD_DAYS = 10;

export function graceEndsAt(planExpiredAt: Date): Date {
  return new Date(planExpiredAt.getTime() + GRACE_PERIOD_DAYS * 86_400_000);
}
