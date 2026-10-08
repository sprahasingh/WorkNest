import { expect, test } from "@playwright/test";
import { signUpAndConfirm, uniqueEmail } from "./helpers";
import { RESPONSIVE_SMOKE_VIEWPORTS } from "./support/responsive";

test("page tour stays clear of its target across responsive viewports", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUpAndConfirm(page, uniqueEmail("tour-layout"));
  const orgId = page.url().match(/\/orgs\/([^/]+)/)?.[1];
  expect(orgId).toBeTruthy();
  await page.goto(`/orgs/${orgId}/projects`);
  await page.getByRole("button", { name: "Show the tour" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("link", { name: "Explore Projects →" }).click();

  const tour = page.getByRole("dialog", { name: "Create a project" });
  const target = page.locator('[data-tour="projects-create"]');
  await expect(tour).toBeVisible();
  await expect(target).toBeVisible();

  for (const viewport of RESPONSIVE_SMOKE_VIEWPORTS.filter(
    ({ width }) => width < 1920,
  )) {
    await page.setViewportSize(viewport);
    await expect(tour).toBeVisible();
    const boxes = await Promise.all([tour.boundingBox(), target.boundingBox()]);
    expect(boxes[0]).toBeTruthy();
    expect(boxes[1]).toBeTruthy();
    const [card, highlight] = boxes as [
      NonNullable<(typeof boxes)[0]>,
      NonNullable<(typeof boxes)[1]>,
    ];
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(viewport.width);
    expect(card.y).toBeGreaterThanOrEqual(0);
    expect(card.y + card.height).toBeLessThanOrEqual(viewport.height);
    const intersects =
      card.x < highlight.x + highlight.width &&
      card.x + card.width > highlight.x &&
      card.y < highlight.y + highlight.height &&
      card.y + card.height > highlight.y;
    expect(intersects).toBe(false);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }

  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByRole("heading", { name: "Project lists" }),
  ).toBeVisible();
  await expect(page.locator('[data-tour="projects-tabs"]')).toBeInViewport();
  await page.getByRole("button", { name: /Back/ }).click();
  await expect(
    page.getByRole("heading", { name: "Create a project" }),
  ).toBeVisible();
  await expect(target).toBeInViewport();
});
