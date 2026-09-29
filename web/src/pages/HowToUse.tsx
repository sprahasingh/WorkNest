import { Link } from "react-router";
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
    title: "Create your account and organization",
    description:
      "Register with your name, email, and a password. Registering also creates your first organization — you're automatically its admin.",
  },
  {
    title: "Create a project",
    description:
      "Go to Projects → New project. Give it a name and a short key (like ENG or OPS) used to label its tasks. Admins and managers can create projects.",
  },
  {
    title: "Invite your team",
    description:
      "Go to Members → Invite someone. Enter their email and pick a role. You'll get a one-time invite link to send them — only admins can send invites.",
  },
  {
    title: "Create and assign a task",
    description:
      "Open a project and click New task. Set a title, priority, optional due date, and tick one or more assignees. Admins and managers can assign anyone; a task a member creates is assigned to them. On the free plan a project can hold up to 10 active (not done) tasks.",
  },
  {
    title: "Move a task through its board",
    description:
      "Each task has a status dropdown right on its card — To do, In progress, or Done. Members can edit and move the tasks assigned to them; admins and managers can edit and move any task.",
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
      "Admins can see a full history of who changed what — renamed the org, removed a member, deleted a task — and when it happened.",
  },
  {
    title: "Manage your plan",
    description:
      "Settings → Plan shows your seat and project usage. Admins can upgrade or downgrade between the free and pro plans as your team grows; pro removes the per-project task limit.",
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
      &mdash;
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

export function HowToUse() {
  const auth = useAuth();
  const isAuthenticated = auth.status === "authenticated";
  const workspacePath = resolvePostAuthPath(auth.memberships ?? []);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <header className="border-b border-slate-100 dark:border-slate-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <BrandMark />
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              to="/"
              className="text-sm font-medium text-slate-500 hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-400"
            >
              Back to home
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
          Everything you need to get a team up and running: the core
          concepts, the common tasks, and exactly who&apos;s allowed to do
          what.
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
                Your team&apos;s workspace. Its data, projects, and members
                are completely isolated from every other organization on
                WorkNest.
              </p>
            </Card>
            <Card className="shadow-none dark:border-slate-700 dark:bg-slate-800">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                Project
              </h3>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                A container for related tasks, identified by a short key
                (e.g. ENG-12). Projects can be archived once they&apos;re
                done, without deleting their history.
              </p>
            </Card>
            <Card className="shadow-none dark:border-slate-700 dark:bg-slate-800">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                Task
              </h3>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                A single unit of work with a status, priority, optional due
                date, and one or more assignees, tracked on its
                project&apos;s board.
              </p>
            </Card>
            <Card className="shadow-none dark:border-slate-700 dark:bg-slate-800">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                Members &amp; roles
              </h3>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                Every person in an organization is an Admin, Manager, or
                Member. Roles decide exactly what they can see and do — see
                the table below.
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
            Roles are enforced on the server, not just hidden in the UI — a
            Member can&apos;t do an Admin-only action even by calling the API
            directly.
          </p>

          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Capability</th>
                  <th className="px-4 py-3 text-center font-medium">Admin</th>
                  <th className="px-4 py-3 text-center font-medium">
                    Manager
                  </th>
                  <th className="px-4 py-3 text-center font-medium">
                    Member
                  </th>
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
