import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { Role } from "@/api/auth";

interface Step {
  title: string;
  description: string;
  action?: { label: string; to: string };
}
interface PageStep {
  target: string;
  title: string;
  description: string;
  roles?: Role[];
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
const pageTours: Record<string, PageStep[]> = {
  dashboard: [
    {
      target: "dashboard-view",
      title: "Tasks and Projects views",
      description:
        "Switch between task workload and project progress. The selected view changes the charts below.",
    },
    {
      target: "dashboard-range",
      title: "Choose a date range",
      description:
        "Compare activity across recent periods or choose all time. Charts update to match this range.",
    },
    {
      target: "dashboard-chart",
      title: "Track task status",
      description:
        "This chart shows how work status has changed over the selected date range.",
    },
    {
      target: "dashboard-priority",
      title: "Spot priority work",
      description:
        "See open work by priority and identify tasks that need attention soon.",
    },
    {
      target: "dashboard-flow",
      title: "Compare created and completed work",
      description:
        "Compare tasks created with tasks completed to see whether work is building up or getting cleared.",
    },
    {
      target: "dashboard-workload",
      title: "Review workload",
      description:
        "See how open tasks are distributed across teammates and spot unassigned work.",
    },
  ],
  projects: [
    {
      target: "projects-create",
      title: "Create a project",
      description:
        "Start a project with a name and short key. Open it to create and organize its tasks.",
      roles: ["admin", "manager"],
    },
    {
      target: "projects-tabs",
      title: "Project lists",
      description:
        "Active and Completed help you find current work. Archived keeps work out of the way, and Bin contains deleted projects temporarily.",
    },
    {
      target: "projects-sort",
      title: "Sort projects",
      description:
        "Choose which projects appear first, such as recently updated or due soon.",
    },
    {
      target: "projects-first-card",
      title: "Project cards",
      description:
        "Review progress and due dates. Use Open to see the project board; card actions are under More.",
    },
  ],
  tasks: [
    {
      target: "tasks-create",
      title: "Add a task",
      description:
        "Create work in this project, then add details, priority, a due date, and assignees.",
      roles: ["admin", "manager"],
    },
    {
      target: "tasks-tabs",
      title: "Task lists",
      description:
        "Active, Completed, Archived, and Bin keep tasks in the right place throughout their lifecycle.",
    },
    {
      target: "tasks-filters",
      title: "Filter and sort",
      description:
        "Narrow the board by priority or assignee, show only your tasks, and change the sort order.",
    },
    {
      target: "tasks-first-card",
      title: "Task cards",
      description:
        "Change an active task’s status here. Open a task for details and updates; use More for lifecycle actions.",
    },
    {
      target: "tasks-updates",
      title: "Project updates",
      description:
        "Share an update with the people following this project and review its update history.",
    },
  ],
  meetings: [
    {
      target: "meetings-actions",
      title: "Schedule or start",
      description:
        "Schedule a meeting with an agenda and invitees, or start an immediate meeting.",
    },
    {
      target: "meetings-tabs",
      title: "Meeting views",
      description:
        "Upcoming and Past show meeting lists. Calendar helps you browse by date.",
    },
    {
      target: "meetings-content",
      title: "Meeting details",
      description:
        "Open a meeting to review its agenda, join link, and invitation response options.",
    },
  ],
  messages: [
    {
      target: "messages-content",
      title: "Conversation list",
      description:
        "Choose a teammate or group to open a conversation. Start a new chat from the conversation list, or reopen recent conversations here.",
    },
    {
      target: "messages-search",
      title: "Find a conversation",
      description:
        "Search for people, groups, or messages to return to the right conversation.",
    },
    {
      target: "messages-new",
      title: "Start a chat",
      description: "Start a one-to-one or group conversation with teammates.",
    },
  ],
  members: [
    {
      target: "members-content",
      title: "Organization members",
      description:
        "Review teammates and their roles. Admins can invite people and manage access.",
    },
    {
      target: "members-invites",
      title: "Invitations",
      description: "Admins can invite teammates and track pending invitations.",
      roles: ["admin"],
    },
  ],
  settings: [
    {
      target: "settings-organization",
      title: "Organization details",
      description:
        "Edit the organization name, time zone, and chat-history retention.",
      roles: ["admin"],
    },
    {
      target: "settings-content",
      title: "Organization settings",
      description:
        "Admins can update organization details, time zone, retention, and plan settings.",
      roles: ["admin"],
    },
  ],
  audit: [
    {
      target: "audit-content",
      title: "Audit history",
      description:
        "Review recorded organization changes, including who made each change and when.",
      roles: ["admin"],
    },
    {
      target: "audit-entries",
      title: "Review changes",
      description: "Browse the audit history and load older events as needed.",
      roles: ["admin"],
    },
  ],
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
        "Chat one-to-one or in groups, reply, react, mention teammates and share files.",
      action: { label: "Explore Messages", to: path("messages") },
    },
    meetings: {
      title: "Meetings",
      description:
        "Schedule meetings, join with a link, and respond to invitations.",
      action: { label: "Explore Meetings", to: path("meetings") },
    },
  };
  const common = [
    welcome,
    {
      title: "Your dashboard",
      description:
        "Review task workload, project progress and activity over a date range.",
      action: { label: "Explore dashboard", to: path("dashboard") },
    },
    {
      title: role === "member" ? "Find your work" : "Projects and tasks",
      description:
        role === "member"
          ? "Find assigned tasks, check priorities and due dates, and update your work."
          : "Create projects, organize tasks, set priorities and due dates, and assign teammates.",
      action: { label: "Explore Projects", to: path("projects") },
    },
    shared.messages,
    shared.meetings,
  ];
  if (role === "admin")
    common.push(
      {
        title: "People and access",
        description: "Invite teammates and manage their organization roles.",
        action: { label: "Explore people", to: path("members") },
      },
      {
        title: "Organization settings",
        description: "Manage organization details, retention and plans.",
        action: { label: "Explore settings", to: path("settings") },
      },
      {
        title: "Organization activity",
        description: "Review important changes and when they happened.",
        action: { label: "Explore audit log", to: path("audit") },
      },
    );
  else if (role === "manager")
    common.push({
      title: "Find your teammates",
      description:
        "View organization members and their roles. Admins manage invitations and billing.",
      action: { label: "Explore people", to: path("members") },
    });
  else
    common.push({
      title: "Your organization",
      description:
        "See who is in the organization and check your personal settings.",
    });
  return common;
}

function pageKey(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "orgs" || !parts[2]) return null;
  if (parts[2] === "projects" && parts[3]) return "tasks";
  return parts[2] in pageTours ? parts[2] : null;
}

export function OnboardingTour({
  role,
  orgId,
  orgName,
  onClose,
}: OnboardingTourProps) {
  const location = useLocation();
  const steps = useMemo(
    () => stepsFor(role, orgId, orgName),
    [role, orgId, orgName],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [pageIndexes, setPageIndexes] = useState<Record<string, number>>({});
  const [pageMode, setPageMode] = useState<{
    key: string;
    returnStep: number;
  } | null>(null);
  const [position, setPosition] = useState({ top: 12, left: 12 });
  const targetRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const targetStylesRef = useRef<{
    outline: string;
    outlineOffset: string;
    position: string;
    zIndex: string;
  } | null>(null);
  const isLastStep = stepIndex === steps.length - 1;
  const step = steps[stepIndex]!;
  const currentPage = pageKey(location.pathname);
  const activePageKey =
    pageMode?.key === currentPage
      ? currentPage
      : pageMode?.key === "projects" && currentPage === "tasks"
        ? "tasks"
        : null;
  const pageIndex = activePageKey ? (pageIndexes[activePageKey] ?? 0) : 0;
  const availablePageSteps = (
    activePageKey ? (pageTours[activePageKey] ?? []) : []
  ).filter((item) => !item.roles || item.roles.includes(role));
  const pageStep = availablePageSteps[pageIndex];

  const positionCard = () => {
    const target = targetRef.current;
    const card = cardRef.current;
    if (!card) return;
    const box = card.getBoundingClientRect();
    if (!target) {
      setPosition({
        top: Math.max(12, (window.innerHeight - box.height) / 2),
        left: Math.max(12, (window.innerWidth - box.width) / 2),
      });
      return;
    }
    const rect = target.getBoundingClientRect();
    const margin = 12;
    const left =
      window.innerWidth < 640
        ? margin
        : Math.min(
            Math.max(margin, rect.left + rect.width / 2 - box.width / 2),
            window.innerWidth - box.width - margin,
          );
    const below = rect.bottom + margin;
    const top =
      below + box.height <= window.innerHeight - margin
        ? below
        : Math.max(margin, rect.top - box.height - margin);
    setPosition({
      top: Math.min(top, window.innerHeight - box.height - margin),
      left,
    });
  };

  useLayoutEffect(() => {
    const card = cardRef.current;
    const target = pageStep
      ? (Array.from(
          document.querySelectorAll<HTMLElement>(
            `[data-tour="${pageStep.target}"]`,
          ),
        ).find((candidate) => candidate.getClientRects().length > 0) ?? null)
      : null;
    targetRef.current = target;
    if (target) {
      target.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
      targetStylesRef.current = {
        outline: target.style.outline,
        outlineOffset: target.style.outlineOffset,
        position: target.style.position,
        zIndex: target.style.zIndex,
      };
      target.style.setProperty("outline", "3px solid rgb(13 148 136)");
      target.style.setProperty("outline-offset", "4px");
      target.style.setProperty("position", "relative");
      target.style.setProperty("z-index", "51");
    }
    const update = () => positionCard();
    const frame = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer =
      card && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;
    if (card) observer?.observe(card);
    if (target) observer?.observe(target);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
      if (target) {
        const previous = targetStylesRef.current;
        if (previous) {
          target.style.outline = previous.outline;
          target.style.outlineOffset = previous.outlineOffset;
          target.style.position = previous.position;
          target.style.zIndex = previous.zIndex;
        }
        targetStylesRef.current = null;
      }
    };
  }, [pageMode, pageIndex, pageStep, location.pathname]);

  // Navigation can render its page controls after the route changes; remeasure
  // after the transition settles so the callout stays anchored to the target.
  useEffect(() => {
    const timer = window.setTimeout(positionCard, 180);
    return () => window.clearTimeout(timer);
  }, [location.pathname, pageStep]);

  const startPageTour = (to: string, index: number) => {
    const key =
      to.split("/").filter(Boolean).at(-1) === "projects"
        ? "projects"
        : to.split("/").filter(Boolean).at(-1)!;
    if (key in pageTours) {
      setPageMode({ key, returnStep: index });
      setPageIndexes((indexes) => ({ ...indexes, [key]: 0 }));
    }
  };
  const returnToMain = () => {
    setStepIndex(pageMode?.returnStep ?? stepIndex);
    setPageMode(null);
  };
  const finishPage = () => {
    const last = pageIndex >= availablePageSteps.length - 1;
    if (last) returnToMain();
    else if (activePageKey) {
      setPageIndexes((indexes) => ({
        ...indexes,
        [activePageKey]: pageIndex + 1,
      }));
    }
  };

  if (activePageKey && availablePageSteps.length) {
    const active = pageStep!;
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-slate-950/35"
          aria-hidden="true"
        />
        <section
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="page-tour-title"
          className="fixed z-[60] w-[calc(100vw-24px)] max-w-sm overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-800 sm:p-5"
          style={{
            top: position.top,
            left: position.left,
            maxHeight: "min(70dvh, 30rem)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {roleName[role]} · {pageIndex + 1} of {availablePageSteps.length}
            </p>
            <button
              type="button"
              onClick={returnToMain}
              className="text-xs font-medium text-slate-600 underline dark:text-slate-300"
            >
              Back to main tour
            </button>
          </div>
          <h2
            id="page-tour-title"
            className="mt-2 text-lg font-bold text-slate-900 dark:text-slate-50"
          >
            {active.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {active.description}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={returnToMain}
              className="text-xs font-medium text-slate-500 underline dark:text-slate-400"
            >
              Skip this page tour
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="text-xs font-medium text-red-600 underline dark:text-red-400"
              >
                Skip entire tour
              </button>
              <Button size="sm" onClick={finishPage}>
                {pageIndex === availablePageSteps.length - 1
                  ? "Return to main tour"
                  : "Next"}
              </Button>
            </div>
          </div>
        </section>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 px-3 py-4 backdrop-blur-sm sm:px-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-xl dark:bg-slate-800 sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
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
            className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400"
          >
            Skip entire tour
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
            onClick={() => startPageTour(step.action!.to, stepIndex)}
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
            any time.
          </p>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
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
          <div className="flex shrink-0 gap-2">
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
