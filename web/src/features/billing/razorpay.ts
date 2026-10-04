import { createPaymentOrder, verifyPayment, type PaymentOrder } from "./api";
import type { Plan } from "@/api/auth";

interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string };
  theme?: { color: string };
  handler: (response: RazorpaySuccess) => void;
  modal: { ondismiss: () => void; confirm_close?: boolean };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => {
      open: () => void;
      on: (event: string, callback: (response: unknown) => void) => void;
    };
  }
}

const SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

// Razorpay's checkout window is loaded only when someone actually upgrades.
function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("The payment window couldn't be loaded."));
    document.body.appendChild(script);
  });
}

// "dismissed" means the window was closed without paying. If an attempt
// failed first, the reason Razorpay gave is passed along so it can be shown.
export type PaymentResult =
  { status: "paid" } | { status: "dismissed"; reason?: string };

// Starts a payment for an upgrade: asks our server for an order, opens
// Razorpay's window, and sends what comes back to the server to be checked.
// The plan only changes once the server has verified the signature.
export async function payForPlan(
  orgId: string,
  plan: Exclude<Plan, "free">,
  prefill: { name?: string; email?: string },
): Promise<PaymentResult> {
  const order: PaymentOrder = await createPaymentOrder(orgId, plan);
  await loadCheckoutScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error("The payment window couldn't be loaded.");

  return new Promise<PaymentResult>((resolve, reject) => {
    let lastFailure: string | undefined;
    const checkout = new Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: "WorkNest",
      description: `Upgrade to ${plan === "pro" ? "Pro" : "Premium"}`,
      prefill,
      theme: { color: "#0d9488" },
      handler: (response) => {
        verifyPayment(orgId, {
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        }).then(() => resolve({ status: "paid" }), reject);
      },
      modal: {
        // Asks before closing, so a stray tap can't drop a payment halfway.
        confirm_close: true,
        ondismiss: () => resolve({ status: "dismissed", reason: lastFailure }),
      },
    });
    checkout.on("payment.failed", (response) => {
      const error = (response as { error?: { description?: string } }).error;
      lastFailure = error?.description;
    });
    checkout.open();
  });
}
