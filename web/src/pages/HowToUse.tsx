import { Link, useLocation } from "react-router";
import { Card } from "@/components/ui/Card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/auth/auth-context";
import { resolvePostAuthPath } from "@/lib/postAuthRedirect";

interface GuideStep {
  title: string;
  description: string;
}

const STEPS: GuideStep[] = [
  {
    title: "Choose your account type",
    description:
      "Register with your name, email, and a password. Choose Admin to create an organization and manage it, or User to create an account without an organization and join one later.",
  },
  {
    title: "Create a project",
    description:
      "Go to Projects → New project. Give it a name and a short key (like ENG or OPS) used to label its tasks. Admins and managers can create projects.",
  },
  {
    title: "Invite your team",
    description:
      "Open Members and choose Invite someone. Enter their email and choose a role. Admins can send invitations. People who already use WorkNest can accept from their notifications or Organizations page.",
  },
  {
    title: "Create and assign a task",
    description:
      "Open a project and choose New task. Add a title, priority, optional due date, and one or more assignees. Admins and managers can assign anyone; a task created by a member is assigned to them. Each plan limits active tasks per project: 10 on Free, 50 on Pro, and unlimited on Premium. Done, archived, and binned tasks do not use this allowance. Reopening or restoring an active task uses a slot again.",
  },
  {
    title: "Move a task through its board",
    description:
      "Use the status menu on a task to move it between To do, In progress, and Done. Members can edit and move tasks assigned to them. Admins and managers can edit and move any task.",
  },
  {
    title: "Keep project lists current",
    description:
      "A project moves to Completed when all its tasks are done. Archive a project to hide it from everyday work, or move it to the Bin to remove it temporarily. Completed, archived, and binned projects do not use a project slot. Unarchiving or restoring a project with unfinished work, or reopening work in a completed project, uses a slot again and may be blocked when your plan is full. Binned projects can be restored for 30 days.",
  },
  {
    title: "Ask for and share updates",
    description:
      "Admins and managers can request an update on one task, or on a whole project to reach every assignee at once, and reply to questions. Assignees post updates or ask questions from a task's Updates tab or from Project updates, which also collects every task's updates in one place. Everyone involved is notified through the bell, and opening the task or project marks those notifications as read.",
  },
  {
    title: "Check the dashboard",
    description:
      "Admins and managers see overdue tasks, team activity, and usage against your plan at a glance, plus a trend of new tasks over the last 7 to 90 days.",
  },
  {
    title: "Review the audit log",
    description:
      "Admins can see who changed what and when, including organization settings, membership, projects, tasks, and plans.",
  },
  {
    title: "Manage your plan",
    description:
      "Open Settings to compare plans and check usage. Free includes 5 seats, 3 active projects, and 10 active tasks per project. Pro includes 30 seats, 25 active projects, and 50 active tasks per project. Premium includes 100 seats, 50 active projects, and unlimited active tasks per project. Only admins can change plans. A downgrade is available once your usage fits the lower limits.",
  },
];

interface PermissionRow {
  capability: string;
  admin: boolean;
  manager: boolean;
  member: boolean;
}

const PERMISSIONS: PermissionRow[] = [
  {
    capability: "View the organization, projects, and members",
    admin: true,
    manager: true,
    member: true,
  },
  {
    capability: "See tasks assigned only to admins or managers",
    admin: true,
    manager: true,
    member: false,
  },
  { capability: "Create tasks", admin: true, manager: true, member: true },
  {
    capability: "Edit and move tasks assigned to you",
    admin: true,
    manager: true,
    member: true,
  },
  {
    capability: "Edit or move any task",
    admin: true,
    manager: true,
    member: false,
  },
  {
    capability: "Post updates and ask questions on your tasks",
    admin: true,
    manager: true,
    member: true,
  },
  {
    capability: "Request updates and reply to questions",
    admin: true,
    manager: true,
    member: false,
  },
  { capability: "Delete tasks", admin: true, manager: true, member: false },
  {
    capability: "Assign tasks to teammates",
    admin: true,
    manager: true,
    member: false,
  },
  {
    capability: "Create, archive, or delete projects",
    admin: true,
    manager: true,
    member: false,
  },
  {
    capability: "View the dashboard",
    admin: true,
    manager: true,
    member: false,
  },
  {
    capability: "Invite people to the organization",
    admin: true,
    manager: false,
    member: false,
  },
  {
    capability: "Change a member's role, or remove them",
    admin: true,
    manager: false,
    member: false,
  },
  {
    capability: "Rename the organization",
    admin: true,
    manager: false,
    member: false,
  },
  {
    capability: "Change the plan",
    admin: true,
    manager: false,
    member: false,
  },
  {
    capability: "View the audit log",
    admin: true,
    manager: false,
    member: false,
  },
];

function Check({ value }: { value: boolean }) {
  return value ? (
    <span className="text-teal-600 dark:text-teal-400" aria-label="Yes">
      &#10003;
    </span>
  ) : (
    <span className="text-slate-300 dark:text-slate-600" aria-label="No">
      No
    </span>
  );
}

function BrandMark() {
  return (
    <Link
      to="/"
      className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-slate-100"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white">
        W
      </span>
      WorkNest
    </Link>
  );
}

// Where the back link goes: the page you came from inside the app, else your
// workspace if you're signed in, else the home page.
function useBackLink(): { to: string; label: string } {
  const location = useLocation();
  const auth = useAuth();
  const from = (location.state as { from?: unknown } | null)?.from;

  if (
    typeof from === "string" &&
    from.startsWith("/") &&
    !from.startsWith("//")
  ) {
    return { to: from, label: "Back" };
  }
  if (auth.status === "authenticated") {
    return {
      to: resolvePostAuthPath(auth.memberships ?? []),
      label: "Back to your workspace",
    };
  }
  return { to: "/", label: "Back to home" };
}

export function HowToUse() {
  const auth = useAuth();
  const isAuthenticated = auth.status === "authenticated";
  const workspacePath = resolvePostAuthPath(auth.memberships ?? []);
  const back = useBackLink();

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <header className="border-b border-slate-100 dark:border-slate-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <BrandMark />
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              to={back.to}
              className="text-sm font-medium text-slate-500 hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-400"
            >
              <span aria-hidden="true">← </span>
              {back.label}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <span className="inline-flex items-center rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
          Guide
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl dark:text-slate-50">
          How to use WorkNest
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-400">
          Everything you need to get a team up and running: the core concepts,
          the common tasks, and exactly who&apos;s allowed to do what.
        </p>

        <section className="mt-12">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">
            Core concepts
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Card className="shadow-none dark:border-slate-700 dark:bg-slate-800">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                Organization
              </h3>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                Your team&apos;s workspace. Its data, projects, and members are
                completely isolated from every other organization on WorkNest.
              </p>
            </Card>
            <Card className="shadow-none dark:border-slate-700 dark:bg-slate-800">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                Project
              </h3>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                A container for related tasks, identified by a short key (e.g.
                ENG-12). Projects can be archived once they&apos;re done,
                without deleting their history.
              </p>
            </Card>
            <Card className="shadow-none dark:border-slate-700 dark:bg-slate-800">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                Task
              </h3>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                A single unit of work with a status, priority, optional due
                date, and one or more assignees, tracked on its project&apos;s
                board.
              </p>
            </Card>
            <Card className="shadow-none dark:border-slate-700 dark:bg-slate-800">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                Members &amp; roles
              </h3>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                Every person in an organization is an Admin, Manager, or Member.
                Roles decide what each person can see and do. See the table
                below.
              </p>
            </Card>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">
            Common tasks, step by step
          </h2>
          <ol className="mt-5 space-y-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-100">
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                    {step.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">
            Who can do what
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Roles are enforced on the server, not just hidden in the UI. A
            Member can&apos;t do an Admin-only action even by calling the API
            directly.
          </p>

          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Capability</th>
                  <th className="px-4 py-3 text-center font-medium">Admin</th>
                  <th className="px-4 py-3 text-center font-medium">Manager</th>
                  <th className="px-4 py-3 text-center font-medium">Member</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((row) => (
                  <tr
                    key={row.capability}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800 dark:bg-slate-800/40"
                  >
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      {row.capability}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Check value={row.admin} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Check value={row.manager} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Check value={row.member} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12 rounded-2xl bg-teal-600 px-6 py-10 text-center sm:px-10">
          <h2 className="text-2xl font-bold text-white">
            Ready to set up your workspace?
          </h2>
          <Link
            to={isAuthenticated ? workspacePath : "/register"}
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 text-sm font-semibold text-teal-700 shadow-sm transition-colors hover:bg-teal-50"
          >
            {isAuthenticated ? "Go to your workspace" : "Create your account"}
          </Link>
        </section>
      </main>
    </div>
  );
}
