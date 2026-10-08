import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { latestLink } from "./mail";

const PASSWORD = "Moonlit-harbor-42";

// A stand-in for Razorpay's checkout window. It remembers what the app asked
// for, so the test can play the part of a successful payment.
const FAKE_CHECKOUT = `
  window.Razorpay = function (options) {
    window.__checkout = options;
    this.open = function () {};
    this.on = function () {};
  };
`;

test("upgrading a plan goes through a payment that the server verifies", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("https://checkout.razorpay.com/v1/checkout.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: FAKE_CHECKOUT }),
  );

  const email = `pay-${Date.now().toString(36)}@e2e.test`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Pay Person");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Type your password again").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Pay Org");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.goto(await latestLink(email));
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Confirm and continue" }).click();
  await expect(page).toHaveURL(/\/orgs\/\w+\/dashboard/);

  await page.goto(page.url().replace("/dashboard", "/settings"));
  // New accounts see the first-run tour; skip it so it isn't in the way.
  await page.getByRole("button", { name: "Skip" }).click();
  // In test mode the details to pay with are on the page, one tap to copy.
  await expect(page.getByText("No real money moves.")).toBeVisible();
  await page.getByRole("button", { name: "Copy test card number" }).click();
  await expect(page.getByText("Card number copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "4386 2894 0766 0153",
  );

  // Pressing Upgrade copies the card again, and the box shows it.
  const copyButton = page.getByRole("button", {
    name: "Copy test card number",
  });
  await expect(copyButton).toHaveText("Copy");
  await page.evaluate(() => navigator.clipboard.writeText("something else"));
  await page.getByRole("button", { name: /Upgrade to Pro/ }).click();
  const upgradeReview = page.getByRole("dialog", {
    name: "Review subscription change",
  });
  await expect(upgradeReview).toBeVisible();
  await upgradeReview
    .getByRole("button", { name: "Continue to Payment" })
    .click();
  await expect(copyButton).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "4386 2894 0766 0153",
  );

  // The app opened checkout for the right amount.
  await page.waitForFunction(() => Boolean((window as never)["__checkout"]));
  const options = await page.evaluate(
    () =>
      (window as never as { __checkout: { amount: number; order_id: string } })
        .__checkout,
  );
  expect(options.amount).toBe(44900);

  // Pay: only a signature made with the secret is accepted.
  const paymentId = "pay_e2e_1";
  const signature = createHmac("sha256", "e2e_razorpay_secret")
    .update(`${options.order_id}|${paymentId}`)
    .digest("hex");
  await page.evaluate(
    ([orderId, id, sig]) =>
      (
        window as never as {
          __checkout: { handler: (r: object) => void };
        }
      ).__checkout.handler({
        razorpay_order_id: orderId,
        razorpay_payment_id: id,
        razorpay_signature: sig,
      }),
    [options.order_id, paymentId, signature],
  );

  await expect(page.getByText("You're now on the Pro plan")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Upgrade to Pro/ }),
  ).toHaveCount(0);

  // Exercise the Premium → Pro review with a server response showing over-limit
  // usage, without changing the real organization or initiating another payment.
  const orgId = new URL(page.url()).pathname.match(/\/orgs\/([^/]+)/)?.[1];
  expect(orgId).toBeTruthy();
  const proImpact = {
    plan: "pro",
    capturedAt: new Date().toISOString(),
    seats: { used: 42, limit: 30, exceeded: true },
    projects: { active: 31, limit: 25, exceeded: true },
    tasks: {
      limit: 50,
      exceededProjectCount: 1,
      overages: [
        {
          projectId: "e2e-project-a",
          projectName: "Project A",
          activeCount: 68,
          limit: 50,
        },
      ],
    },
    withinLimits: false,
    fingerprint: "e".repeat(64),
  };
  const billingRoute = (url: URL) =>
    url.pathname === `/api/orgs/${orgId}/billing`;
  const orgRoute = (url: URL) => url.pathname === `/api/orgs/${orgId}`;
  await page.route(billingRoute, async (route) => {
    const response = await route.fetch();
    const data = (await response.json()) as {
      current: Record<string, unknown>;
      impacts: Record<string, unknown>;
      quotes: {
        pro: Record<string, Record<string, unknown>>;
      };
    };
    const expiry = "2026-11-01T00:00:00.000Z";
    data.current = {
      ...data.current,
      plan: "premium",
      billingCycle: "monthly",
      planExpiresAt: expiry,
    };
    data.impacts.pro = proImpact;
    for (const cycle of ["monthly", "yearly"]) {
      const quote = data.quotes.pro[cycle];
      if (quote) {
        data.quotes.pro[cycle] = {
          ...quote,
          scheduled: true,
          startsAt: expiry,
          impact: proImpact,
        };
      }
    }
    await route.fulfill({ response, body: JSON.stringify(data) });
  });
  await page.route(orgRoute, async (route) => {
    const response = await route.fetch();
    const data = (await response.json()) as {
      organization: Record<string, unknown>;
    };
    data.organization = {
      ...data.organization,
      plan: "premium",
      planExpiresAt: "2026-11-01T00:00:00.000Z",
      seatLimit: 100,
      projectLimit: 50,
    };
    await route.fulfill({ response, body: JSON.stringify(data) });
  });
  await page.reload();
  await expect(
    page.getByText("Premium", { exact: true }).first(),
  ).toBeVisible();

  for (const viewport of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "Switch to Pro" }).click();
    const review = page.getByRole("dialog", {
      name: "Review subscription change",
    });
    await expect(review).toContainText("Your Pro subscription may start later");
    await expect(review).toContainText("Members: 42 / 30 allowed");
    await expect(review).toContainText("Active projects: 31 / 25 allowed");
    await review.getByText("Show affected projects (1)").click();
    await expect(review).toContainText("Project A: 68 / 50 allowed");
    await expect(
      review.getByRole("button", { name: "Continue to Payment" }),
    ).toBeVisible();
    const bounds = await review.boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(
      await review.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(false);
    await review.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await page.unroute(billingRoute);
  await page.unroute(orgRoute);
  await page.reload();

  // The Free downgrade is reviewed and scheduled; it does not remove current
  // Pro access. Check the review and pending state on narrow and wide screens.
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "Switch to Free" }).click();
    const review = page.getByRole("dialog", {
      name: "Review subscription change",
    });
    await expect(review).toBeVisible();
    await expect(review).toContainText("Pay today: ₹0");
    await expect(review).toContainText(
      "Current paid features remain active until expiry",
    );
    await expect(review).toContainText(
      "Current usage fits the Free plan limits",
    );
    const bounds = await review.boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    const overflows = await review.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    );
    expect(overflows).toBe(false);
    if (viewport.width === 1280) {
      await review.getByRole("button", { name: "Schedule Downgrade" }).click();
    } else {
      await review.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  }
  await expect(
    page.getByRole("button", { name: "Cancel Scheduled Change" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel Scheduled Change" }).click();
  await expect(
    page.getByRole("button", { name: "Cancel Scheduled Change" }),
  ).toHaveCount(0);
});
