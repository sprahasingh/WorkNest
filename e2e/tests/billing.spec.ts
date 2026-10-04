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
}) => {
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
  await page.getByRole("button", { name: /Upgrade to Pro/ }).click();

  // The app opened checkout for the right amount.
  await page.waitForFunction(() => Boolean((window as never)["__checkout"]));
  const options = await page.evaluate(
    () =>
      (window as never as { __checkout: { amount: number; order_id: string } })
        .__checkout,
  );
  expect(options.amount).toBe(49900);

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
});
