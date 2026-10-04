import type { ComponentProps } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

// A "send again" button with a countdown. The label never changes and the
// seconds sit in a slot that is always the same width, so the button doesn't
// resize, wrap or push its neighbours around as the number ticks down.
export function ResendButton({
  label = "Resend link",
  secondsLeft,
  className,
  disabled,
  ...rest
}: Omit<ComponentProps<typeof Button>, "children"> & {
  label?: string;
  secondsLeft: number;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={disabled || secondsLeft > 0}
      className={cn("whitespace-nowrap", className)}
      {...rest}
    >
      {label}
      <span
        aria-hidden="true"
        className="ml-2 inline-block w-[3ch] text-left tabular-nums text-slate-400 dark:text-slate-500"
      >
        {secondsLeft > 0 ? `${secondsLeft}s` : ""}
      </span>
    </Button>
  );
}
