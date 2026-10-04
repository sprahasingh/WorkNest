import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { getRegistrationStatus, resendVerification } from "@/api/auth";
import type { MeResponse } from "@/api/auth";
import { Button } from "@/components/ui/Button";
import { useCooldown } from "@/hooks/useCooldown";
import { parseApiError } from "@/lib/apiError";

const POLL_MS = 5000;
// After a few minutes the link is probably waiting in a busy inbox, so ask
// less often. Coming back to the tab still checks straight away.
const SLOW_POLL_AFTER_MS = 5 * 60 * 1000;
const SLOW_POLL_MS = 15000;
const RESEND_SECONDS = 60;

interface CheckEmailPanelProps {
  email: string;
  // The secret this browser got when it signed up. It lets this page sign in
  // by itself once the link has been opened on any device.
  signupToken: string | null;
  // Where to go once signed in.
  onSignedIn: (me: MeResponse) => void;
  // Back to the form, to fix the address or start again.
  onStartOver: () => void;
}

// Shown after sign-up while the email link is waiting to be opened. The link
// may be opened on this device or on another one. Either way this page notices
// and continues, so nobody is left looking at a screen that never changes.
export function CheckEmailPanel({
  email,
  signupToken,
  onSignedIn,
  onStartOver,
}: CheckEmailPanelProps) {
  const { establishSession } = useAuth();
  const [state, setState] = useState<"waiting" | "signing-in" | "expired">(
    "waiting",
  );
  const [resending, setResending] = useState(false);
  const { left, start } = useCooldown(RESEND_SECONDS);
  const finished = useRef(false);

  // The first link was sent a moment ago, so "resend" starts on cooldown.
  useEffect(() => start(), [start]);

  useEffect(() => {
    if (!signupToken) return;
    let cancelled = false;

    const check = async () => {
      if (finished.current) return;
      try {
        const result = await getRegistrationStatus(signupToken);
        if (cancelled || finished.current) return;
        if (result.status === "verified") {
          finished.current = true;
          setState("signing-in");
          const me = await establishSession(result.accessToken);
          toast.success("Email confirmed. You're signed in.");
          onSignedIn(me);
        } else if (result.status === "expired") {
          finished.current = true;
          setState("expired");
        }
      } catch {
        // A dropped connection just means asking again a moment later.
      }
    };

    const startedAt = Date.now();
    let timer = 0;
    const schedule = () => {
      const slow = Date.now() - startedAt > SLOW_POLL_AFTER_MS;
      timer = window.setTimeout(
        () => {
          void check().finally(() => {
            if (!cancelled && !finished.current) schedule();
          });
        },
        slow ? SLOW_POLL_MS : POLL_MS,
      );
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signupToken, establishSession, onSignedIn]);

  const resend = async () => {
    setResending(true);
    try {
      await resendVerification(email);
      start();
      toast.success("We sent a new link. The old one no longer works.");
    } catch (error) {
      toast.error(parseApiError(error).message);
    } finally {
      setResending(false);
    }
  };

  if (state === "expired") {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            This sign-up has expired
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            The link was not opened within an hour. Nothing was created, so you
            can simply start again.
          </p>
        </div>
        <Button type="button" onClick={onStartOver} className="w-full">
          Start again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Check your email
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          We sent a verification link to <strong>{email}</strong>. Open it on
          any device. This page continues by itself as soon as you confirm.
        </p>
      </div>

      <p
        role="status"
        className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2.5 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300"
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-teal-500"
        />
        {state === "signing-in"
          ? "Email confirmed. Signing you in…"
          : "Waiting for you to open the link…"}
      </p>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
        <p className="font-medium">Can&apos;t see it?</p>
        <p className="mt-0.5">
          Look in your spam or junk folder, and in Promotions if you use Gmail.
          The link works for one hour.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => void resend()}
          disabled={left > 0 || resending || state === "signing-in"}
          loading={resending}
        >
          {left > 0 ? `Resend link in ${left}s` : "Resend link"}
        </Button>
        <button
          type="button"
          onClick={onStartOver}
          className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
        >
          Wrong email? Start over
        </button>
      </div>

      <Link
        to="/login"
        className="inline-block text-sm font-medium text-slate-500 hover:text-teal-700 hover:underline dark:text-slate-400"
      >
        Return to login
      </Link>
    </div>
  );
}
