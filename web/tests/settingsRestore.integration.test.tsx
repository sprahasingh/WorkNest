import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Organization } from "../src/features/org/api";
import type { ListProjectsResponse } from "../src/features/projects/api";
import { AxiosError } from "axios";

const mocks = vi.hoisted(() => ({
  plan: "free" as "free" | "pro" | "premium",
  paymentsEnabled: false,
  listProjects: vi.fn(),
  listPlanArchivedRestoreTasks: vi.fn(),
  getOrg: vi.fn(),
  changePlan: vi.fn(),
  payForPlan: vi.fn(),
  billingImpact: null as unknown,
}));

vi.mock("../src/hooks/useOrg", () => ({
  useOrg: () => ({ orgId: "org-1" }),
}));
vi.mock("../src/hooks/useCan", () => ({
  useCan: () => true,
}));
vi.mock("../src/auth/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Admin", email: "admin@example.test" },
    deleteAccount: vi.fn(),
    isDeletingAccount: false,
    updateCurrentUser: vi.fn(),
  }),
}));
vi.mock("../src/features/org/api", () => ({
  getOrg: mocks.getOrg,
  changePlan: mocks.changePlan,
  updateOrg: vi.fn(),
}));
vi.mock("../src/features/projects/api", () => ({
  listProjects: mocks.listProjects,
  listPlanArchivedRestoreTasks: mocks.listPlanArchivedRestoreTasks,
  restorePlanArchivedProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  unarchiveProject: vi.fn(),
  restoreProject: vi.fn(),
  deleteProject: vi.fn(),
  deleteProjectPermanently: vi.fn(),
}));
vi.mock("../src/features/billing/queries", () => ({
  billingQuery: () => ({
    queryKey: ["billing-test"],
    queryFn: async () => ({
      enabled: mocks.paymentsEnabled,
      simulationAllowed: !mocks.paymentsEnabled,
      testControls: false,
      current: {
        plan: mocks.plan,
        billingCycle: "monthly",
        planExpiresAt: null,
      },
      impacts: mocks.billingImpact
        ? { free: mocks.billingImpact, pro: mocks.billingImpact }
        : {},
      quotes: mocks.paymentsEnabled
        ? {
            pro: {
              monthly: {
                amount: 44900,
                originalPricePaise: 44900,
                unusedCreditPaise: 0,
                creditAppliedPaise: 0,
                proratedChargePaise: 44900,
                completePeriods: 1,
                partialPeriodMs: 0,
                scheduled: true,
                startsAt: "2026-11-01T00:00:00.000Z",
                expiresAt: "2026-12-01T00:00:00.000Z",
                impact: mocks.billingImpact,
                quoteToken: "quote-test",
              },
              yearly: null,
            },
            premium: { monthly: null, yearly: null },
          }
        : {},
    }),
  }),
}));
vi.mock("../src/features/billing/razorpay", () => ({
  payForPlan: mocks.payForPlan,
}));
vi.mock("../src/features/billing/api", () => ({
  cancelScheduledChange: vi.fn(),
  scheduleFreeDowngrade: vi.fn(),
}));
vi.mock("../src/features/settings/ChatRetentionCard", () => ({
  ChatRetentionCard: () => null,
}));
vi.mock("../src/features/settings/LeaveOrganizationCard", () => ({
  LeaveOrganizationCard: () => null,
}));
vi.mock("../src/features/settings/SessionsCard", () => ({
  SessionsCard: () => null,
}));
vi.mock("../src/features/billing/TestPaymentBox", () => ({
  TestPaymentBox: () => null,
}));
vi.mock("../src/features/billing/TestPlanDatesBox", () => ({
  TestPlanDatesBox: () => null,
}));
vi.mock("../src/api/auth", () => ({
  cancelEmailChange: vi.fn(),
  resendEmailChange: vi.fn(),
  requestEmailChange: vi.fn(),
  updatePersonalInformation: vi.fn(),
}));

import { orgKeys } from "../src/features/org/queries";
import { SettingsPage } from "../src/features/settings/SettingsPage";

const restoreCandidate = {
  _id: "force-project",
  tenantId: "org-1",
  name: "Force archived project",
  key: "FORCE",
  priority: "medium" as const,
  dueDate: null,
  archivedAt: "2026-09-01T00:00:00.000Z",
  archivedReason: "plan_limit" as const,
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  activeTaskCount: 0,
  completedTaskCount: 0,
  todoTaskCount: 0,
  inProgressTaskCount: 0,
  taskCount: 0,
  purgeAt: null,
};

const archivedResponse: ListProjectsResponse = {
  projects: [restoreCandidate],
  counts: { active: 0, archived: 1, bin: 0 },
  binRetentionDays: 30,
};

const baseOrg: Organization = {
  id: "org-1",
  name: "Test workspace",
  slug: "test-workspace",
  timeZone: "UTC",
  plan: "free",
  planExpiresAt: null,
  planExpiredAt: null,
  graceEnforcedAt: null,
  planExpiredFrom: null,
  graceEnforcedAt: null,
  graceArchived: null,
  seatLimit: 5,
  seatsUsed: 1,
  projectLimit: 3,
  projectCount: 1,
  adminCount: 1,
  chatRetentionDays: null,
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function makeOrg(): Organization {
  return {
    ...baseOrg,
    plan: mocks.plan,
    planExpiredAt: mocks.plan === "free" ? null : "2026-01-01T00:00:00.000Z",
    graceEnforcedAt: mocks.plan === "free" ? null : "2026-02-01T00:00:00.000Z",
  };
}

function mountSettings(queryClient = new QueryClient()) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

async function waitForInitialSettings() {
  await screen.findByRole("heading", { name: "Settings" });
  await waitFor(() => expect(mocks.listProjects).toHaveBeenCalled());
}

async function refreshPlanCheck(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: [...orgKeys.detail("org-1"), "restore-check"],
  });
}

beforeEach(() => {
  localStorage.clear();
  mocks.plan = "free";
  mocks.paymentsEnabled = false;
  mocks.billingImpact = null;
  mocks.getOrg.mockImplementation(async () => makeOrg());
  mocks.listProjects.mockResolvedValue(archivedResponse);
  mocks.listPlanArchivedRestoreTasks.mockResolvedValue([]);
  mocks.changePlan.mockImplementation(
    async (_orgId: string, plan: typeof mocks.plan) => {
      mocks.plan = plan;
      return makeOrg();
    },
  );
  mocks.payForPlan.mockImplementation(async () => {
    mocks.plan = "pro";
    return { status: "paid" };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Settings upgrade restore flow", () => {
  it("shows server-calculated downgrade impact, explanations, and affected projects in the review", async () => {
    mocks.plan = "premium";
    mocks.paymentsEnabled = true;
    mocks.billingImpact = {
      plan: "pro",
      capturedAt: "2026-10-08T10:00:00.000Z",
      seats: { used: 42, limit: 30, exceeded: true },
      projects: { active: 31, limit: 25, exceeded: true },
      tasks: {
        limit: 50,
        exceededProjectCount: 2,
        overages: [
          {
            projectId: "p1",
            projectName: "Project A",
            activeCount: 68,
            limit: 50,
          },
          {
            projectId: "p2",
            projectName: "Project B",
            activeCount: 55,
            limit: 50,
          },
        ],
      },
      withinLimits: false,
      fingerprint: "a".repeat(64),
    };
    mocks.getOrg.mockResolvedValue({
      ...baseOrg,
      plan: "premium",
      planExpiresAt: "2026-11-01T00:00:00.000Z",
      planExpiredAt: null,
      graceEnforcedAt: null,
      seatLimit: 100,
      projectLimit: 50,
    });
    mountSettings();
    await waitForInitialSettings();
    fireEvent.click(screen.getByRole("button", { name: /Switch to Pro/ }));

    const dialog = await screen.findByRole("dialog", {
      name: "Review subscription change",
    });
    expect(
      within(dialog).getByText(/Review usage above the Pro plan limits/),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("Your Pro subscription may start later"),
    ).toBeTruthy();
    expect(within(dialog).getByText("Members: 42 / 30 allowed")).toBeTruthy();
    expect(
      within(dialog).getByText("Active projects: 31 / 25 allowed"),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        "2 active projects exceed 50 open tasks per project",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByText("Show affected projects (2)"));
    expect(within(dialog).getByText("Project A: 68 / 50 allowed")).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "How downgrade limits affect this workspace",
      }),
    );
    expect(
      within(dialog).getByText(
        /A paid downgrade does not itself archive or delete resources/i,
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(/Premium access continues until/i),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(/10-day grace starts at that expiry/i),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(/verified Pro payment stays pending/i),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(/reviewed for restoration after usage fits/i),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Continue to Payment" }),
    ).toBeTruthy();
    expect(mocks.payForPlan).not.toHaveBeenCalled();
    const refreshedImpact = {
      ...(mocks.billingImpact as Record<string, unknown>),
      seats: { used: 20, limit: 30, exceeded: false },
      projects: { active: 4, limit: 25, exceeded: false },
      tasks: { limit: 50, exceededProjectCount: 0, overages: [] },
      withinLimits: true,
      fingerprint: "b".repeat(64),
    };
    mocks.payForPlan.mockImplementationOnce(async () => {
      mocks.billingImpact = refreshedImpact;
      throw new AxiosError(
        "Usage changed",
        "USAGE_CHANGED",
        undefined,
        undefined,
        {
          data: {
            error: {
              code: "USAGE_CHANGED",
              message: "Workspace usage changed",
              details: [refreshedImpact],
            },
          },
          status: 409,
          statusText: "Conflict",
          headers: {},
          config: {} as never,
        },
      );
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Continue to Payment" }),
    );
    expect(
      await within(dialog).findByText("Members: 20 / 30 allowed"),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        /Workspace usage changed\. The impact above has been refreshed/,
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("Current usage fits the Pro plan limits"),
    ).toBeTruthy();
    expect(
      within(dialog).queryByText("Your Pro subscription may start later"),
    ).toBeNull();
    expect(mocks.payForPlan).toHaveBeenCalledWith(
      "org-1",
      "pro",
      "monthly",
      expect.any(Object),
      "quote-test",
    );
  });

  it("does not show the temporary-Free warning when Premium usage fits Pro", async () => {
    mocks.plan = "premium";
    mocks.paymentsEnabled = true;
    mocks.billingImpact = {
      plan: "pro",
      capturedAt: "2026-10-08T10:00:00.000Z",
      seats: { used: 12, limit: 30, exceeded: false },
      projects: { active: 8, limit: 25, exceeded: false },
      tasks: { limit: 50, exceededProjectCount: 0, overages: [] },
      withinLimits: true,
      fingerprint: "c".repeat(64),
    };
    mocks.getOrg.mockResolvedValue({
      ...baseOrg,
      plan: "premium",
      planExpiresAt: "2026-11-01T00:00:00.000Z",
      planExpiredAt: null,
      graceEnforcedAt: null,
      seatLimit: 100,
      projectLimit: 50,
    });
    mountSettings();
    await waitForInitialSettings();
    fireEvent.click(screen.getByRole("button", { name: /Switch to Pro/ }));

    const dialog = await screen.findByRole("dialog", {
      name: "Review subscription change",
    });
    expect(
      within(dialog).getByText("Current usage fits the Pro plan limits"),
    ).toBeTruthy();
    expect(
      within(dialog).queryByText("Your Pro subscription may start later"),
    ).toBeNull();
    expect(mocks.payForPlan).not.toHaveBeenCalled();
  });

  it("does not show a prompt for existing archived resources on a normal Settings visit", async () => {
    mocks.plan = "pro";
    mocks.listProjects.mockResolvedValue({
      ...archivedResponse,
      projects: [{ ...restoreCandidate, archivedReason: null }],
    });
    mocks.getOrg.mockResolvedValue({
      ...baseOrg,
      plan: "pro",
      planExpiredAt: null,
      graceEnforcedAt: null,
    });
    mountSettings();
    await waitForInitialSettings();
    expect(
      screen.queryByRole("dialog", { name: "Review archived projects" }),
    ).toBeNull();
  });

  it("rechecks eligible projects after successful checkout and shows the prompt after plan refresh", async () => {
    mocks.paymentsEnabled = true;
    const { queryClient } = mountSettings();
    await waitForInitialSettings();

    fireEvent.click(screen.getByRole("button", { name: /Upgrade to Pro/ }));
    const review = await screen.findByRole("dialog", {
      name: "Review subscription change",
    });
    expect(mocks.payForPlan).not.toHaveBeenCalled();
    fireEvent.click(
      within(review).getByRole("button", { name: "Continue to Payment" }),
    );

    await waitFor(() => expect(mocks.payForPlan).toHaveBeenCalled());
    await waitFor(() =>
      expect(mocks.listProjects.mock.calls.length).toBeGreaterThan(1),
    );
    await refreshPlanCheck(queryClient);

    expect(
      await screen.findByRole("dialog", { name: "Review archived projects" }),
    ).toBeTruthy();
  });

  it("rechecks eligible projects after a direct plan change and shows the prompt", async () => {
    const { queryClient } = mountSettings();
    await waitForInitialSettings();

    fireEvent.click(screen.getByRole("button", { name: /Upgrade to Pro/ }));
    const review = await screen.findByRole("dialog", {
      name: "Review subscription change",
    });
    expect(mocks.changePlan).not.toHaveBeenCalled();
    fireEvent.click(
      within(review).getByRole("button", { name: "Confirm Change" }),
    );

    await waitFor(() =>
      expect(mocks.changePlan).toHaveBeenCalledWith("org-1", "pro"),
    );
    await waitFor(() =>
      expect(mocks.listProjects.mock.calls.length).toBeGreaterThan(1),
    );
    await refreshPlanCheck(queryClient);

    expect(
      await screen.findByRole("dialog", { name: "Review archived projects" }),
    ).toBeTruthy();
  });

  it("refreshes archived candidates when the polling plan check observes a webhook upgrade", async () => {
    const { queryClient } = mountSettings();
    await waitForInitialSettings();
    const callsBeforeUpgrade = mocks.listProjects.mock.calls.length;

    mocks.plan = "premium";
    await refreshPlanCheck(queryClient);

    expect(
      await screen.findByRole("dialog", { name: "Review archived projects" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(mocks.listProjects.mock.calls.length).toBeGreaterThan(
        callsBeforeUpgrade,
      ),
    );
  });

  it("persists Later dismissal and keeps the dedicated manual review action available", async () => {
    mocks.plan = "pro";
    const queryClient = new QueryClient();
    const firstVisit = mountSettings(queryClient);
    await waitForInitialSettings();

    expect(
      await screen.findByRole("dialog", { name: "Review archived projects" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Review archived projects" }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole("button", {
        name: "Review archived projects and tasks",
      }),
    ).toBeTruthy();
    expect(localStorage.getItem("worknest:restore-prompt:org-1")).toContain(
      "pro:",
    );

    firstVisit.unmount();
    mountSettings(queryClient);
    await waitForInitialSettings();
    expect(
      screen.queryByRole("dialog", { name: "Review archived projects" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Review archived projects and tasks",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Review archived projects" }),
    ).toBeTruthy();
  });

  it("shows the section for task-only candidates and hides it for manual archives", async () => {
    mocks.plan = "pro";
    mocks.listProjects.mockResolvedValue({
      ...archivedResponse,
      projects: [{ ...restoreCandidate, archivedReason: null }],
    });
    mocks.listPlanArchivedRestoreTasks.mockResolvedValue([
      {
        _id: "task-1",
        title: "Forced task",
        projectId: "active",
        projectName: "Active",
        projectKey: "ACT",
        archivedAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
    mountSettings();
    await waitForInitialSettings();
    expect(
      await screen.findByText("1 task can be reviewed for restoration."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Review archived projects and tasks",
      }),
    ).toBeTruthy();
  });
});
