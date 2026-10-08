import { expect, test } from "@playwright/test";
import { signUpAndConfirm, uniqueEmail } from "./helpers";

test.use({ hasTouch: true });

test("More menu dismisses predictably at desktop and 320px", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUpAndConfirm(page, uniqueEmail("contextual-menu"));
  const orgId = page.url().match(/\/orgs\/([^/]+)/)?.[1];
  expect(orgId).toBeTruthy();

  await page.goto(`/orgs/${orgId}/projects`);
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Overlay regression");
  await page.getByLabel("Key", { exact: true }).fill("OVR");
  await page.getByRole("button", { name: "Create project" }).click();
  const trigger = page.getByRole("button", {
    name: "Overlay regression actions",
  });
  await expect(trigger).toBeVisible();

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);

    // Model a touch scroll gesture on the trigger: the browser sends a click
    // after pointerdown only when a gesture did not cancel it. Dispatching the
    // sequence explicitly verifies the stale-click guard deterministically.
    await trigger.dispatchEvent("pointerdown", {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      bubbles: true,
    });
    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    await expect(menu).toBeHidden();
    await trigger.dispatchEvent("click", { bubbles: true });
    await expect(menu).toBeHidden();

    await trigger.click();
    await expect(menu).toBeVisible();
    if (viewport.width === 320) {
      const heading = await page
        .getByRole("heading", { name: "Projects" })
        .boundingBox();
      await page.touchscreen.tap(heading!.x + 4, heading!.y + 4);
    } else {
      await page.getByRole("heading", { name: "Projects" }).click();
    }
    await expect(menu).toBeHidden();

    if (viewport.width === 320) {
      const triggerBounds = await trigger.boundingBox();
      await page.touchscreen.tap(
        triggerBounds!.x + triggerBounds!.width / 2,
        triggerBounds!.y + triggerBounds!.height / 2,
      );
      await expect(menu).toBeVisible();
      const cdp = await page.context().newCDPSession(page);
      const x = triggerBounds!.x + triggerBounds!.width / 2;
      const y = triggerBounds!.y + triggerBounds!.height / 2;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: Math.max(10, y - 120), id: 1 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(menu).toBeHidden();
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeGreaterThan(0);
      await expect(menu).toBeHidden();
      await trigger.tap();
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      continue;
    }

    await trigger.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  }
});

test("information panels stay readable, positioned, and within responsive viewports", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUpAndConfirm(page, uniqueEmail("contextual-info"));
  const orgId = page.url().match(/\/orgs\/([^/]+)/)?.[1];
  expect(orgId).toBeTruthy();
  await page.goto(`/orgs/${orgId}/settings`);

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    const trigger = page.getByRole("button", {
      name: "About payments and plan changes",
    });
    await trigger.click();
    const panel = page.getByRole("note");
    await expect(panel).toContainText("Nothing renews by itself");
    const bounds = await panel.boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    const close = panel.getByRole("button", { name: "Close information" });
    expect((await close.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);

    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.scrollBy(0, 24));
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(scrollBefore);
    await expect(panel).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const triggerBox = document
            .querySelector('[aria-label="About payments and plan changes"]')!
            .getBoundingClientRect();
          const panelBox = document
            .querySelector('[role="note"]')!
            .getBoundingClientRect();
          return Math.min(
            Math.abs(panelBox.top - triggerBox.bottom - 8),
            Math.abs(panelBox.bottom - triggerBox.top + 8),
          );
        }),
      )
      .toBeLessThan(2);

    await panel.evaluate((element) => {
      element
        .querySelector<HTMLElement>(".overflow-y-auto")
        ?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(panel).toBeVisible();

    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect(panel).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, 0));
  }
});
