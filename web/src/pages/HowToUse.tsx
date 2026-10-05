import { PLAN_LIMITS, PLAN_NAMES, PLAN_ORDER } from "@/lib/plans";
import { Link, useLocation } from "react-router";
import { Card } from "@/components/ui/Card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLink } from "@/components/BrandLink";
import { ScreenCarousel } from "@/components/marketing/ScreenCarousel";
import { PhoneStrip } from "@/components/marketing/PhoneStrip";
import { placement, type Screen } from "@/assets/screens";
import { useAuth } from "@/auth/auth-context";
import { resolvePostAuthPath } from "@/lib/postAuthRedirect";

interface GuideStep {
  id: string;
  title: string;
  description: string;
  tips?: string[];
  // The pictures for this step, from the placements in screens.json.
  screens?: Screen[];
}

// Written from the same limits the app enforces, so the guide can't go stale
// when a limit changes.
function planLimitsText(): string {
  return PLAN_ORDER.map((plan) => {
    const { seatLimit, projectLimit, activeTaskLimit } = PLAN_LIMITS[plan];
    const tasks =
      activeTaskLimit === null
        ? "unlimited active tasks"
        : `${activeTaskLimit} active tasks per project`;
    return `${PLAN_NAMES[plan]} includes ${seatLimit} seats, ${projectLimit} active projects and ${tasks}.`;
  }).join(" ");
}

const STEPS: GuideStep[] = [
  {
    id: "account",
    title: "Create your account",
    description:
      "Register with your name, email and a password, typing the password twice so a typo can't lock you out. Then confirm your email. Choose Admin to create an organization and manage it, or User if you'd rather join one later through an invite.",
    tips: [
      "Every password box has a Show button, so you can check what you typed.",
      "After you register, open the link we email you. It works on any device: the page you registered on notices and signs you in by itself, and on another device you just type your password to confirm.",
      "Can't find the email? Check your spam or junk folder, and Promotions in Gmail. You can ask for a new link after a minute, and a newer link replaces the older one. Links work for one hour.",
      "The same goes for password reset and email change links: check spam or junk first, then use the resend button.",
      "When you first enter an organization, a short tour explains the features available to your role. It is remembered for that organization and role on any device, and you can replay it from Show the tour at the bottom of the sidebar.",
    ],
    screens: placement("guide.account"),
  },
  {
    id: "project",
    title: "Create a project",
    description:
      "Go to Projects and choose New project. Give it a name and a short key (2 to 6 letters or numbers, starting with a letter, like WEB or APP2) that labels its tasks. Admins and managers can create projects.",
    screens: placement("guide.project"),
  },
  {
    id: "team",
    title: "Invite your team",
    description:
      "Open Members and choose Invite someone. Enter their email and pick a role. If the email doesn't arrive, ask them to check their spam or junk folder, and use Send again next to the pending invite. People who already use WorkNest can accept from the bell or from their Organizations page. Admins can change a role or remove someone at any time.",
    screens: placement("guide.team"),
  },
  {
    id: "tasks",
    title: "Create and move tasks",
    description:
      "Open a project and choose New task. Add a title, a priority, an optional due date and one or more assignees. Use the status menu on a card to move it between To do, In progress and Done. Members can edit tasks assigned to them, and managers and admins can edit any task.",
    tips: [
      "Each plan limits active tasks per project: 10 on Free, 50 on Pro and unlimited on Premium.",
      "Done, archived and binned tasks don't count toward that limit. Reopening or restoring one does.",
    ],
    screens: placement("guide.tasks"),
  },
  {
    id: "updates",
    title: "Ask for and share updates",
    description:
      "Managers and admins can ask for an update on one task, or on a whole project. Assignees post updates or ask questions from the task's Updates tab, and leads reply. Everyone involved gets a notification, and opening the task marks it as read.",
    tips: [
      "Project updates, on the project board, collects every task's updates in one place.",
      "A task's Meetings tab lists meetings linked to it, and lets you schedule a new one.",
    ],
    screens: placement("guide.updates"),
  },
  {
    id: "lifecycle",
    title: "Keep project lists current",
    description:
      "A project moves to Completed when all its tasks are done. Archive a project to tuck it away, or move it to the Bin to remove it for now. Binned projects can be restored for 30 days. Completed, archived and binned projects don't use a project slot, so bringing one back can be blocked if your plan is full.",
  },
  {
    id: "messages",
    title: "Message your team",
    description:
      "Open Messages to chat with anyone in your organization, one to one or in a group. Only the people in a chat can read it, and that includes admins. Messages arrive live, with typing indicators, online dots and read receipts.",
    tips: [
      "Choose New to start a chat or create a group. Group admins can rename it and add or remove people, and anyone can leave.",
      "Hover a message, or tap it on a phone, to reply, react, copy, edit or delete. Press and hold a message on a phone, or right-click it on a computer, to open the same options for just that message.",
      "You can edit a message for 10 minutes after sending. Delete for everyone works for 30 minutes after sending and leaves a note that you deleted it. Delete for me hides any message from your own view only, at any time, and other people still see it.",
      "Type @ to mention someone. A mention still alerts people who have muted the chat.",
      "Attach files with the paperclip, or drag them onto the chat. Click a picture to see it larger. Files are private to the chat and limited to 10 MB.",
      "Search above your chats to find old messages. Press and hold a chat in the list (or right-click it) to mute it, mark it as read or unread, see group details or delete it. The three dots in a chat's header do the same.",
      "Deleting a conversation clears it for you only. The other people keep it, and a new message brings it back with just the new messages.",
      "The bell next to New turns on a soft sound, and on a computer, desktop notifications too. Phones and tablets only get the sound, because their browsers don't allow in-page notifications. Your unread count always shows in the browser tab.",
    ],
    screens: placement("guide.messages"),
  },
  {
    id: "meetings",
    title: "Schedule meetings",
    description:
      "Open Meetings and choose Schedule meeting. Add a time, a join link, an agenda and the people to invite. Only the organizer and the people invited can see a meeting.",
    tips: [
      "For the join link, paste a Zoom, Meet or Teams address, or create a free Jitsi room with one click.",
      "Repeat a meeting daily, weekly or monthly, and choose whether a change applies to one date or all upcoming ones.",
      "Invitees reply Accept, Maybe or Decline, or suggest another time. The organizer can accept a suggestion or keep the original.",
      "Everyone gets a reminder about 15 minutes before a meeting starts. Meet now starts an instant call, and Add to calendar downloads an .ics file.",
      "Link a meeting to a project or task so it shows up there too.",
    ],
    screens: placement("guide.meetings"),
  },
  {
    id: "dashboard",
    title: "Check the dashboard",
    description:
      "Admins and managers get two views, switched at the top. Tasks shows open, completed, created and overdue tasks, with charts for status, priority, workload and how open work has moved. Projects shows each project's stage, progress and where the open work is. Pick a period from the last 7 to 90 days, all time, or a custom range with your own start and end dates, and the charts follow it in your organization's time zone. Scroll down on the Tasks view for workload per person and plan usage. Chart numbers show on double-click or double-tap, so a stray tap doesn't pop them up.",
    screens: placement("guide.dashboard"),
  },
  {
    id: "audit",
    title: "Review the audit log",
    description:
      "Admins can see who changed what and when, including settings, members, projects, tasks and plans. Filters narrow it down by action, type and person.",
    screens: placement("guide.audit"),
  },
  {
    id: "plan",
    title: "Manage your plan and chat history",
    description: `Open Settings to compare plans and check usage. ${planLimitsText()} Only admins can change plans. Pro and Premium are paid for by the month or the year and go back to Free when the time is up, the little i next to Plan explains how it works, and a downgrade is free once your usage fits the lower limits. Settings also lists every device signed in to your account, so you can sign one out or choose Log out everywhere else. On a phone, pulling down from the top of any page refreshes it. Admins also choose how long chat history is kept, from forever down to 90 days. The choice applies to the whole organization, and every member can see it in Settings and at the bottom of their chat list.`,
    screens: placement("guide.plan"),
  },
];

const GOOD_TO_KNOW = [
  {
    title: "When someone leaves",
    text: "They're taken out of group chats and meeting invites. Meetings they organize are cancelled, or handed to someone you choose when you remove them (or when they leave).",
  },
  {
    title: "Time zones",
    text: "An admin sets the organization's time zone in Settings. It decides when due dates fall and when reminders go out. Meetings and messages show in your own time zone.",
  },
  {
    title: "Light and dark",
    text: "Use the sun or moon button at the top right of any page. WorkNest follows your device's setting until you choose.",
  },
  {
    title: "Finding your way",
    text: "Select the WorkNest logo on any page to go back to the home page. From there, Go to your workspace takes you straight back to where you were.",
  },
];

const CONCEPTS = [
  {
    title: "Organization",
    text: "Your team's workspace. Its data, projects and members are completely separate from every other organization on WorkNest.",
  },
  {
    title: "Project",
    text: "A container for related tasks, labelled by a short key (like WEB-12). Projects can be archived once they're done, without losing their history.",
  },
  {
    title: "Task",
    text: "A single piece of work with a status, a priority, an optional due date and one or more assignees, tracked on its project's board.",
  },
  {
    title: "Members and roles",
    text: "Everyone in an organization is an Admin, a Manager or a Member. Roles decide what each person can see and do. The table below has the details.",
  },
  {
    title: "Conversation",
    text: "A private chat between two people or a group. Only the people in it can read it, and anything you share stays inside it.",
  },
  {
    title: "Meeting",
    text: "A scheduled time with a join link and a list of invitees. It's visible only to the organizer and the people invited.",
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
    capability: "Message anyone in the organization",
    admin: true,
    manager: true,
    member: true,
  },
  {
    capability: "Schedule meetings and invite people",
    admin: true,
    manager: true,
    member: true,
  },
  {
    capability: "Read chats and meetings you're not part of",
    admin: false,
    manager: false,
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
    capability: "Choose how long chat history is kept",
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
    return { to: from, label: from === "/" ? "Back to home" : "Back" };
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

  const sections = [
    ["concepts", "Core concepts"],
    ["steps", "Step by step"],
    ["phone", "On your phone"],
    ["permissions", "Who can do what"],
    ["good-to-know", "Good to know"],
  ] as const;

  return (
    <div className="min-h-dvh bg-white dark:bg-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <BrandLink />
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              to={back.to}
              className="text-sm font-medium text-slate-500 hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-400"
            >
              <span aria-hidden="true">&larr; </span>
              {back.label}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <span className="inline-flex items-center rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
          Guide
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl dark:text-slate-50">
          How to use WorkNest
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-400">
          Everything you need to get a team up and running: the core ideas, the
          everyday tasks, and exactly who's allowed to do what. The pictures use
          demo data from a made-up company called Sunshine.
        </p>

        <nav aria-label="On this page" className="mt-6">
          <ul className="flex flex-wrap gap-2">
            {sections.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="inline-flex rounded-full border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 hover:border-teal-300 hover:text-teal-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-teal-700 dark:hover:text-teal-400"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <section id="concepts" className="mt-12 scroll-mt-24">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">
            Core concepts
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CONCEPTS.map((concept) => (
              <Card
                key={concept.title}
                className="p-5 shadow-none dark:border-slate-700 dark:bg-slate-800"
              >
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                  {concept.title}
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                  {concept.text}
                </p>
              </Card>
            ))}
          </div>
        </section>

        <section id="steps" className="mt-14 scroll-mt-24">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">
            Common tasks, step by step
          </h2>
          <ol className="mt-6 space-y-12">
            {STEPS.map((step, index) => (
              <li key={step.id} id={step.id} className="scroll-mt-24">
                <div className="flex gap-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-50">
                      {step.title}
                    </h3>
                    <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                      {step.description}
                    </p>
                    {step.tips && (
                      <ul className="mt-3 max-w-3xl list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600 marker:text-teal-600 dark:text-slate-400">
                        {step.tips.map((tip) => (
                          <li key={tip}>{tip}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                {step.screens && (
                  <ScreenCarousel
                    screens={step.screens}
                    label={`${step.title} screens`}
                    className="mt-5 sm:pl-11"
                  />
                )}
              </li>
            ))}
          </ol>
        </section>

        <section id="phone" className="mt-14 scroll-mt-24">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">
            On your phone
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
            Every page adapts to small screens. Tap the menu button at the top
            left to switch between Dashboard, Projects, Messages, Meetings and
            the rest. On Messages, tap a chat to open it and use the arrow to go
            back to the list.
          </p>
          <PhoneStrip
            screens={placement("guide.phones")}
            label="WorkNest on a phone"
            className="mt-6 max-w-3xl"
          />
        </section>

        <section id="permissions" className="mt-14 scroll-mt-24">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">
            Who can do what
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Roles are enforced on the server, not just hidden in the interface.
            A Member can't do an Admin-only action even by calling the API
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

        <section id="good-to-know" className="mt-14 scroll-mt-24">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">
            Good to know
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {GOOD_TO_KNOW.map((item) => (
              <Card
                key={item.title}
                className="p-5 shadow-none dark:border-slate-700 dark:bg-slate-800"
              >
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                  {item.text}
                </p>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-2xl bg-teal-600 px-6 py-10 text-center sm:px-10">
          <h2 className="text-2xl font-bold text-white">
            Ready to set up your workspace?
          </h2>
          <Link
            to={isAuthenticated ? workspacePath : "/register"}
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 text-sm font-semibold text-teal-700 shadow-sm transition-colors hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {isAuthenticated ? "Go to your workspace" : "Create your account"}
          </Link>
        </section>
      </main>
    </div>
  );
}
