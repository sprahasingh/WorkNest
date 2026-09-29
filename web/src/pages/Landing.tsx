import type { ReactElement } from "react";
import { Link } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { Card } from "@/components/ui/Card";

interface Feature {
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    title: "Isolated workspaces",
    description:
      "Every organization's data is scoped at the database layer, not just the UI, so one tenant can never see another's projects, tasks, or members.",
  },
  {
    title: "Role-based access control",
    description:
      "Admins, managers, and members each get a precise set of permissions, enforced on the server for every action, not just hidden buttons.",
  },
  {
    title: "Full audit trail",
    description:
      "Every meaningful change, from renaming an org to reassigning a task, is recorded with who did it and when.",
  },
  {
    title: "Live usage dashboard",
    description:
      "Track overdue tasks, team activity, and seat and project usage against your plan at a glance.",
  },
  {
    title: "Kanban task boards",
    description:
      "Organize work by project with drag-free status columns, priorities, due dates, and assignees.",
  },
  {
    title: "Secure by default",
    description:
      "Short-lived access tokens with rotating refresh sessions, reuse detection, and hashed invite links.",
  },
];

interface SocialLink {
  label: string;
  href: string;
  icon: (props: { className?: string }) => ReactElement;
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.446-2.136 2.94v5.666H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function EmailIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

const SOCIAL_LINKS: SocialLink[] = [
  {
    label: "Email",
    href: "mailto:sprahasinghwork@gmail.com",
    icon: EmailIcon,
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/sprahasingh/",
    icon: LinkedInIcon,
  },
  {
    label: "GitHub",
    href: "https://github.com/sprahasingh",
    icon: GitHubIcon,
  },
];

function BrandMark() {
  return (
    <span className="flex items-center gap-2 text-lg font-bold text-slate-900">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white">
        W
      </span>
      WorkNest
    </span>
  );
}

function ProductPreview() {
  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/60">
      <div className="flex items-center justify-between">
        <div className="h-3 w-24 rounded-full bg-slate-200" />
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-300" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-300" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        {[
          { label: "Overdue", value: "3" },
          { label: "Members", value: "3/5" },
          { label: "Projects", value: "3/3" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg bg-slate-50 p-3">
            <p className="text-[11px] font-medium text-slate-400">
              {stat.label}
            </p>
            <p className="mt-1 text-lg font-bold text-slate-800">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-end gap-2 rounded-lg bg-slate-50 p-3">
        {[60, 85, 45, 95, 70, 55, 80].map((height, index) => (
          <div
            key={index}
            className="flex-1 rounded-t bg-teal-500/80"
            style={{ height: `${height * 0.5}px` }}
          />
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {["Ship onboarding flow", "Fix billing webhook"].map((title) => (
          <div
            key={title}
            className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2"
          >
            <span className="text-xs font-medium text-slate-700">
              {title}
            </span>
            <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">
              in progress
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Landing() {
  const auth = useAuth();
  const isAuthenticated = auth.status === "authenticated";

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <BrandMark />
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              to="/how-to-use"
              className="hidden text-sm font-medium text-slate-600 hover:text-teal-700 sm:inline-block"
            >
              How it works
            </Link>
            {isAuthenticated ? (
              <Link
                to="/orgs"
                className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 sm:px-4"
              >
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:px-4"
                >
                  Log in
                </Link>
                <Link
                  to="/register"
                  className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 sm:px-4"
                >
                  Register
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <span className="inline-flex items-center rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">
                Multi-tenant project management
              </span>
              <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
                One workspace, every team, properly isolated.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-slate-600">
                WorkNest is a project and task management workspace built for
                organizations that need real tenant isolation, role-based
                permissions, and a full audit trail, not just a shared todo
                list with extra steps.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/register"
                  className="inline-flex items-center justify-center rounded-lg bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700"
                >
                  Get started free
                </Link>
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Log in
                </Link>
              </div>
              <p className="mt-4 text-sm text-slate-400">
                No credit card required. Free plan included.
              </p>
            </div>

            <div className="flex justify-center lg:justify-end">
              <ProductPreview />
            </div>
          </div>
        </section>

        <section className="border-t border-slate-100 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
                Everything a growing team needs, nothing it has to build
                itself.
              </h2>
              <p className="mt-3 text-slate-600">
                Tenant isolation and access control are enforced at the data
                layer, so your team can move fast without worrying about
                permission bugs or data leaking across organizations.
              </p>
            </div>

            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <Card key={feature.title} className="shadow-none">
                  <h3 className="font-semibold text-slate-800">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {feature.description}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="rounded-2xl bg-teal-600 px-6 py-12 text-center sm:px-12 sm:py-16">
            <h2 className="text-2xl font-bold text-white sm:text-3xl">
              Set up your organization in under a minute.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-teal-50">
              Create your account, invite your team, and start tracking work
              with proper access control from day one.
            </p>
            <Link
              to="/register"
              className="mt-8 inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 text-sm font-semibold text-teal-700 shadow-sm transition-colors hover:bg-teal-50"
            >
              Create your workspace
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-100">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:justify-between sm:px-6">
          <BrandMark />

          <div className="flex items-center gap-4">
            {SOCIAL_LINKS.map(({ label, href, icon: Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                title={label}
                className="text-slate-400 transition-colors hover:text-teal-700"
              >
                <Icon className="h-5 w-5" />
              </a>
            ))}
          </div>

          <p>&copy; {new Date().getFullYear()} WorkNest. Built by Spraha Singh.</p>
        </div>
      </footer>
    </div>
  );
}
