import { expect, test } from "@playwright/test";
import { signUpAndConfirm, uniqueEmail } from "./helpers";

test("admin settings tours follow page order and keep section headings visible responsively", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUpAndConfirm(page, uniqueEmail("settings-tour"));
  const orgId = page.url().match(/\/orgs\/([^/]+)/)?.[1];
  expect(orgId).toBeTruthy();

  await page.goto(`/orgs/${orgId}/settings`);
  await page.getByRole("button", { name: "Show the tour" }).click();
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await expect(page.getByText("Explore organization activity →")).toBeVisible();
  await page.getByText("Explore organization activity →").click();
  await expect(
    page.getByRole("heading", { name: "Audit history" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip this page tour" }).click();
  await expect(page.getByText("Explore Organization Settings →")).toBeVisible();
  await page.getByText("Explore Organization Settings →").click();

  const organizationTour = page.getByRole("dialog", {
    name: "Organization details and retention",
  });
  const organizationHeading = page.locator(
    '[data-tour="settings-organization"]',
  );
  await expect(organizationTour).toBeVisible();
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(organizationHeading).toBeInViewport();
    const [card, heading] = await Promise.all([
      organizationTour.boundingBox(),
      organizationHeading.boundingBox(),
    ]);
    expect(card).toBeTruthy();
    expect(heading).toBeTruthy();
    expect(card!.x).toBeGreaterThanOrEqual(0);
    expect(card!.x + card!.width).toBeLessThanOrEqual(viewport.width);
    expect(card!.y).toBeGreaterThanOrEqual(0);
    expect(card!.y + card!.height).toBeLessThanOrEqual(viewport.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(heading!.y).toBeGreaterThan(50);
  }

  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByRole("heading", { name: "Plans, limits, and billing" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Back/ }).click();
  await expect(organizationTour).toBeVisible();
  await page
    .getByRole("button", { name: "Continue main tour" })
    .first()
    .click();
  await expect(page.getByText("Explore Settings →")).toBeVisible();
  await page.getByText("Explore Settings →").click();
  await expect(
    page.getByRole("heading", { name: "Personal information and security" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Email address" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Back/ }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Personal information and security" }),
  ).toBeVisible();
});
