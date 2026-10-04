import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { InfoButton, InfoPanel } from "@/components/ui/InfoToggle";
import {
  PASSWORD_PROBLEM_MESSAGES,
  findPasswordProblem,
  passwordStrength,
} from "@/lib/passwordPolicy";

const STRENGTH = {
  weak: { label: "Weak", bars: 1, color: "bg-red-500" },
  okay: { label: "Okay", bars: 2, color: "bg-amber-500" },
  strong: { label: "Strong", bars: 3, color: "bg-teal-600" },
} as const;

// Sits under a "new password" box: a strength bar, the exact reason when a
// password won't be accepted, and an (i) that explains why the rules exist
// and how to pick a better one.
export function PasswordHelp({
  password,
  email,
  name,
}: {
  password: string;
  email?: string;
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!password) return null;

  const problem = findPasswordProblem(password, { email, name });
  const strength = STRENGTH[problem ? "weak" : passwordStrength(password)];

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 text-xs">
        <div className="flex gap-1" aria-hidden="true">
          {[1, 2, 3].map((bar) => (
            <span
              key={bar}
              className={cn(
                "h-1.5 w-8 rounded-full",
                bar <= strength.bars
                  ? strength.color
                  : "bg-slate-200 dark:bg-slate-700",
              )}
            />
          ))}
        </div>
        <span className="font-medium text-slate-600 dark:text-slate-300">
          {strength.label}
        </span>
        <InfoButton
          open={open}
          onToggle={() => setOpen((value) => !value)}
          label="Why password rules matter"
          controls={panelId}
        />
      </div>
      {problem && (
        <p
          role="status"
          className="mt-1 text-sm text-amber-700 dark:text-amber-400"
        >
          {PASSWORD_PROBLEM_MESSAGES[problem]}
        </p>
      )}
      <InfoPanel id={panelId} open={open} onClose={() => setOpen(false)}>
        <p>
          Attackers don&apos;t guess at random. They try the most common
          passwords first, then patterns like 12345678, then words from the
          person&apos;s own name and email. A password that avoids all of that
          holds up far longer if someone tries to break into your account.
        </p>
        <p className="mt-2">To make a good one:</p>
        <ul className="mt-1 list-disc pl-4">
          <li>Make it long. Three or four unrelated words work well.</li>
          <li>Keep your name and email out of it.</li>
          <li>Use one you don&apos;t use anywhere else.</li>
        </ul>
      </InfoPanel>
    </div>
  );
}
