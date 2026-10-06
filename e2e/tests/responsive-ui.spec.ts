import { expect, test } from "@playwright/test";
import { signUpAndConfirm, uniqueEmail } from "./helpers";

const VIEWPORTS = [
  { name: "narrow phone", width: 320, height: 568 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1920, height: 1080 },
];

test("core workspace pages fit common responsive viewports", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUpAndConfirm(page, uniqueEmail("responsive"));
  const orgId = page.url().match(/\/orgs\/([^/]+)/)?.[1];
  expect(orgId).toBeTruthy();

  await page.goto(`/orgs/${orgId}/projects`);
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Responsive board");
  await page.getByLabel("Key", { exact: true }).fill("RSP");
  await page.getByRole("button", { name: "Create project" }).click();
  const projectLink = page.getByRole("link", { name: "Responsive board" });
  await expect(projectLink).toBeVisible();
  await projectLink.click();
  const boardUrl = page.url();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);

    await page.goto(`/orgs/${orgId}/members`);
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(
      page.locator('[data-tour="members-content"]').nth(1),
    ).toBeAttached();
    const memberLayouts = await page.evaluate(() => ({
      cards: getComputedStyle(
        document.querySelector('[data-tour="members-content"]')!,
      ).display,
      table: getComputedStyle(
        document.querySelectorAll('[data-tour="members-content"]')[1],
      ).display,
    }));
    expect(memberLayouts.cards !== "none", viewport.name).toBe(
      viewport.width < 1024,
    );
    expect(memberLayouts.table === "block", viewport.name).toBe(
      viewport.width >= 1024,
    );
    await expectNoPageOverflow(page, viewport.name);

    await page.goto(`/orgs/${orgId}/audit`);
    await expect(page.getByLabel("Filter audit log by action")).toBeVisible();
    await expect(
      page.getByLabel("Filter audit log by action").locator("option", {
        hasText: "Organization renamed",
      }),
    ).toHaveCount(1);
    await expectNoPageOverflow(page, viewport.name);

    await page.goto(`/orgs/${orgId}/meetings`);
    await page.getByRole("button", { name: "Schedule meeting" }).click();
    const dialog = page.getByRole("dialog", { name: "Schedule a meeting" });
    await expect(dialog).toBeVisible();
    const beforeResize = await dialog.boundingBox();
    expect(beforeResize).toBeTruthy();
    await page.setViewportSize({ width: viewport.width, height: 380 });
    await expect
      .poll(async () => {
        const bounds = await dialog.boundingBox();
        return bounds ? bounds.y + bounds.height : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(380);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expectNoPageOverflow(page, viewport.name);

    await page.goto(`/orgs/${orgId}/messages`);
    const notifications = page.getByRole("button", { name: /^Notifications/ });
    await notifications.click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel).toBeVisible();
    const panelViewportWidth = await page.evaluate(() => window.innerWidth);
    await expect
      .poll(async () => {
        const bounds = await panel.boundingBox();
        return bounds ? bounds.x + bounds.width : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(viewport.width);
    expect(panelViewportWidth, viewport.name).toBe(viewport.width);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expectNoPageOverflow(page, viewport.name);

    await page.goto(boardUrl);
    await expect(
      page.getByRole("heading", { name: "Responsive board" }),
    ).toBeVisible();
    await expect(page.getByLabel("Filter by priority")).toBeVisible();
    await expectNoPageOverflow(page, viewport.name);
  }
});

async function expectNoPageOverflow(
  page: import("@playwright/test").Page,
  viewportName: string,
) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page, `${viewportName} page overflow`).toBeLessThanOrEqual(
    dimensions.viewport,
  );
}
