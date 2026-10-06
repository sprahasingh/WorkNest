import { expect, test, type APIRequestContext } from "@playwright/test";
import { PASSWORD, signUpAndConfirm, uniqueEmail } from "./helpers";

async function api<T>(
  request: APIRequestContext,
  token: string,
  method: "get" | "post" | "patch" | "delete",
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

test("project-wide request targets, results, and mobile sort stay clear", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("project-wide-request");
  await signUpAndConfirm(page, email);
  const orgId = page.url().match(/\/orgs\/([^/]+)/)?.[1];
  expect(orgId).toBeTruthy();
  const login = await request.post("/api/auth/login", {
    data: { email, password: PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const token = (await login.json()).accessToken as string;
  const base = `/api/orgs/${orgId}`;

  const createProject = async (key: string) => {
    const result = await api<{ project: { _id: string } }>(
      request,
      token,
      "post",
      `${base}/projects`,
      { name: `Wide request ${key}`, key },
    );
    return result.project._id;
  };
  const candidate = await createProject("CAND");
  const completed = await createProject("DONE");
  const empty = await createProject("EMPTY");
  await api(request, token, "post", `${base}/projects/${candidate}/tasks`, {
    title: "Open candidate task",
  });
  const boardUrl = `/orgs/${orgId}/projects/${candidate}`;
  const completedTask = await api<{ task: { _id: string } }>(
    request,
    token,
    "post",
    `${base}/projects/${completed}/tasks`,
    { title: "Already completed task" },
  );
  await api(
    request,
    token,
    "patch",
    `${base}/tasks/${completedTask.task._id}`,
    { status: "done" },
  );
  const mixedOpenTask = await api<{ task: { _id: string } }>(
    request,
    token,
    "post",
    `${base}/projects/${completed}/tasks`,
    { title: "One completed and one open task" },
  );

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`/orgs/${orgId}/projects`);
    const projectSort = page.getByRole("combobox", { name: "Sort projects" });
    await expect(projectSort).toBeVisible();
    await expect(projectSort).toHaveValue("createdAt:desc");
    await expect(
      projectSort.locator('option[value="createdAt:desc"]'),
    ).toHaveText("Created: Newest First");
    await page.goto(boardUrl);
    const sort = page.getByRole("combobox", {
      name: width < 640 ? "Sort by" : "Sort tasks",
    });
    await expect(sort).toBeVisible();
    await expect(sort).toHaveValue("dueDate:desc");
    const visibleSortWidth = await sort.evaluate((element) => {
      const select = element as HTMLSelectElement;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      context.font = getComputedStyle(select).font;
      const text = select.selectedOptions[0]?.textContent ?? "";
      return {
        text: text.trim(),
        textWidth: context.measureText(text.trim()).width,
        clientWidth: select.clientWidth,
      };
    });
    expect(visibleSortWidth.text).toBe("Due Date: Latest First");
    expect(visibleSortWidth.textWidth + 12).toBeLessThanOrEqual(
      visibleSortWidth.clientWidth,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }

  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`/orgs/${orgId}/projects`);
  const updateAction = page.getByRole("button", {
    name: "Update",
    exact: true,
  });
  await expect(updateAction).toBeEnabled();
  await updateAction.click();
  const requestDialog = page.getByRole("dialog", {
    name: "Update across active projects",
  });
  await expect(requestDialog).toContainText(
    "2 active projects with open tasks",
  );
  await expect(requestDialog).toContainText(
    "Replies appear in the Updates panel of each included project",
  );
  await requestDialog
    .getByLabel("Message", { exact: true })
    .fill("Can you share a progress update?");
  await requestDialog.getByRole("button", { name: "Ask question" }).click();
  await expect(page.getByText("Question sent across 2 projects")).toBeVisible();
  const questionFeed = await api<{
    activities: Array<{
      type: string;
      content: string;
      taskId: string | null;
      projectIds?: string[];
    }>;
  }>(request, token, "get", `${base}/projects/${candidate}/activity`);
  expect(questionFeed.activities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "question",
        content: "Can you share a progress update?",
        taskId: null,
        projectIds: expect.arrayContaining([candidate, completed]),
      }),
    ]),
  );
  const mixedQuestionFeed = await api<{
    activities: Array<{ type: string; content: string; taskId: string | null }>;
  }>(request, token, "get", `${base}/projects/${completed}/activity`);
  expect(mixedQuestionFeed.activities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "question",
        content: "Can you share a progress update?",
        taskId: null,
      }),
    ]),
  );

  await updateAction.click();
  await requestDialog
    .getByLabel("Message", { exact: true })
    .fill("The shared work is progressing well.");
  await requestDialog.getByRole("button", { name: "Post Update" }).click();
  await expect(page.getByText("Update sent across 2 projects")).toBeVisible();
  const updateFeed = await api<{
    activities: Array<{ type: string; content: string; projectIds?: string[] }>;
  }>(request, token, "get", `${base}/projects/${candidate}/activity`);
  expect(updateFeed.activities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "update",
        content: "The shared work is progressing well.",
        projectIds: expect.arrayContaining([candidate, completed]),
      }),
    ]),
  );

  let attemptedWorkspaceCalls = 0;
  await page.route("**/projects/request-across-active", async (route) => {
    const body = route.request().postDataJSON() as { type?: string };
    if (route.request().method() === "POST" && body.type === "update_request") {
      attemptedWorkspaceCalls += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Request service unavailable" },
        }),
      });
      return;
    }
    await route.continue();
  });
  await updateAction.click();
  await requestDialog
    .getByLabel("Message", { exact: true })
    .fill("Please post your update.");
  await requestDialog.getByRole("button", { name: "Request Update" }).click();
  await expect(requestDialog).toBeVisible();
  await expect(requestDialog.getByRole("alert")).toContainText(
    "Request service unavailable",
  );
  await expect(
    requestDialog.getByRole("textbox", { name: "Message" }),
  ).toHaveValue("Please post your update.");
  expect(attemptedWorkspaceCalls).toBe(1);
  await requestDialog.getByRole("button", { name: "Close dialog" }).click();

  await api(request, token, "post", `${base}/projects/${candidate}/archive`);
  await api(
    request,
    token,
    "patch",
    `${base}/tasks/${mixedOpenTask.task._id}`,
    {
      status: "done",
    },
  );
  const binned = await createProject("BIN");
  await api(request, token, "post", `${base}/projects/${binned}/tasks`, {
    title: "Task in binned project",
  });
  await api(request, token, "delete", `${base}/projects/${binned}`);
  await page.reload();
  await expect(updateAction).toBeDisabled();
  await expect(
    page.getByRole("dialog", { name: "Update across active projects" }),
  ).toHaveCount(0);
});
