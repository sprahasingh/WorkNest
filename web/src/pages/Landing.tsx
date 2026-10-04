import { useState, type ReactElement } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { HelpLinks } from "@/components/HelpLinks";
import { BrandLink } from "@/components/BrandLink";
import { useAuth } from "@/auth/auth-context";
import { resolvePostAuthPath } from "@/lib/postAuthRedirect";
import { readSignedInHint } from "@/lib/sessionHint";
import { parseApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountCard, MenuButton, MenuPanel } from "@/components/MenuPanel";
import { HeroPreview } from "@/components/marketing/HeroPreview";
import { ScreenCarousel } from "@/components/marketing/ScreenCarousel";
import { PhoneStrip } from "@/components/marketing/PhoneStrip";
import { placement, type Screen } from "@/assets/screens";

interface Feature {
  title: string;
  description: string;
  // SVG path data for a 24x24 outline icon.
  icon: string[];
}

const FEATURES: Feature[] = [
  {
    title: "Separate workspaces",
    description:
      "Every organization's data is kept apart at the database level, not just hidden in the interface. One team can never see another's projects, chats or members.",
    icon: [
      "M3 21h18",
      "M5 21V7l7-4 7 4v14",
      "M9 21v-6h6v6",
      "M9 10h.01",
      "M15 10h.01",
    ],
  },
  {
    title: "Roles that are enforced",
    description:
      "Admins, managers and members each have clear permissions, and the server checks them on every action. Hiding a button is never the only protection.",
    icon: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z", "m9 12 2 2 4-4"],
  },
  {
    title: "Task boards",
    description:
      "Move work through To do, In progress and Done. Set priorities and due dates, and assign more than one person to a task.",
    icon: ["M3 3h7v18H3z", "M14 3h7v10h-7z", "M14 17h7v4h-7z"],
  },
  {
    title: "Project lifecycle",
    description:
      "Finish a project, archive it, or move it to the Bin. Anything in the Bin can be restored for 30 days.",
    icon: ["M21 8v13H3V8", "M1 3h22v5H1z", "M10 12h4"],
  },
  {
    title: "Updates and questions",
    description:
      "Ask for a status update, post one, or ask a question right on a task. Everyone involved is notified, and replies stay together.",
    icon: ["M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z", "M12 7v5l3 2"],
  },
  {
    title: "Team messages",
    description:
      "Chat one to one or in groups. React, reply, mention people, share files and search old messages. Only the people in a chat can read it, admins included.",
    icon: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"],
  },
  {
    title: "Meetings",
    description:
      "Schedule one-off or repeating meetings with a join link, collect replies, and get a reminder before they start. Link a meeting to a project or a task.",
    icon: [
      "M8 2v4",
      "M16 2v4",
      "M3 10h18",
      "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
    ],
  },
  {
    title: "Dashboard and audit log",
    description:
      "See overdue work, activity and plan usage at a glance, and check who changed what and when.",
    icon: ["M3 3v18h18", "M7 14l4-4 3 3 5-6"],
  },
  {
    title: "Secure by default",
    description:
      "Short-lived sessions with rotating refresh tokens, hashed invite links, private chat files and sensible limits on every plan.",
    icon: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
  },
];

interface TourTab {
  id: string;
  label: string;
  // The pictures for this tab, from the placements in screens.json.
  screens: Screen[];
  heading: string;
  points: string[];
}

const TOUR: TourTab[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    screens: placement("landing.tour.dashboard"),
    heading: "Know where things stand",
    points: [
      "Tasks view: open, completed, created and overdue at a glance",
      "Projects view: stages, open work and what each project finished",
      "Any period from 7 days to all time, or your own dates",
    ],
  },
  {
    id: "board",
    label: "Task board",
    screens: placement("landing.tour.tasks"),
    heading: "Keep the work moving",
    points: [
      "Cards for every task, with priority, due date and assignees",
      "Filter by priority or person, or switch to just your own tasks",
      "Ask for updates on a task or a whole project",
    ],
  },
  {
    id: "messages",
    label: "Messages",
    screens: placement("landing.tour.messages"),
    heading: "Talk it through",
    points: [
      "One to one chats and groups, delivered live",
      "Replies, reactions, @mentions, files and search",
      "Private to the people in the chat, admins included",
    ],
  },
  {
    id: "meetings",
    label: "Meetings",
    screens: placement("landing.tour.meetings"),
    heading: "Meet without the juggling",
    points: [
      "Join links, repeating meetings and a month calendar",
      "Accept, Maybe or Decline, or suggest another time",
      "A reminder shortly before each meeting starts",
    ],
  },
  {
    id: "team",
    label: "Team and admin",
    screens: placement("landing.tour.team"),
    heading: "Run it with confidence",
    points: [
      "Admin, manager and member roles with clear limits",
      "Invite by email, change roles or remove people",
      "An audit log of every important change",
    ],
  },
];

const STEPS = [
  {
    title: "Create your organization",
    text: "Register, name your workspace and you're in. It takes under a minute.",
  },
  {
    title: "Invite your team",
    text: "Send invite links and choose each person's role. They join with one click.",
  },
  {
    title: "Plan, talk and meet",
    text: "Set up projects and tasks, chat in the same place, and schedule meetings.",
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

// Phone menu: the account actions on top and help at the bottom.
function LandingMenu({
  isAuthenticated,
  user,
  isLoggingOut,
  workspacePath,
  onClose,
  onLogout,
}: {
  isAuthenticated: boolean;
  user: { name: string; email: string } | null;
  isLoggingOut: boolean;
  workspacePath: string;
  onClose: () => void;
  onLogout: () => void;
}) {
  return (
    <MenuPanel
      onClose={onClose}
      footer={<HelpLinks from="/" onNavigate={onClose} />}
    >
      {isAuthenticated ? (
        <>
          {user && <AccountCard user={user} />}
          <Link
            to={workspacePath}
            onClick={onClose}
            className="flex w-full items-center justify-center rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700"
          >
            Open WorkNest
          </Link>
          <button
            type="button"
            onClick={onLogout}
            disabled={isLoggingOut}
            aria-busy={isLoggingOut || undefined}
            className="flex w-full items-center justify-center rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            {isLoggingOut ? "Signing out…" : "Log out"}
          </button>
        </>
      ) : (
        <>
          <Link
            to="/register"
            onClick={onClose}
            className="flex w-full items-center justify-center rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700"
          >
            Register
          </Link>
          <Link
            to="/login"
            onClick={onClose}
            className="flex w-full items-center justify-center rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Log in
          </Link>
        </>
      )}
    </MenuPanel>
  );
}

function ProductTour() {
  const [active, setActive] = useState(TOUR[0].id);
  const tab = TOUR.find((item) => item.id === active) ?? TOUR[0];

  return (
    <section
      id="product"
      aria-labelledby="tour-title"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20"
    >
      <div className="max-w-2xl">
        <h2
          id="tour-title"
          className="text-2xl font-bold text-slate-900 sm:text-3xl dark:text-slate-50"
        >
          See it in action
        </h2>
        <p className="mt-3 text-slate-600 dark:text-slate-400">
          A look at the parts you'll use every day. These screens use demo data.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Product tour"
        className="mt-8 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 sm:inline-flex dark:bg-slate-800"
      >
        {TOUR.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tour-tab-${item.id}`}
            aria-selected={item.id === active}
            aria-controls="tour-panel"
            tabIndex={item.id === active ? 0 : -1}
            onClick={() => setActive(item.id)}
            onKeyDown={(event) => {
              const index = TOUR.findIndex((entry) => entry.id === active);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % TOUR.length
                  : event.key === "ArrowLeft"
                    ? (index - 1 + TOUR.length) % TOUR.length
                    : null;
              if (next === null) return;
              event.preventDefault();
              setActive(TOUR[next].id);
              document.getElementById(`tour-tab-${TOUR[next].id}`)?.focus();
            }}
            className={cn(
              "min-h-10 flex-1 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 sm:flex-none",
              item.id === active
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-50"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        id="tour-panel"
        role="tabpanel"
        aria-labelledby={`tour-tab-${tab.id}`}
        className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]"
      >
        <div className="lg:pt-4">
          <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            {tab.heading}
          </h3>
          <ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            {tab.points.map((point) => (
              <li key={point} className="flex gap-2.5">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <ScreenCarousel
          key={tab.id}
          screens={tab.screens}
          label={`${tab.label} screens`}
          className="min-w-0"
        />
      </div>
    </section>
  );
}

function PhoneShowcase() {
  return (
    <section
      aria-labelledby="phone-title"
      className="border-t border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <h2
            id="phone-title"
            className="text-2xl font-bold text-slate-900 sm:text-3xl dark:text-slate-50"
          >
            Just as good on your phone
          </h2>
          <p className="mt-3 text-slate-600 dark:text-slate-400">
            Every page adapts to small screens, so you can check a task, reply
            to a message or join a meeting from anywhere. There's a dark theme
            too, for late nights.
          </p>
        </div>
        <PhoneStrip
          screens={placement("landing.phones")}
          label="WorkNest on a phone"
          className="mt-10"
        />
      </div>
    </section>
  );
}

export function Landing() {
  const auth = useAuth();
  // While the session check runs, someone who was signed in on this device
  // sees the signed-in buttons at once instead of Log in and Register.
  const [rememberedWorkspace] = useState(readSignedInHint);
  const isAuthenticated =
    auth.status === "authenticated" ||
    (auth.status === "loading" && rememberedWorkspace !== null);
  const user = auth.status === "authenticated" ? auth.user : null;
  const isLoggingOut = auth.isLoggingOut;
  const workspacePath =
    auth.status === "authenticated"
      ? resolvePostAuthPath(auth.memberships ?? [])
      : (rememberedWorkspace ?? "/login");
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await auth.logout();
    } catch (error) {
      toast.error(parseApiError(error).message);
    } finally {
      setMenuOpen(false);
    }
  };

  const navLink =
    "rounded-md px-1 text-sm font-medium text-slate-600 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:text-slate-300 dark:hover:text-teal-400";
  const primaryButton =
    "inline-flex items-center justify-center rounded-lg bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600";
  const secondaryButton =
    "inline-flex items-center justify-center rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800";

  return (
    <div className="min-h-dvh bg-white dark:bg-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <BrandLink />
          <div className="flex items-center gap-1 sm:gap-5">
            <nav
              aria-label="Page sections"
              className="hidden items-center gap-5 sm:flex"
            >
              <a href="#product" className={navLink}>
                Product
              </a>
              <a href="#features" className={navLink}>
                Features
              </a>
              <Link to="/how-to-use" state={{ from: "/" }} className={navLink}>
                How to use
              </Link>
            </nav>
            <ThemeToggle />
            <MenuButton open={menuOpen} onClick={() => setMenuOpen(true)} />
          </div>
        </div>
      </header>

      {menuOpen && (
        <LandingMenu
          isAuthenticated={isAuthenticated}
          user={user}
          isLoggingOut={isLoggingOut}
          workspacePath={workspacePath}
          onClose={() => setMenuOpen(false)}
          onLogout={() => void handleLogout()}
        />
      )}

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
            <div>
              <span className="inline-flex items-center rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                Built for small and growing teams
              </span>
              <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl dark:text-slate-50">
                Projects, chat and meetings in one workspace.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-slate-600 dark:text-slate-400">
                WorkNest brings your team's tasks, conversations and calendar
                together. Each organization's data stays separate, and what
                people can see and do depends on their role.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {isAuthenticated ? (
                  <Link to={workspacePath} className={primaryButton}>
                    Go to your workspace
                  </Link>
                ) : (
                  <>
                    <Link to="/register" className={primaryButton}>
                      Get started free
                    </Link>
                    <Link to="/login" className={secondaryButton}>
                      Log in
                    </Link>
                  </>
                )}
              </div>
              {!isAuthenticated && (
                <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                  Free plan included. No credit card needed.
                </p>
              )}
              <ul className="mt-8 flex flex-wrap gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                {["Role-based access", "Private chats", "Full audit log"].map(
                  (item) => (
                    <li
                      key={item}
                      className="rounded-full border border-slate-200 px-3 py-1 dark:border-slate-700"
                    >
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </div>

            <div className="flex justify-center lg:justify-end">
              <HeroPreview />
            </div>
          </div>
        </section>

        <ProductTour />

        <section
          id="features"
          aria-labelledby="features-title"
          className="scroll-mt-20 border-t border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40"
        >
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="max-w-2xl">
              <h2
                id="features-title"
                className="text-2xl font-bold text-slate-900 sm:text-3xl dark:text-slate-50"
              >
                Everything a growing team needs, without building it yourself.
              </h2>
              <p className="mt-3 text-slate-600 dark:text-slate-400">
                Isolation and access control are built into the data layer, so
                you can move fast without worrying about permission bugs or one
                team's data showing up in another's.
              </p>
            </div>

            <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <li
                  key={feature.title}
                  className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-5 w-5"
                    >
                      {feature.icon.map((d) => (
                        <path key={d} d={d} />
                      ))}
                    </svg>
                  </span>
                  <h3 className="mt-4 font-semibold text-slate-800 dark:text-slate-100">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    {feature.description}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <PhoneShowcase />

        <section
          aria-labelledby="steps-title"
          className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2
              id="steps-title"
              className="text-2xl font-bold text-slate-900 sm:text-3xl dark:text-slate-50"
            >
              Up and running in a few minutes
            </h2>
            <Link
              to="/how-to-use"
              state={{ from: "/" }}
              className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              Read the full guide <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="rounded-xl border border-slate-200 p-6 dark:border-slate-700"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white">
                  {index + 1}
                </span>
                <h3 className="mt-4 font-semibold text-slate-800 dark:text-slate-100">
                  {step.title}
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                  {step.text}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-12 rounded-2xl bg-teal-600 px-6 py-12 text-center sm:px-12 sm:py-14">
            <h2 className="text-2xl font-bold text-white sm:text-3xl">
              Set up your organization in a few minutes.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-teal-50">
              Create your account, invite your team and start working with the
              right access from day one.
            </p>
            <Link
              to={isAuthenticated ? workspacePath : "/register"}
              className="mt-8 inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 text-sm font-semibold text-teal-700 shadow-sm transition-colors hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {isAuthenticated
                ? "Go to your workspace"
                : "Create your workspace"}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-100 dark:border-slate-800">
        <div className="mx-auto grid max-w-6xl justify-items-center gap-6 px-4 py-8 text-sm text-slate-500 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:px-6 dark:text-slate-400">
          <div className="flex flex-col items-center gap-3 sm:items-start sm:justify-self-start">
            <BrandLink />
            <Link
              to="/how-to-use"
              state={{ from: "/" }}
              className="hover:text-teal-700 dark:hover:text-teal-400"
            >
              How to use
            </Link>
          </div>

          <div className="flex items-center gap-4 sm:justify-self-center">
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

          <p className="text-center sm:justify-self-end sm:text-right">
            &copy; {new Date().getFullYear()} WorkNest. Built by Spraha Singh.
          </p>
        </div>
      </footer>
    </div>
  );
}
