import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RestoreProjectsPrompt } from "../src/features/settings/RestoreProjectsPrompt";
import { restorePlanArchivedProjects } from "../src/features/projects/api";
import type { PlanArchivedTaskCandidate } from "../src/features/projects/api";
import { projectKeys } from "../src/features/projects/queries";
import {
  eligibleRestoreCandidates,
  roleVisibleSteps,
  restorePromptSignature,
  shouldShowRestorePrompt,
  taskViewAfterUnarchive,
} from "../src/lib/planRestorePrompt";

const restoreToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: restoreToast }));

vi.mock("../src/features/projects/api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/features/projects/api")>();
  return {
    ...actual,
    restorePlanArchivedProjects: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const candidateProjects = [
  {
    _id: "force-1",
    tenantId: "org-1",
    name: "Force archived",
    key: "FORCE",
    priority: "medium" as const,
    dueDate: null,
    archivedAt: "2026-09-01",
    archivedReason: "plan_limit" as const,
    createdBy: "admin-1",
    createdAt: "2026-01-01",
    updatedAt: "2026-09-01",
  },
  {
    _id: "force-2",
    tenantId: "org-1",
    name: "Another project",
    key: "OTHER",
    priority: "medium" as const,
    dueDate: null,
    archivedAt: "2026-09-02",
    archivedReason: "plan_limit" as const,
    createdBy: "admin-1",
    createdAt: "2026-01-01",
    updatedAt: "2026-09-02",
  },
];

const forceArchivedTask: PlanArchivedTaskCandidate = {
  _id: "force-task-1",
  title: "Archived task",
  projectId: "active-project",
  projectName: "Active project",
  projectKey: "ACTIVE",
  archivedAt: "2026-09-01",
};

function renderPrompt(
  tasks: PlanArchivedTaskCandidate[] = [],
  projects = candidateProjects,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = vi.fn();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <RestoreProjectsPrompt
        orgId="org-1"
        projects={projects}
        tasks={tasks}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { onClose, invalidate };
}

describe("Settings restore prompt", () => {
  it("lists force-archived projects, submits selected projects, and refreshes affected views", async () => {
    vi.mocked(restorePlanArchivedProjects).mockResolvedValue({
      projects: [candidateProjects[0]],
      tasks: [],
    });
    const { onClose, invalidate } = renderPrompt();

    expect(
      screen.getByText(/Choose force-archived projects and tasks to restore/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Another project/ }));
    fireEvent.click(screen.getByRole("button", { name: "Restore selected" }));

    await waitFor(() => {
      expect(restorePlanArchivedProjects).toHaveBeenCalledWith(
        "org-1",
        ["force-1"],
        [],
      );
      expect(onClose).toHaveBeenCalled();
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectKeys.list("org-1", { view: "archived" }),
    });
  });

  it("submits all eligible projects when Restore all is selected", async () => {
    vi.mocked(restorePlanArchivedProjects).mockResolvedValue({
      projects: candidateProjects,
      tasks: [],
    });
    renderPrompt();
    fireEvent.click(screen.getByRole("button", { name: "Restore selected" }));
    await waitFor(() =>
      expect(restorePlanArchivedProjects).toHaveBeenCalledWith(
        "org-1",
        ["force-1", "force-2"],
        [],
      ),
    );
  });

  it("offers force-archived tasks from active projects and submits selected tasks", async () => {
    vi.mocked(restorePlanArchivedProjects).mockResolvedValue({
      projects: [],
      tasks: [{ _id: forceArchivedTask._id }],
    });
    renderPrompt([forceArchivedTask]);
    expect(
      screen.getByRole("heading", {
        name: "Force-archived tasks in active projects",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore selected" }));
    await waitFor(() =>
      expect(restorePlanArchivedProjects).toHaveBeenCalledWith(
        "org-1",
        ["force-1", "force-2"],
        ["force-task-1"],
      ),
    );
  });

  it("restores selections larger than 500 as one operation and reports the aggregate", async () => {
    const tasks = Array.from({ length: 501 }, (_, index) => ({
      ...forceArchivedTask,
      _id: `force-task-${index}`,
      title: `Archived task ${index}`,
    }));
    vi.mocked(restorePlanArchivedProjects).mockImplementation(
      async (_orgId, projectIds, taskIds) => ({
        projects: projectIds.map((id) =>
          candidateProjects.find((project) => project._id === id)!,
        ),
        tasks: taskIds.map((_id) => ({ _id })),
      }),
    );
    const { onClose } = renderPrompt(tasks, []);

    fireEvent.click(screen.getByRole("button", { name: "Restore selected" }));

    await waitFor(() =>
      expect(restorePlanArchivedProjects).toHaveBeenCalledTimes(2),
    );
    expect(restorePlanArchivedProjects).toHaveBeenNthCalledWith(
      1,
      "org-1",
      [],
      tasks.slice(0, 500).map((task) => task._id),
    );
    expect(restorePlanArchivedProjects).toHaveBeenNthCalledWith(
      2,
      "org-1",
      [],
      [tasks[500]._id],
    );
    expect(restoreToast.success).toHaveBeenCalledWith(
      "0 projects and 501 tasks restored",
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports and refreshes partial results when a later batch fails", async () => {
    const tasks = Array.from({ length: 501 }, (_, index) => ({
      ...forceArchivedTask,
      _id: `partial-task-${index}`,
      title: `Partial task ${index}`,
    }));
    vi.mocked(restorePlanArchivedProjects)
      .mockResolvedValueOnce({
        projects: [],
        tasks: tasks.slice(0, 500).map((task) => ({ _id: task._id })),
      })
      .mockRejectedValueOnce(new Error("Second batch failed"));
    const { onClose, invalidate } = renderPrompt(tasks, []);

    fireEvent.click(screen.getByRole("button", { name: "Restore selected" }));

    await waitFor(() => expect(restoreToast.error).toHaveBeenCalled());
    expect(restoreToast.error).toHaveBeenCalledWith(
      "Something went wrong. Please refresh the page and try again.",
      {
        description:
          "0 projects and 500 tasks restored before the remaining batches stopped.",
      },
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectKeys.list("org-1", { view: "archived" }),
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("post-upgrade restore prompt", () => {
  it("offers only force-archived projects and tracks plan cycle changes", () => {
    const projects = [
      {
        _id: "forced",
        archivedAt: "2026-09-01",
        archivedReason: "plan_limit" as const,
      },
      { _id: "manual", archivedAt: "2026-09-01", archivedReason: null },
    ];

    expect(
      eligibleRestoreCandidates(projects).map((project) => project._id),
    ).toEqual(["forced"]);
    expect(
      restorePromptSignature("pro", "2026-10-01", projects),
    ).not.toBeNull();
    expect(restorePromptSignature("free", null, projects)).toBeNull();
    expect(restorePromptSignature("pro", "2026-10-01", projects)).not.toBe(
      restorePromptSignature("pro", "2026-11-01", projects),
    );
    const afterCheckout = restorePromptSignature("pro", "2026-10-01", projects);
    expect(shouldShowRestorePrompt(true, afterCheckout, null)).toBe(true);
    expect(shouldShowRestorePrompt(true, afterCheckout, afterCheckout)).toBe(
      false,
    );
    expect(shouldShowRestorePrompt(false, afterCheckout, null)).toBe(false);
  });
});

describe("member tour steps", () => {
  it("keeps Add a task available to Members while filtering role-only steps", async () => {
    const source = await readFile(
      new URL(
        "../src/components/OnboardingTour.tsx",
        import.meta.url.replace("http://localhost/", "file:///"),
      ),
      "utf8",
    );
    const taskStep = source.slice(
      source.indexOf('target: "tasks-create"'),
      source.indexOf('target: "tasks-tabs"'),
    );
    expect(taskStep).toContain('title: "Add a task"');
    expect(taskStep).not.toContain("roles:");
    expect(
      roleVisibleSteps(
        [{ title: "Add a task" }, { title: "Invitations", roles: ["admin"] }],
        "member",
      ).map((step) => step.title),
    ).toEqual(["Add a task"]);
  });
});

describe("task unarchive navigation", () => {
  it("sends reopened tasks to Active and completed tasks to Completed", () => {
    expect(taskViewAfterUnarchive("todo")).toBe("active");
    expect(taskViewAfterUnarchive("in_progress")).toBe("active");
    expect(taskViewAfterUnarchive("done")).toBe("completed");
  });
});
