import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Organization } from "../src/features/org/api";
import type { ListProjectsResponse } from "../src/features/projects/api";

const mocks = vi.hoisted(() => ({
  plan: "free" as "free" | "pro" | "premium",
  paymentsEnabled: false,
  listProjects: vi.fn(),
  listPlanArchivedRestoreTasks: vi.fn(),
  getOrg: vi.fn(),
  changePlan: vi.fn(),
  payForPlan: vi.fn(),
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
      testControls: false,
    }),
  }),
}));
vi.mock("../src/features/billing/razorpay", () => ({
  payForPlan: mocks.payForPlan,
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

  it("persists Later dismissal and offers a clear way to reopen the prompt", async () => {
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
      screen.getByRole("button", { name: "Review archived projects" }),
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
      screen.getByRole("button", { name: "Review archived projects" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Review archived projects" }),
    ).toBeTruthy();
  });
});
