import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

export function isRazorpayConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

// Upgrading without paying only works when explicitly allowed, or in
// development and tests. In production, missing keys must not mean free plans.
export function simulatedUpgradesAllowed(): boolean {
  // Simulation exists only inside the test harness. It cannot grant paid
  // entitlements in development or production without verified payment.
  return env.NODE_ENV === "test" && env.ALLOW_SIMULATED_UPGRADES === true;
}

function hmacHex(value: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// The browser hands back these three values after a payment. The signature
// can only be made with our secret, so a match proves Razorpay confirmed it.
export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  return sameHex(
    hmacHex(`${orderId}|${paymentId}`, env.RAZORPAY_KEY_SECRET),
    signature,
  );
}

export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string,
): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  return sameHex(hmacHex(rawBody, env.RAZORPAY_WEBHOOK_SECRET), signature);
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

export async function createRazorpayOrder(input: {
  amount: number;
  receipt: string;
  notes: Record<string, string>;
}): Promise<RazorpayOrder> {
  const auth = Buffer.from(
    `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`,
  ).toString("base64");
  let response: Response;
  try {
    response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amount: input.amount,
        currency: "INR",
        receipt: input.receipt,
        notes: input.notes,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(
      503,
      "PAYMENT_UNAVAILABLE",
      "Payments are not reachable right now. Please try again shortly.",
    );
  }
  if (!response.ok) {
    throw new AppError(
      503,
      "PAYMENT_UNAVAILABLE",
      "Payments are not reachable right now. Please try again shortly.",
    );
  }
  return (await response.json()) as RazorpayOrder;
}

export async function refundRazorpayPayment(input: {
  paymentId: string;
  amount: number;
  receipt: string;
}): Promise<{ id: string }> {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new AppError(
      503,
      "PAYMENTS_DISABLED",
      "Payments are not switched on for this app.",
    );
  }
  const auth = Buffer.from(
    `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`,
  ).toString("base64");
  const url = `https://api.razorpay.com/v1/payments/${encodeURIComponent(input.paymentId)}/refund`;
  try {
    const prior = await fetch(`${url}s`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!prior.ok) throw new Error("Could not verify prior refunds");
    const body = (await prior.json()) as {
      items?: { id: string; notes?: Record<string, string> }[];
    };
    const found = body.items?.find(
      (refund) => refund.notes?.worknest_refund_key === input.receipt,
    );
    if (found) return { id: found.id };
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amount: input.amount,
        notes: { worknest_refund_key: input.receipt },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Razorpay refund rejected");
    return (await response.json()) as { id: string };
  } catch {
    throw new AppError(
      503,
      "REFUND_PENDING",
      "The refund could not be confirmed. The scheduled plan remains in place; retry cancellation shortly.",
    );
  }
}
