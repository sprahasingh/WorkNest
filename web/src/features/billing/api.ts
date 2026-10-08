import { apiClient } from "@/api/client";
import type { Plan } from "@/api/auth";
import type { BillingCycle } from "@/lib/plans";

export interface BillingConfig {
  // True for the demo and test accounts that may move a plan's end date.
  testControls: boolean;
  enabled: boolean;
  simulationAllowed: boolean;
  keyId: string | null;
  prices: Record<Plan, Record<BillingCycle, number>>;
  // What buying each plan costs this organization right now, in paise. Null
  // where it can't be bought (a lower plan).
  quotes: Record<"pro" | "premium", Record<BillingCycle, PlanQuote | null>>;
  impacts: Partial<Record<Plan, PlanImpact>>;
  current: {
    plan: Plan;
    billingCycle: BillingCycle | null;
    planExpiresAt: string | null;
  };
  scheduledChange: null | {
    plan: Plan;
    billingCycle: BillingCycle | null;
    startsAt: string;
    expiresAt: string | null;
    prepaid: boolean;
  };
  payments: {
    id: string;
    plan: Plan;
    billingCycle: BillingCycle;
    amount: number;
    paidAt: string;
  }[];
}

export interface PlanImpact {
  plan: Plan;
  capturedAt: string;
  seats: { used: number; limit: number; exceeded: boolean };
  projects: { active: number; limit: number; exceeded: boolean };
  tasks: {
    limit: number | null;
    exceededProjectCount: number;
    overages: {
      projectId: string;
      projectName: string;
      activeCount: number;
      limit: number;
    }[];
  };
  withinLimits: boolean;
  fingerprint: string;
}

export interface PlanQuote {
  amount: number;
  expiresAt: string;
  startsAt: string;
  originalPricePaise: number;
  unusedCreditPaise: number;
  creditAppliedPaise: number;
  proratedChargePaise: number;
  completePeriods: number;
  partialPeriodMs: number;
  scheduled: boolean;
  impact: PlanImpact | null;
  quoteToken: string;
}

export interface PaymentOrder {
  orderId: string | null;
  amount: number;
  currency: string;
  keyId: string | null;
  plan: Plan;
  billingCycle: BillingCycle;
  paidByCredit?: boolean;
}

export async function getBillingConfig(orgId: string): Promise<BillingConfig> {
  const response = await apiClient.get<BillingConfig>(`/orgs/${orgId}/billing`);
  return response.data;
}

export async function scheduleFreeDowngrade(
  orgId: string,
  impactFingerprint: string,
): Promise<void> {
  await apiClient.post(`/orgs/${orgId}/billing/schedule-free`, {
    impactFingerprint,
  });
}

export async function cancelScheduledChange(orgId: string): Promise<void> {
  await apiClient.delete(`/orgs/${orgId}/billing/scheduled-change`);
}

export async function createPaymentOrder(
  orgId: string,
  plan: Exclude<Plan, "free">,
  billingCycle: BillingCycle,
  quoteToken?: string,
): Promise<PaymentOrder> {
  const response = await apiClient.post<PaymentOrder>(
    `/orgs/${orgId}/billing/order`,
    { plan, billingCycle, quoteToken },
  );
  return response.data;
}

export async function verifyPayment(
  orgId: string,
  input: { orderId: string; paymentId: string; signature: string },
): Promise<void> {
  await apiClient.post(`/orgs/${orgId}/billing/verify`, input);
}

export interface TestPlanDatesInput {
  planExpiresAt?: string | null;
  planExpiredAt?: string | null;
  run?: boolean;
}

// Test accounts only: moves a plan's end date (or the date it ended) and can
// run the expiry, grace period and reminder checks straight away.
export async function setTestPlanDates(
  orgId: string,
  input: TestPlanDatesInput,
): Promise<{ ran: string[] }> {
  const response = await apiClient.post<{ ran: string[] }>(
    `/orgs/${orgId}/billing/test-plan-dates`,
    input,
  );
  return response.data;
}
