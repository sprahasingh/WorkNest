import { apiClient } from "@/api/client";
import type { Plan } from "@/api/auth";
import type { BillingCycle } from "@/lib/plans";

export interface BillingConfig {
  // True for the demo and test accounts that may move a plan's end date.
  testControls: boolean;
  enabled: boolean;
  keyId: string | null;
  prices: Record<Plan, Record<BillingCycle, number>>;
  // What buying each plan costs this organization right now, in paise. Null
  // where it can't be bought (a lower plan).
  quotes: Record<
    "pro" | "premium",
    Record<BillingCycle, { amount: number } | null>
  >;
  payments: {
    id: string;
    plan: Plan;
    billingCycle: BillingCycle;
    amount: number;
    paidAt: string;
  }[];
}

export interface PaymentOrder {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  plan: Plan;
  billingCycle: BillingCycle;
}

export async function getBillingConfig(orgId: string): Promise<BillingConfig> {
  const response = await apiClient.get<BillingConfig>(`/orgs/${orgId}/billing`);
  return response.data;
}

export async function createPaymentOrder(
  orgId: string,
  plan: Exclude<Plan, "free">,
  billingCycle: BillingCycle,
): Promise<PaymentOrder> {
  const response = await apiClient.post<PaymentOrder>(
    `/orgs/${orgId}/billing/order`,
    { plan, billingCycle },
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
