import { apiClient } from "@/api/client";
import type { Plan } from "@/api/auth";

export interface BillingConfig {
  enabled: boolean;
  keyId: string | null;
  prices: Record<Plan, number>;
  // What each step up costs from the current plan, in paise.
  upgrades: { plan: Plan; amount: number }[];
  payments: { id: string; plan: Plan; amount: number; paidAt: string }[];
}

export interface PaymentOrder {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  plan: Plan;
}

export async function getBillingConfig(orgId: string): Promise<BillingConfig> {
  const response = await apiClient.get<BillingConfig>(`/orgs/${orgId}/billing`);
  return response.data;
}

export async function createPaymentOrder(
  orgId: string,
  plan: Exclude<Plan, "free">,
): Promise<PaymentOrder> {
  const response = await apiClient.post<PaymentOrder>(
    `/orgs/${orgId}/billing/order`,
    { plan },
  );
  return response.data;
}

export async function verifyPayment(
  orgId: string,
  input: { orderId: string; paymentId: string; signature: string },
): Promise<void> {
  await apiClient.post(`/orgs/${orgId}/billing/verify`, input);
}
