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
    await expect
      .poll(async () => {
        const bounds = await panel.boundingBox();
        return bounds ? bounds.x + bounds.width : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(viewport.width);
    if (viewport.width === 320) {
      for (const control of [
        panel.getByRole("button", { name: "Close notifications" }),
        panel.getByRole("tab", { name: /Unread/ }),
        panel.getByRole("tab", { name: "All" }),
        panel.getByRole("button", { name: "Mark activity read" }),
      ]) {
        const box = await control.boundingBox();
        expect(
          box?.height,
          "notification control hit area",
        ).toBeGreaterThanOrEqual(44);
        const panelBox = await panel.boundingBox();
        expect(
          box!.x + box!.width,
          "notification control within panel",
        ).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
      }
    }
    const panelViewportWidth = await page.evaluate(() => window.innerWidth);
    expect(panelViewportWidth, viewport.name).toBe(viewport.width);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expectNoPageOverflow(page, viewport.name);

    await page.goto(boardUrl);
    await expect(
      page.getByRole("heading", { name: "Responsive board" }),
    ).toBeVisible();
    await expect(page.getByLabel("Filter by priority")).toBeVisible();
    if (viewport.width === 320) {
      const columns = page.locator('[aria-describedby="task-columns-hint"]');
      await expect(page.getByText("Swipe → to see In progress")).toBeVisible();
      await page.getByRole("button", { name: "Next task column" }).click();
      await expect
        .poll(() => columns.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      await expect(page.getByText("← Swipe to see To do")).toBeVisible();
      await page.getByRole("button", { name: "Previous task column" }).click();
      await expect
        .poll(() => columns.evaluate((element) => element.scrollLeft))
        .toBe(0);
      await expect(page.getByText("Swipe → to see In progress")).toBeVisible();
    }
    await expectNoPageOverflow(page, viewport.name);
  }
});

test("keyboard, retry, and lifecycle flows remain usable at phone widths", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUpAndConfirm(page, uniqueEmail("responsive-flows"));
  const orgId = page.url().match(/\/orgs\/([^/]+)/)?.[1];
  expect(orgId).toBeTruthy();
  await page.setViewportSize({ width: 320, height: 568 });

  // Give the conversation page a stable direct thread so the actual composer
  // can be measured after a mobile keyboard-sized viewport resize.
  let resolveCurrentUser: (id: string) => void = () => undefined;
  const currentUserId = new Promise<string>((resolve) => {
    resolveCurrentUser = resolve;
  });
  await page.route(`**/api/orgs/${orgId}/members`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    resolveCurrentUser(data.members[0].userId.id);
    await route.fulfill({
      response,
      json: {
        ...data,
        members: [
          ...data.members,
          {
            _id: "6ac5055765c98d50333e36f8",
            tenantId: orgId,
            userId: {
              id: "6ac5055765c98d50333e36f7",
              name: "Other Person",
              email: "other@example.test",
            },
            role: "member",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });
  });
  await page.route(`**/api/orgs/${orgId}/chat/conversations`, async (route) => {
    const userId = await currentUserId;
    const now = new Date().toISOString();
    await route.fulfill({
      json: {
        unreadCount: 0,
        conversations: [
          {
            id: "responsive-thread",
            type: "direct",
            name: null,
            createdBy: userId,
            adminIds: [],
            members: [
              {
                userId,
                name: "Flow Person",
                email: "flow@example.test",
                lastReadAt: now,
              },
              {
                userId: "6ac5055765c98d50333e36f7",
                name: "Other Person",
                email: "other@example.test",
                lastReadAt: now,
              },
            ],
            lastMessage: null,
            lastMessageAt: now,
            createdAt: now,
            unreadCount: 0,
            mentionCount: 0,
            muted: false,
          },
        ],
      },
    });
  });
  await page.route(
    "**/api/orgs/*/chat/conversations/responsive-thread/messages**",
    (route) =>
      route.fulfill({
        json: { messages: [], hasMore: false, nextCursor: null },
      }),
  );
  await page.goto(`/orgs/${orgId}/messages/responsive-thread`);
  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeVisible();
  await composer.focus();
  await page.setViewportSize({ width: 320, height: 300 });
  const composerBounds = await composer.boundingBox();
  expect(composerBounds).toBeTruthy();
  expect(composerBounds!.y + composerBounds!.height).toBeLessThanOrEqual(300);
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });

  await page.goto(`/orgs/${orgId}/settings`);
  await page.getByRole("button", { name: "Edit", exact: true }).last().click();
  const timezone = page.getByRole("button", { name: /^Time zone:/ });
  await timezone.focus();
  await page.keyboard.press("ArrowDown");
  const search = page.getByRole("combobox", { name: "Search time zones" });
  await expect(search).toBeFocused();
  await search.fill("Kolkata");
  await page.keyboard.press("ArrowDown");
  const option = page.getByRole("option", { name: /Calcutta/ });
  await expect(option).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: /Asia\/Calcutta/ }),
  ).toBeVisible();

  let failedRange = true;
  await page.route(`**/api/orgs/${orgId}/meetings?**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "range" && failedRange) {
      await route.fulfill({ status: 500, body: "temporary failure" });
      return;
    }
    await route.continue();
  });
  await page.goto(`/orgs/${orgId}/meetings`);
  await page.getByRole("tab", { name: "Calendar" }).click();
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();
  failedRange = false;
  await retry.click();
  await expect(page.getByText("Nothing scheduled.")).toBeVisible();

  await page.getByRole("button", { name: "Schedule meeting" }).click();
  const meetingDialog = page.getByRole("dialog", {
    name: "Schedule a meeting",
  });
  const title = meetingDialog.getByLabel("Title");
  await title.fill("Phone form check");
  for (const control of [
    meetingDialog.getByLabel("Date"),
    meetingDialog.getByLabel("Starts"),
    meetingDialog.getByLabel("Ends"),
    meetingDialog.getByRole("button", { name: "30 min" }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height, "meeting control hit area").toBeGreaterThanOrEqual(44);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  await page.keyboard.press("Escape");

  await page.goto(`/orgs/${orgId}/projects`);
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Lifecycle check");
  await page.getByLabel("Key", { exact: true }).fill("LFC");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: "Lifecycle check" }).click();
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Lifecycle task");
  await page.getByRole("button", { name: "Create task" }).click();
  await page.locator('summary[aria-label="Lifecycle task actions"]').click();
  await page.getByRole("button", { name: "Move to bin" }).click();
  await expect(
    page.getByRole("dialog", { name: "Move task to bin?" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("link", { name: /Projects/ }).click();
  await page.locator('summary[aria-label="Lifecycle check actions"]').click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Archive project?" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
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
