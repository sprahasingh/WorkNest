import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { Role } from "@/api/auth";

interface Step {
  title: string;
  description: string;
  action?: { label: string; to: string };
}

interface OnboardingTourProps {
  role: Role;
  orgId: string;
  orgName: string;
  onClose: () => void;
}

const roleName: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  member: "Member",
};

function stepsFor(role: Role, orgId: string, orgName: string): Step[] {
  const path = (page: string) => `/orgs/${orgId}/${page}`;
  const welcome: Step = {
    title: `Welcome to ${orgName}`,
    description: `You’re joining as an ${roleName[role]}. This quick tour covers what you can do in this organization and where to find it. You can replay it any time from the sidebar.`,
  };
  const shared: Record<string, Step> = {
    messages: {
      title: "Messages",
      description:
        "Chat one-to-one or in groups, reply, react, mention teammates and share files. Chat history follows the organization’s retention setting; admins choose the limit.",
      action: { label: "Open Messages", to: path("messages") },
    },
    meetings: {
      title: "Meetings",
      description:
        "Schedule a meeting with an agenda and join link, or respond to an invitation with Accept, Maybe or Decline. You’ll get reminders before it starts.",
      action: { label: "Open Meetings", to: path("meetings") },
    },
  };

  if (role === "admin") {
    return [
      welcome,
      {
        title: "Your dashboard",
        description:
          "Switch between Tasks and Projects to see workload, progress and what needs attention. Choose a date range to understand how work is changing.",
        action: { label: "Open dashboard", to: path("dashboard") },
      },
      {
        title: "Projects and tasks",
        description:
          "Create projects, organize work into tasks, set priorities and due dates, and assign teammates. Use project progress to see how work is moving.",
        action: { label: "Open Projects", to: path("projects") },
      },
      {
        title: "Keep work moving",
        description:
          "Ask for task updates, follow replies and comments, and use notifications to spot changes. Managers can do this too; members update the tasks they work on.",
        action: { label: "View projects", to: path("projects") },
      },
      shared.messages,
      shared.meetings,
      {
        title: "People and access",
        description:
          "Invite teammates as Admins, Managers or Members. You can review access, change roles and manage the team here.",
        action: { label: "Manage people", to: path("members") },
      },
      {
        title: "Organization settings",
        description:
          "Change the organization name and time zone, set chat-history retention and manage the plan. Organization changes ask you to confirm your current password.",
        action: { label: "Open settings", to: path("settings") },
      },
      {
        title: "Review organization activity",
        description:
          "The audit log records important changes, so you can see who changed what and when.",
        action: { label: "Open audit log", to: path("audit") },
      },
    ];
  }

  if (role === "manager") {
    return [
      welcome,
      {
        title: "Your dashboard",
        description:
          "Use the Tasks and Projects views to review workload, project progress and overdue work. Change the date range to see recent activity.",
        action: { label: "Open dashboard", to: path("dashboard") },
      },
      {
        title: "Organize projects and tasks",
        description:
          "Create projects and tasks, set priorities and due dates, and assign work across the team. Project progress shows how much work is done.",
        action: { label: "Open Projects", to: path("projects") },
      },
      {
        title: "Ask for updates",
        description:
          "Request updates on tasks or projects, then follow replies and comments in context. Notifications help you see what changed.",
        action: { label: "View projects", to: path("projects") },
      },
      shared.messages,
      shared.meetings,
      {
        title: "Find your teammates",
        description:
          "View the organization’s members and their roles. Organization settings, invitations and billing are managed by an admin.",
        action: { label: "View people", to: path("members") },
      },
    ];
  }

  return [
    welcome,
    {
      title: "Find your work",
      description:
        "Open Projects to find tasks assigned to you. Check priorities and due dates, update your task status as you work, and leave comments for the team.",
      action: { label: "Open Projects", to: path("projects") },
    },
    {
      title: "Share progress",
      description:
        "When a manager asks for an update, reply on the task so the people following the work can see the latest. You can also comment or mention a teammate.",
      action: { label: "View tasks", to: path("projects") },
    },
    shared.messages,
    shared.meetings,
    {
      title: "Your organization",
      description:
        "See who is in the organization and check your personal settings. An admin manages organization details, chat-history retention and plans.",
      action: { label: "View people", to: path("members") },
    },
  ];
}

export function OnboardingTour({
  role,
  orgId,
  orgName,
  onClose,
}: OnboardingTourProps) {
  const steps = stepsFor(role, orgId, orgName);
  const [stepIndex, setStepIndex] = useState(0);
  const isLastStep = stepIndex === steps.length - 1;
  const step = steps[stepIndex]!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-800"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">
              W
            </span>
            <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800 dark:bg-teal-900/40 dark:text-teal-200">
              {roleName[role]}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Skip tour
          </button>
        </div>

        <p className="mt-5 text-xs font-medium text-slate-500 dark:text-slate-400">
          Step {stepIndex + 1} of {steps.length} · {orgName}
        </p>
        <h2
          id="onboarding-title"
          className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-50"
        >
          {step.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {step.description}
        </p>

        {step.action && (
          <Link
            to={step.action.to}
            onClick={onClose}
            className="mt-4 inline-flex text-sm font-semibold text-teal-700 hover:underline dark:text-teal-400"
          >
            {step.action.label} →
          </Link>
        )}

        {isLastStep && (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Need more detail? Open the{" "}
            <Link
              to="/how-to-use"
              target="_blank"
              className="font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              how-to-use guide
            </Link>{" "}
            any time from the menu.
          </p>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="flex min-w-0 gap-1.5" aria-hidden="true">
            {steps.map((item, index) => (
              <span
                key={item.title}
                className={cn(
                  "h-1.5 w-3 rounded-full transition-colors sm:w-4",
                  index === stepIndex
                    ? "bg-teal-600"
                    : "bg-slate-200 dark:bg-slate-700",
                )}
              />
            ))}
          </div>

          <div className="flex shrink-0 gap-2 whitespace-nowrap">
            {stepIndex > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStepIndex((index) => index - 1)}
              >
                Back
              </Button>
            )}
            <Button
              size="sm"
              onClick={() =>
                isLastStep ? onClose() : setStepIndex((index) => index + 1)
              }
            >
              {isLastStep ? "Finish" : "Next"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
