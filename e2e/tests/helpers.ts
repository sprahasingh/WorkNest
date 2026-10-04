import { expect, type Browser, type Page } from "@playwright/test";
import { latestLink } from "./mail";

export const PASSWORD = "Moonlit-harbor-42";

export const uniqueEmail = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}@e2e.test`;

// Signs up, opens the emailed link, and ends up on the new organization's
// dashboard, skipping the first-run tour.
export async function signUpAndConfirm(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Flow Person");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Type your password again").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Flow Org");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.goto(await latestLink(email));
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Confirm and continue" }).click();
  await expect(page).toHaveURL(/\/orgs\/\w+\/dashboard/);
  // The first-run tour appears a moment after the page loads.
  await page
    .getByRole("button", { name: "Skip" })
    .click({ timeout: 5_000 })
    .catch(() => undefined);
}

export async function freshPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

export async function logIn(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}
