import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// Read when the app starts, so set them first.
vi.hoisted(() => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_abc123";
  process.env.RAZORPAY_KEY_SECRET = "test_secret_value";
  process.env.RAZORPAY_WEBHOOK_SECRET = "hook_secret_value";
});

import request from "supertest";
import { createApp } from "../src/app.js";
import { Payment } from "../src/models/Payment.js";
import { setupOrg } from "./orgHelpers.js";

const app = createApp();
app.set("trust proxy", 1);

const sign = (orderId: string, paymentId: string) =>
  createHmac("sha256", "test_secret_value")
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

let orderCounter = 0;
function stubRazorpay() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { amount: number };
      orderCounter += 1;
      return new Response(
        JSON.stringify({
          id: `order_test_${orderCounter}`,
          amount: body.amount,
          currency: "INR",
        }),
        { status: 200 },
      );
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("paying for a plan", () => {
  it("reports what each upgrade costs and blocks free upgrades", async () => {
    const { orgId, admin } = await setupOrg(app, "pay1.test");
    const config = await request(app)
      .get(`/api/orgs/${orgId}/billing`)
      .set(auth(admin.token));
    expect(config.body.enabled).toBe(true);
    expect(config.body.keyId).toBe("rzp_test_abc123");
    expect(config.body.upgrades).toEqual([
      { plan: "pro", amount: 59900 },
      { plan: "premium", amount: 119900 },
    ]);

    // With payments on, moving up without paying is refused.
    const skipped = await request(app)
      .post(`/api/orgs/${orgId}/plan`)
      .set(auth(admin.token))
      .send({ plan: "pro" });
    expect(skipped.status).toBe(402);
    expect(skipped.body.error.code).toBe("PAYMENT_REQUIRED");
  });

  it("upgrades only after a correctly signed payment", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "pay2.test");
    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "pro" });
    expect(order.status).toBe(201);
    expect(order.body.amount).toBe(59900);

    const forged = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId: "pay_forged",
        signature: "0".repeat(64),
      });
    expect(forged.status).toBe(400);
    const still = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(still.body.organization.plan).toBe("free");

    const paymentId = "pay_real_1";
    const ok = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId,
        signature: sign(order.body.orderId, paymentId),
      });
    expect(ok.status).toBe(200);
    expect(ok.body.organization.plan).toBe("pro");
    expect(ok.body.organization.seatLimit).toBe(30);

    // Confirming again changes nothing and doesn't fail.
    const again = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId,
        signature: sign(order.body.orderId, paymentId),
      });
    expect(again.status).toBe(200);

    // Pro to Premium costs the difference, and the audit log names the payment.
    const next = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "premium" });
    expect(next.body.amount).toBe(60000);
    const audit = await request(app)
      .get(`/api/orgs/${orgId}/audit-logs`)
      .set(auth(admin.token));
    const entry = audit.body.items.find(
      (item: { action: string }) => item.action === "plan.changed",
    );
    expect(entry.metadata.payment.paymentId).toBe(paymentId);

    // Going down stays free.
    const down = await request(app)
      .post(`/api/orgs/${orgId}/plan`)
      .set(auth(admin.token))
      .send({ plan: "free" });
    expect(down.status).toBe(200);
  });

  it("keeps one organization from confirming another's order, and members out", async () => {
    stubRazorpay();
    const a = await setupOrg(app, "pay3a.test");
    const b = await setupOrg(app, "pay3b.test");
    const order = await request(app)
      .post(`/api/orgs/${a.orgId}/billing/order`)
      .set(auth(a.admin.token))
      .send({ plan: "pro" });
    const stolen = await request(app)
      .post(`/api/orgs/${b.orgId}/billing/verify`)
      .set(auth(b.admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId: "pay_x",
        signature: sign(order.body.orderId, "pay_x"),
      });
    expect(stolen.status).toBe(404);

    const member = await a.addMember("pat");
    const denied = await request(app)
      .post(`/api/orgs/${a.orgId}/billing/order`)
      .set(auth(member.token))
      .send({ plan: "pro" });
    expect(denied.status).toBe(403);
  });
});

describe("the payment webhook", () => {
  const post = (body: object, secret = "hook_secret_value") => {
    const raw = JSON.stringify(body);
    return request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set(
        "X-Razorpay-Signature",
        createHmac("sha256", secret).update(raw).digest("hex"),
      )
      .send(raw);
  };

  it("upgrades the plan when the browser never came back", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "pay4.test");
    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "premium" });

    const bad = await post({ event: "payment.captured" }, "wrong_secret");
    expect(bad.status).toBe(400);

    const event = {
      event: "payment.captured",
      payload: {
        payment: { entity: { id: "pay_hook_1", order_id: order.body.orderId } },
      },
    };
    expect((await post(event)).status).toBe(200);
    // Razorpay may send it more than once.
    expect((await post(event)).status).toBe(200);

    const org = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(org.body.organization.plan).toBe("premium");

    // Orders we don't know about are ignored, not errors.
    const unknown = await post({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_z", order_id: "order_nope" } } },
    });
    expect(unknown.status).toBe(200);
  });
});

describe("payments that go wrong halfway", () => {
  const hook = (body: object) => {
    const raw = JSON.stringify(body);
    return request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set(
        "X-Razorpay-Signature",
        createHmac("sha256", "hook_secret_value").update(raw).digest("hex"),
      )
      .send(raw);
  };

  it("ignores a webhook whose amount isn't what the order was for", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "pay5.test");
    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "pro" });
    const res = await hook({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_cheap",
            order_id: order.body.orderId,
            amount: 100,
          },
        },
      },
    });
    expect(res.status).toBe(200);
    const org = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(org.body.organization.plan).toBe("free");
  });

  it("finishes an order that was marked paid but never applied", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "pay6.test");
    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "premium" });
    // As if the server stopped right after marking it paid.
    await Payment.updateOne(
      { razorpayOrderId: order.body.orderId },
      {
        $set: {
          status: "paid",
          razorpayPaymentId: "pay_half",
          paidAt: new Date(),
        },
      },
    ).setOptions({ skipTenant: true });

    const paymentId = "pay_half";
    const confirmed = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId,
        signature: sign(order.body.orderId, paymentId),
      });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.organization.plan).toBe("premium");
  });
});
