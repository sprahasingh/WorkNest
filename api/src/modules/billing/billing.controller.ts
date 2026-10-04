import type { Request, Response } from "express";
import { AppError } from "../../lib/errors.js";
import { verifyWebhookSignature } from "../../lib/razorpay.js";
import {
  applyPaidOrder,
  confirmPayment,
  createOrder,
  getBillingConfig,
} from "./billing.service.js";
import type {
  CreateOrderInput,
  VerifyPaymentInput,
} from "./billing.schemas.js";

export async function billingConfigController(
  _req: Request,
  res: Response,
): Promise<void> {
  res.status(200).json(await getBillingConfig());
}

export async function createOrderController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as CreateOrderInput;
  res.status(201).json(await createOrder(input.plan));
}

export async function verifyPaymentController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as VerifyPaymentInput;
  const organization = await confirmPayment(input);
  res.status(200).json({ organization });
}

interface WebhookBody {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string } };
    order?: { entity?: { id?: string } };
  };
}

// Razorpay calls this after a payment, so the plan is upgraded even if the
// browser closed first. The body must be the raw bytes the signature covers.
export async function webhookController(
  req: Request,
  res: Response,
): Promise<void> {
  const signature = req.get("x-razorpay-signature") ?? "";
  const raw = req.body as Buffer;
  if (!Buffer.isBuffer(raw) || !verifyWebhookSignature(raw, signature)) {
    throw new AppError(400, "INVALID_SIGNATURE", "Invalid signature");
  }
  let body: WebhookBody;
  try {
    body = JSON.parse(raw.toString("utf8")) as WebhookBody;
  } catch {
    throw new AppError(400, "INVALID_BODY", "Invalid body");
  }
  if (body.event === "payment.captured" || body.event === "order.paid") {
    const payment = body.payload?.payment?.entity;
    const orderId = payment?.order_id ?? body.payload?.order?.entity?.id;
    if (orderId && payment?.id) {
      try {
        await applyPaidOrder(orderId, payment.id);
      } catch (error) {
        // An unknown order isn't ours to retry. Anything else should be.
        if (!(error instanceof AppError && error.status === 404)) throw error;
      }
    }
  }
  res.status(200).json({ received: true });
}
