import { expect, test } from "@playwright/test";
import { signUpAndConfirm, uniqueEmail } from "./helpers";
import {
  expectNoHorizontalOverflow,
  RESPONSIVE_BREAKPOINT_VIEWPORTS,
  RESPONSIVE_SHORT_VIEWPORTS,
  RESPONSIVE_VIEWPORTS,
} from "./support/responsive";

test("extended display matrix keeps core admin pages usable", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/register");
  for (const viewport of RESPONSIVE_VIEWPORTS.filter(({ width }) =>
    [320, 390, 768, 1280, 1920].includes(width),
  )) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
    await expect(page.getByLabel("Your name")).toBeVisible();
    const submit = await page
      .getByRole("button", { name: "Create account" })
      .boundingBox();
    expect(submit, `${viewport.name} registration submit`).toBeTruthy();
    expect(submit!.x + submit!.width).toBeLessThanOrEqual(viewport.width);
    await expectNoHorizontalOverflow(page, `register at ${viewport.name}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUpAndConfirm(page, uniqueEmail("responsive-extended"));
  const orgId = page.url().match(/\/orgs\/([^/]+)/)?.[1];
  expect(orgId).toBeTruthy();

  await page.goto(`/orgs/${orgId}/projects`);
  await page.getByRole("button", { name: "New project" }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill(
      "A long project title for responsive layout checks across wide screens",
    );
  await page.getByLabel("Key", { exact: true }).fill("LONG");
  await page.getByRole("button", { name: "Create project" }).click();
  const projectTitle =
    "A long project title for responsive layout checks across wide screens";
  await page.getByRole("link", { name: projectTitle }).click();
  const boardPath = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "New task" }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill(
      "A long task title used to check wrapping and reachable actions on boards",
    );
  await page.getByRole("button", { name: "Create task" }).click();

  const todoColumn = page.locator('[data-tour="tasks-first-card"]');
  await todoColumn.getByRole("combobox").first().selectOption("in_progress");
  const assignmentDialog = page.getByRole("dialog", {
    name: "Assign this task?",
  });
  await expect(assignmentDialog).toBeVisible();
  for (const viewport of RESPONSIVE_VIEWPORTS.filter(({ width }) =>
    [320, 390, 768, 1280, 1920].includes(width),
  )) {
    await page.setViewportSize({ ...viewport, height: 600 });
    await expect(assignmentDialog).toBeVisible();
    for (const actionName of [
      "Cancel",
      "Move without assignee",
      "Assign & Move",
    ]) {
      const action = assignmentDialog.getByRole("button", {
        name: actionName,
      });
      await expect(action).toBeVisible();
      await action.scrollIntoViewIfNeeded();
      const actionBounds = await action.boundingBox();
      expect(actionBounds, `${actionName} at ${viewport.name}`).toBeTruthy();
      expect(actionBounds!.x).toBeGreaterThanOrEqual(0);
      expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(
        viewport.width,
      );
    }
    const dialogBounds = await assignmentDialog.boundingBox();
    expect(dialogBounds, viewport.name).toBeTruthy();
    expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(
      viewport.width,
    );
    await expectNoHorizontalOverflow(
      page,
      `assignment prompt at ${viewport.name}`,
    );
  }
  await page.getByRole("button", { name: "Cancel" }).click();

  await page
    .getByText(
      "A long task title used to check wrapping and reachable actions on boards",
      { exact: true },
    )
    .click();
  await page.getByLabel("Status", { exact: true }).selectOption("in_progress");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(assignmentDialog).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  const routes = [
    { path: "dashboard", heading: "Dashboard" },
    { path: "audit", heading: "Audit log" },
    { path: "settings", heading: "Settings" },
    { path: "projects", heading: "Projects" },
    { path: "messages", heading: "Messages" },
    { path: "meetings", heading: "Meetings" },
    { path: boardPath, heading: projectTitle },
  ];
  for (const route of routes) {
    await page.goto(
      route.path.startsWith("/") ? route.path : `/orgs/${orgId}/${route.path}`,
    );
    for (const viewport of RESPONSIVE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect(
        page.getByRole("heading", { name: route.heading, exact: true }),
        `${route.path} heading at ${viewport.name}`,
      ).toBeVisible();
      await expectNoHorizontalOverflow(
        page,
        `${route.path} at ${viewport.name}`,
      );
    }
  }
});

test("breakpoint boundaries and short heights preserve controls and dialogs", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUpAndConfirm(page, uniqueEmail("responsive-boundaries"));
  const orgId = page.url().match(/\/orgs\/([^/]+)/)?.[1];
  expect(orgId).toBeTruthy();

  await page.goto(`/orgs/${orgId}/members`);
  for (const viewport of RESPONSIVE_BREAKPOINT_VIEWPORTS) {
    await page.setViewportSize(viewport);
    const cardList = page.locator('[data-tour="members-content"]').first();
    const table = page.locator('[data-tour="members-content"]').nth(1);
    await expect(cardList).toBeAttached();
    const expectedCards = viewport.width < 1024;
    const actualWidth = await page.evaluate(() => window.innerWidth);
    expect(
      await cardList.isVisible(),
      `${viewport.name}, CSS width ${actualWidth}`,
    ).toBe(expectedCards);
    expect(
      await table.isVisible(),
      `${viewport.name}, CSS width ${actualWidth}`,
    ).toBe(!expectedCards);
    await expectNoHorizontalOverflow(page, `members at ${viewport.name}`);
  }

  await page.goto(`/orgs/${orgId}/meetings`);
  for (const viewport of RESPONSIVE_SHORT_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "Schedule meeting" }).click();
    const dialog = page.getByRole("dialog", { name: "Schedule a meeting" });
    await expect(dialog).toBeVisible();
    const dialogBounds = await dialog.boundingBox();
    expect(dialogBounds, viewport.name).toBeTruthy();
    expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(dialogBounds!.y + dialogBounds!.height).toBeLessThanOrEqual(
      viewport.height,
    );
    const primaryAction = dialog.getByRole("button", {
      name: "Schedule meeting",
    });
    await expect(primaryAction).toBeVisible();
    // Long forms use the dialog's internal scroller at short heights; verify
    // the primary action is reachable inside that region.
    await primaryAction.scrollIntoViewIfNeeded();
    await expect(primaryAction).toBeInViewport();
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }

  // Resizing models the browser viewport orientation transition; this is not
  // physical-device orientation or operating-system text scaling coverage.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/orgs/${orgId}/projects`);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "landscape resize");
});
