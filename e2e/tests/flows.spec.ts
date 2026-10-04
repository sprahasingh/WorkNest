import { expect, test } from "@playwright/test";
import { latestLink } from "./mail";
import {
  PASSWORD,
  freshPage,
  logIn,
  signUpAndConfirm,
  uniqueEmail,
} from "./helpers";

test("sends you back to the link you were headed to after signing in", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("deep");
  await signUpAndConfirm(page, email);
  const target = page.url().replace("/dashboard", "/projects");

  // A different browser with no session opens the same link.
  const other = await freshPage(browser);
  await other.page.goto(target);
  await expect(other.page).toHaveURL(/\/login\?next=/);
  await logIn(other.page, email);
  await expect(other.page).toHaveURL(target);
  await other.context.close();
});

test("resets a forgotten password from the emailed link", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("reset");
  await signUpAndConfirm(page, email);

  const other = await freshPage(browser);
  await other.page.goto("/forgot-password");
  await other.page.getByLabel("Email").fill(email);
  await other.page.getByRole("button", { name: /send/i }).click();
  // The newest email to this address is now the reset link.
  const link = await latestLink(email, 2);
  await other.page.goto(link);
  const fresh = "Copper-lantern-77";
  await other.page.getByLabel("New password", { exact: true }).fill(fresh);
  await other.page.getByLabel("Confirm new password").fill(fresh);
  await other.page.getByRole("button", { name: "Update password" }).click();
  await other.page.goto("/login");
  await logIn(other.page, email, fresh);
  await expect(other.page).toHaveURL(/\/orgs\/\w+\/dashboard/);
  await other.context.close();
  expect(PASSWORD).not.toBe(fresh);
});

test("creates a project with a key that has a number in it, and a task in it", async ({
  page,
}) => {
  await signUpAndConfirm(page, uniqueEmail("proj"));
  await page.goto(page.url().replace("/dashboard", "/projects"));
  await page
    .getByRole("button", { name: /new project/i })
    .first()
    .click();
  await page.getByLabel("Name").fill("Launch Plan");
  await page.getByLabel("Key").fill("web2");
  await page.getByRole("button", { name: /create project/i }).click();
  await expect(page.getByText("Launch Plan")).toBeVisible();
  await expect(page.getByText("WEB2").first()).toBeVisible();

  await page.getByText("Launch Plan").first().click();
  await page
    .getByRole("button", { name: /new task/i })
    .first()
    .click();
  await page.getByLabel("Title").fill("Write the announcement");
  await page.getByRole("button", { name: /create task/i }).click();
  await expect(page.getByText("Write the announcement")).toBeVisible();
});

test("signing out in one tab signs out the other", async ({
  page,
  context,
}) => {
  await signUpAndConfirm(page, uniqueEmail("tabs"));
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second).toHaveURL(/\/dashboard/);

  await page.goto(page.url().replace("/dashboard", "/settings"));
  await page.getByRole("button", { name: "Log out of this device" }).click();
  await expect(page).not.toHaveURL(/\/settings/);
  await expect(second).not.toHaveURL(/\/dashboard/, { timeout: 15_000 });
});
