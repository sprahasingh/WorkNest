import { createHmac } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { PASSWORD } from "./helpers";

const RESTORE_EMAIL = "restore-e2e@e2e.test";
const FAKE_CHECKOUT = `
  window.Razorpay = function (options) {
    window.__checkout = options;
    this.open = function () {};
    this.on = function () {};
  };
`;

async function overflow(page: Page, label: string) {
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content, `${label} horizontal overflow`).toBeLessThanOrEqual(
    width.viewport,
  );
}

async function api<T>(
  request: APIRequestContext,
  token: string,
  method: "get" | "post",
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await request[method](path, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  expect(
    response.ok(),
    `${method.toUpperCase()} ${path}: ${await response.text()}`,
  ).toBeTruthy();
  return response.json() as Promise<T>;
}

async function purchasePlan(
  page: Page,
  request: APIRequestContext,
  token: string,
  orgId: string,
  plan: "Pro" | "Premium",
) {
  await page
    .getByRole("button", { name: new RegExp(`Upgrade to ${plan}`) })
    .click();
  const review = page.getByRole("dialog", {
    name: "Review subscription change",
  });
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Continue to Payment" }).click();
  await page.waitForFunction(() => Boolean((window as never)["__checkout"]));
  const { order_id: orderId } = await page.evaluate(
    () => (window as never as { __checkout: { order_id: string } }).__checkout,
  );
  const paymentId = `pay_restore_${plan.toLowerCase()}`;
  const signature = createHmac("sha256", "e2e_razorpay_secret")
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  await page.evaluate(
    ([expectedOrderId, id, sig]) =>
      (
        window as never as {
          __checkout: { handler: (response: object) => void };
        }
      ).__checkout.handler({
        razorpay_order_id: expectedOrderId,
        razorpay_payment_id: id,
        razorpay_signature: sig,
      }),
    [orderId, paymentId, signature],
  );
  await expect
    .poll(async () => {
      const current = await api<{ organization: { plan: string } }>(
        request,
        token,
        "get",
        `/api/orgs/${orgId}`,
      );
      return current.organization.plan;
    })
    .toBe(plan.toLowerCase());
}

test("restoration section, both entry points, archived actions, and responsive layout", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.route("https://checkout.razorpay.com/v1/checkout.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: FAKE_CHECKOUT }),
  );
  await page.setViewportSize({ width: 320, height: 780 });
  const existingAccount = await request.post("/api/auth/login", {
    data: { email: RESTORE_EMAIL, password: PASSWORD },
  });
  if (existingAccount.ok()) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(RESTORE_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
  } else {
    await page.goto("/register");
    await page.getByLabel("Your name").fill("Restore E2E");
    await page.getByLabel("Email").fill(RESTORE_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Type your password again").fill(PASSWORD);
    await page.getByLabel("Organization name").fill("Restore Lifecycle");
    await page.getByRole("button", { name: "Create account" }).click();
  }
  await expect(page).toHaveURL(/\/orgs\/\w+\/dashboard/);
  await page
    .getByRole("button", { name: /Skip/ })
    .click()
    .catch(() => undefined);
  const orgId = page.url().match(/\/orgs\/([^/]+)/)?.[1];
  expect(orgId).toBeTruthy();

  const login = await request.post("/api/auth/login", {
    data: { email: RESTORE_EMAIL, password: PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const token = (await login.json()).accessToken as string;
  const orgPath = `/api/orgs/${orgId}`;

  // Make realistic over-limit state while on Premium, then expire and enforce
  // the Free limits through the existing test-account date controls.
  await page.goto(`/orgs/${orgId}/settings`);
  await purchasePlan(page, request, token, orgId!, "Premium");
  const projects: Array<{ _id: string; key: string }> = [];
  for (let index = 0; index < 4; index += 1) {
    const result = await api<{ project: { _id: string; key: string } }>(
      request,
      token,
      "post",
      `${orgPath}/projects`,
      { name: `Restore Project ${index + 1}`, key: `R${index + 1}ST` },
    );
    projects.push(result.project);
  }
  const taskProject = projects[3]!;
  const taskIds: string[] = [];
  for (let index = 0; index < 52; index += 1) {
    const result = await api<{ task: { _id: string } }>(
      request,
      token,
      "post",
      `${orgPath}/projects/${taskProject._id}/tasks`,
      { title: `Restore Task ${index + 1}` },
    );
    taskIds.push(result.task._id);
  }
  const expiration = new Date(
    Date.now() - 11 * 24 * 60 * 60 * 1000,
  ).toISOString();
  await api(request, token, "post", `${orgPath}/billing/test-plan-dates`, {
    planExpiresAt: expiration,
    run: true,
  });
  // Expiry starts the grace clock at the time the plan is checked; advance
  // the stored ended date too, then run enforcement after the grace period.
  await api(request, token, "post", `${orgPath}/billing/test-plan-dates`, {
    planExpiredAt: expiration,
    run: true,
  });
  await api(request, token, "get", orgPath);
  const downgradedOrg = await api<{ organization: { plan: string } }>(
    request,
    token,
    "get",
    orgPath,
  );
  expect(downgradedOrg.organization.plan).toBe("free");
  await page.goto(`/orgs/${orgId}/settings`);
  await purchasePlan(page, request, token, orgId!, "Pro");
  const restoreSection = page
    .getByRole("heading", { name: "Archived after plan changes" })
    .locator("../..");
  await expect(restoreSection).toBeVisible();
  await expect(restoreSection).toContainText(
    "1 project and 42 tasks can be reviewed for restoration.",
  );
  await expect(restoreSection).toContainText(
    "Review items archived when your plan changed.",
  );
  const testDates = page.getByRole("region", { name: "Test plan dates" });
  expect((await restoreSection.boundingBox())!.y).toBeGreaterThan(
    (await testDates.boundingBox())!.y,
  );
  await overflow(page, "Settings with restoration candidates at 320px");

  const automaticDialog = page.getByRole("dialog", {
    name: "Review archived projects",
  });
  await expect(automaticDialog).toBeVisible();
  const automaticMarkup = await automaticDialog.innerHTML();
  await expect(automaticDialog).toContainText(
    "Choose force-archived projects and tasks to restore",
  );
  // 43 candidate checkboxes (one project, 42 tasks) plus the two group toggles.
  await expect(automaticDialog.getByRole("checkbox")).toHaveCount(45);
  await page.getByRole("button", { name: "Later" }).click();
  await expect(automaticDialog).toBeHidden();
  await expect(restoreSection).toBeVisible();
  await page
    .getByRole("button", { name: "Review archived projects and tasks" })
    .click();
  const manualDialog = page.getByRole("dialog", {
    name: "Review archived projects",
  });
  await expect(manualDialog).toBeVisible();
  const normalizedMarkup = (markup: string) =>
    markup.replace(/_r_[^" ]+/g, "_generated_id_");
  expect(normalizedMarkup(await manualDialog.innerHTML())).toBe(
    normalizedMarkup(automaticMarkup),
  );
  await overflow(page, "Settings manual restoration dialog at 320px");
  await manualDialog.getByRole("button", { name: "Later" }).click();
  await expect(manualDialog).toBeHidden();
  const restoreInfoButton = restoreSection.getByRole("button", {
    name: "About items archived after plan changes",
  });
  await restoreInfoButton.click();
  // InfoToggle portals information panels to the document body so they cannot
  // be clipped by the restoration card or its scroll containers.
  const restoreInfoPanel = page.getByRole("note");
  await expect(restoreInfoPanel).toContainText(
    "Items over your previous plan limits were archived automatically.",
  );
  await expect(restoreInfoPanel).toContainText(
    "Eligible projects and tasks can be restored if your current plan has room.",
  );
  await page.keyboard.press("Escape");
  await expect(restoreInfoPanel).toBeHidden();
  await restoreInfoButton.click();
  await expect(restoreInfoPanel).toBeVisible();
  await page.evaluate(() => window.scrollBy(0, 20));
  await expect(restoreInfoButton).toBeInViewport();
  await expect(restoreInfoPanel).toBeVisible();
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(restoreInfoPanel).toBeHidden();

  // Project archived card: indicator, menu action, confirmation and durable conversion.
  await page.goto(`/orgs/${orgId}/projects`);
  await page.getByRole("tab", { name: /Archived/ }).click();
  await overflow(page, "Archived projects at 320px");
  const forcedProject = page.getByText("Restore Project 1", { exact: true });
  await expect(forcedProject).toBeVisible();
  await expect(forcedProject.locator("..")).toContainText(
    "Archived by plan limit",
  );
  await page.getByRole("button", { name: "Restore Project 1 actions" }).click();
  await page.getByRole("menuitem", { name: "Keep archived" }).click();
  const keepProjectDialog = page.getByRole("dialog", {
    name: "Keep this project archived?",
  });
  await expect(keepProjectDialog).toContainText(
    "remove it and its plan-archived tasks from the list",
  );
  await overflow(page, "Keep archived project confirmation at 320px");
  await keepProjectDialog
    .getByRole("button", { name: "Keep archived" })
    .click();
  const keptProjectCard = page
    .getByText("Restore Project 1", { exact: true })
    .locator("..");
  await expect(keptProjectCard).toBeVisible();
  await expect(keptProjectCard).not.toContainText("Archived by plan limit");
  const archivedProjects = await api<{
    projects: Array<{ _id: string; archivedReason: string | null }>;
  }>(request, token, "get", `${orgPath}/projects?view=archived`);
  expect(
    archivedProjects.projects.find(
      (project) => project._id === projects[0]!._id,
    )?.archivedReason,
  ).toBeNull();

  // Task archived card: More menu action and confirmation.
  await page.goto(`/orgs/${orgId}/projects/${taskProject._id}?view=archived`);
  await expect(
    page.getByRole("heading", { name: "Restore Project 4" }),
  ).toBeVisible();
  const forcedTask = page.getByText("Restore Task 42", { exact: true });
  await expect(forcedTask).toBeVisible();
  await overflow(page, "Archived tasks at 320px");
  await page.getByRole("button", { name: "Restore Task 42 actions" }).click();
  await page.getByRole("menuitem", { name: "Keep archived" }).click();
  const keepTaskDialog = page.getByRole("dialog", {
    name: "Keep this task archived?",
  });
  await expect(keepTaskDialog).toContainText(
    "remove it from the list of items that can be restored",
  );
  await overflow(page, "Keep archived task confirmation at 320px");
  await keepTaskDialog.getByRole("button", { name: "Keep archived" }).click();

  // The single task conversion should update the candidate query and count.
  await page.goto(`/orgs/${orgId}/settings`);
  await expect(
    page.getByText("41 tasks can be reviewed for restoration."),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await overflow(page, "Settings with candidates at desktop");
  await page.screenshot({
    path: "test-results/restore-settings-desktop.png",
    fullPage: true,
  });

  // Convert all remaining candidates through the same authorized server route,
  // then verify the section disappears after the candidate query refreshes.
  const taskCandidates = await api<{ tasks: Array<{ _id: string }> }>(
    request,
    token,
    "get",
    `${orgPath}/projects/restore-plan-archived/tasks`,
  );
  for (const candidate of taskCandidates.tasks) {
    await api(
      request,
      token,
      "post",
      `${orgPath}/projects/keep-plan-archived/task/${candidate._id}`,
    );
  }
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Archived after plan changes" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 780 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Archived after plan changes" }),
  ).toHaveCount(0);
  await overflow(page, "Settings with no candidates at 320px");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Archived after plan changes" }),
  ).toHaveCount(0);
  await overflow(page, "Settings with no candidates at desktop");
});
