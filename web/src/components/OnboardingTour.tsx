import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { Role } from "@/api/auth";

interface Step {
  title: string;
  description: string;
  // Steps about pages only some roles can open are left out for everyone else.
  roles?: Role[];
}

const STEPS: Step[] = [
  {
    title: "Welcome to WorkNest",
    description:
      "Projects, chat and meetings for your team in one place. Here is a quick look at where things are, so you're not guessing where to start.",
  },
  {
    title: "Projects and tasks",
    description:
      "A project holds the tasks for one piece of work. Each task has a priority, a due date and one or more people on it. Admins and managers create projects, and everyone updates the tasks they are on.",
  },
  {
    title: "Ask for and share updates",
    description:
      "Managers can ask for an update on a task or a whole project. People reply right on the task, and everyone involved gets a notification.",
  },
  {
    title: "Messages",
    description:
      "Message anyone in your organization, or start a group. Chats are private to the people in them. Reply, react, mention people and share files, and press and hold a message for more options.",
  },
  {
    title: "Meetings",
    description:
      "Schedule a meeting with a join link and an agenda. Invitees reply Accept, Maybe or Decline, and everyone gets a reminder before it starts.",
  },
  {
    title: "People and roles",
    description:
      "Every person is an Admin, a Manager or a Member. Admins look after people, plans and settings, managers run projects and tasks, and members work on their own tasks.",
  },
  {
    title: "Dashboard and audit log",
    description:
      "The dashboard shows how tasks and projects are doing over any period you choose. Admins can also open the audit log to see who changed what, and when.",
    roles: ["admin", "manager"],
  },
];

interface OnboardingTourProps {
  role: Role;
  onClose: () => void;
}

export function OnboardingTour({ role, onClose }: OnboardingTourProps) {
  const steps = STEPS.filter(
    (item) => !item.roles || item.roles.includes(role),
  );
  const [stepIndex, setStepIndex] = useState(0);
  const isLastStep = stepIndex === steps.length - 1;
  const step = steps[stepIndex]!;

  const finish = onClose;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-800">
        <div className="flex items-start justify-between">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">
            W
          </span>
          <button
            type="button"
            onClick={finish}
            className="text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            Skip
          </button>
        </div>

        <h2 className="mt-4 text-xl font-bold text-slate-900 dark:text-slate-50">
          {step.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {step.description}
        </p>

        {isLastStep && (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Want the full picture? See the{" "}
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

        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-1.5">
            {steps.map((s, index) => (
              <span
                key={s.title}
                className={cn(
                  "h-1.5 w-4 rounded-full transition-colors sm:w-6",
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
                onClick={() => setStepIndex((i) => i - 1)}
              >
                Back
              </Button>
            )}
            <Button
              size="sm"
              onClick={() =>
                isLastStep ? finish() : setStepIndex((i) => i + 1)
              }
            >
              {isLastStep ? "Get started" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
