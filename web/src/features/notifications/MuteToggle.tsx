import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { parseApiError } from "@/lib/apiError";
import { useMutes, useSetMute } from "./queries";

interface MuteToggleProps {
  orgId: string;
  projectId?: string;
  allProjects?: boolean;
  // Set to mute a single task instead of the whole project.
  taskId?: string;
  // Just the bell, in a square button, for toolbars that are short on room.
  // The label stays available to screen readers and as a hover hint.
  iconOnly?: boolean;
  className?: string;
}

function BellIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      {muted && <path d="M3 3l18 18" />}
    </svg>
  );
}

// Mutes general chatter from a project or task: updates, questions, thread
// replies and completions. Mentions, replies to you, update requests sent to
// you and reminders about your own tasks still arrive.
export function MuteToggle({
  orgId,
  projectId,
  allProjects = false,
  taskId,
  iconOnly = false,
  className,
}: MuteToggleProps) {
  const { data: mutes } = useMutes(orgId);
  const setMute = useSetMute(orgId);
  const projectMuted = projectId
    ? (mutes?.projectIds.includes(projectId) ?? false)
    : false;
  const taskMuted = taskId ? (mutes?.taskIds.includes(taskId) ?? false) : false;
  const workspaceMuted = mutes?.allProjects ?? false;
  const allMuted = allProjects && workspaceMuted;
  // A task in a muted project is muted with it; unmute the project instead.
  const inheritsMute =
    (!allProjects && workspaceMuted) || (!!taskId && projectMuted);
  const muted =
    allMuted ||
    workspaceMuted ||
    (taskId ? taskMuted || projectMuted : projectMuted);
  const what = allProjects
    ? "all project notifications"
    : taskId
      ? "task"
      : "project";

  const toggle = () => {
    const next = !muted;
    setMute.mutate(
      {
        target: allProjects
          ? { allProjects: true }
          : taskId
            ? { taskId }
            : { projectId: projectId! },
        muted: next,
      },
      {
        onSuccess: () => {
          toast.success(next ? `Muted this ${what}` : `Unmuted this ${what}`, {
            description: next
              ? "You'll still get @mentions, replies to you and update requests sent to you."
              : undefined,
          });
        },
        onError: (error) => toast.error(parseApiError(error).message),
      },
    );
  };

  const label = inheritsMute
    ? workspaceMuted
      ? "Muted across all projects"
      : "Muted with the project"
    : muted
      ? "Muted"
      : "Mute";
  const hint = inheritsMute
    ? workspaceMuted
      ? "All projects are muted. Unmute them from the Projects page."
      : "The whole project is muted. Unmute it from the project page."
    : muted
      ? allProjects
        ? "Unmute all project notifications"
        : `Unmute this ${what}`
      : allProjects
        ? "Mute general activity from all projects. You'll still get @mentions, replies to you and update requests sent to you."
        : `Mute general activity from this ${what}. You'll still get @mentions, replies to you and update requests sent to you.`;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!mutes || inheritsMute || setMute.isPending}
      aria-pressed={muted}
      aria-label={
        iconOnly
          ? allProjects
            ? muted
              ? "Unmute all project notifications"
              : "Mute all project notifications"
            : `${label}. ${hint}`
          : undefined
      }
      title={hint}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 disabled:cursor-default",
        iconOnly
          ? "h-11 w-11 shrink-0 rounded-lg border"
          : "gap-1.5 rounded-lg px-2.5 py-1.5 text-xs",
        muted
          ? cn(
              "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600",
              iconOnly && "border-slate-300 dark:border-slate-600",
            )
          : cn(
              "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
              iconOnly &&
                "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800",
            ),
        inheritsMute && "hover:bg-slate-200 dark:hover:bg-slate-700",
        className,
      )}
    >
      <BellIcon muted={muted} />
      {!iconOnly && label}
    </button>
  );
}
