import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { markOnboardingSeen } from "@/lib/onboarding";

interface Step {
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    title: "Welcome to WorkNest",
    description:
      "A quick look at how projects, tasks, and teammates fit together, so you're not guessing where to start.",
  },
  {
    title: "Projects organize your work",
    description:
      "Create a project for each initiative or team. Every project gets a short key (like ENG or OPS) used to identify its tasks.",
  },
  {
    title: "Tasks live on a board",
    description:
      "Each project has a To do / In progress / Done board. Tasks carry a priority, an optional due date, and an assignee.",
  },
  {
    title: "Members have roles",
    description:
      "Invite teammates as Admin, Manager, or Member. Each role can do different things — admins manage billing and members, managers run projects and tasks, members handle their own work.",
  },
  {
    title: "Dashboard and audit log",
    description:
      "The dashboard shows overdue tasks, activity, and usage at a glance. The audit log records who changed what, and when.",
  },
];

interface OnboardingTourProps {
  onClose: () => void;
}

export function OnboardingTour({ onClose }: OnboardingTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const isLastStep = stepIndex === STEPS.length - 1;
  const step = STEPS[stepIndex]!;

  const finish = () => {
    markOnboardingSeen();
    onClose();
  };

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
            className="text-sm font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
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
            {STEPS.map((s, index) => (
              <span
                key={s.title}
                className={cn(
                  "h-1.5 w-6 rounded-full transition-colors",
                  index === stepIndex
                    ? "bg-teal-600"
                    : "bg-slate-200 dark:bg-slate-700",
                )}
              />
            ))}
          </div>

          <div className="flex gap-2">
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
