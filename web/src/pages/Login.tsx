import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import { resolvePostAuthPath, safeNextPath } from "@/lib/postAuthRedirect";
import { AuthShell } from "@/components/AuthShell";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { ResendButton } from "@/components/ui/ResendButton";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { ServerWakeTimeoutError } from "@/api/client";
import { resendVerification } from "@/api/auth";
import { useCooldown } from "@/hooks/useCooldown";

const loginFormSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

const LOGIN_FIELDS = ["identifier", "password"] as const;
const LOGIN_TIMEOUT_MS = 120_000;

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const nextPath = safeNextPath(location.search);
  const [formError, setFormError] = useState<string | null>(null);
  const [unregisteredEmail, setUnregisteredEmail] = useState<string | null>(
    null,
  );
  const requestController = useRef<AbortController | null>(null);
  // Set when the password is right but the email link was never opened.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const resendCooldown = useCooldown(60);

  useEffect(() => {
    return () => {
      requestController.current?.abort();
    };
  }, []);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
  });

  const resendLink = async () => {
    if (!unverifiedEmail) return;
    setResending(true);
    try {
      await resendVerification(unverifiedEmail);
      resendCooldown.start();
      toast.success("We sent a new link. The old one no longer works.");
    } catch (error) {
      toast.error(parseApiError(error).message);
    } finally {
      setResending(false);
    }
  };

  const onSubmit = async (values: LoginFormValues) => {
    setFormError(null);
    setUnregisteredEmail(null);
    setUnverifiedEmail(null);
    const controller = new AbortController();
    let timedOut = false;
    requestController.current = controller;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, LOGIN_TIMEOUT_MS);

    try {
      const me = await login(values, { signal: controller.signal });
      if (controller.signal.aborted) return;
      navigate(nextPath ?? resolvePostAuthPath(me.memberships), {
        replace: true,
      });
    } catch (error) {
      if (timedOut) {
        setFormError(
          "The server is taking longer than expected. Check your connection and try again.",
        );
        return;
      }
      if (controller.signal.aborted) return;
      if (error instanceof ServerWakeTimeoutError) {
        setFormError(
          "The server is taking longer than expected. Check your connection and try again.",
        );
        return;
      }

      const parsed = parseApiError(error);
      if (parsed.code === "EMAIL_NOT_VERIFIED") {
        setUnverifiedEmail(values.identifier.trim().toLowerCase());
        return;
      }
      if (parsed.code === "ACCOUNT_NOT_FOUND") {
        setUnregisteredEmail(values.identifier.trim().toLowerCase());
        return;
      }
      if (Object.keys(parsed.fieldErrors).length === 0) {
        setFormError(parsed.message);
        return;
      }
      const unmatched = applyFieldErrors(
        parsed.fieldErrors,
        LOGIN_FIELDS,
        setError,
      );
      if (unmatched.length > 0) {
        setFormError(unmatched.join(" "));
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (requestController.current === controller) {
        requestController.current = null;
      }
    }
  };

  return (
    <AuthShell>
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        noValidate
        className="space-y-4"
      >
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Log in to continue to your workspace.
          </p>
        </div>

        <ErrorBanner message={formError} />
        {unregisteredEmail && (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <p>
              No account is registered with <strong>{unregisteredEmail}</strong>
              .
            </p>
            <Link
              to="/register"
              className="mt-1 inline-block font-medium underline"
            >
              Register instead
            </Link>
          </div>
        )}
        {unverifiedEmail && (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <p className="font-medium">
              You haven&apos;t confirmed your email yet.
            </p>
            <p className="mt-1">
              Open the link we sent to <strong>{unverifiedEmail}</strong> (check
              spam too), then log in. Can&apos;t find it?
            </p>
            <ResendButton
              label="Send a new link"
              secondsLeft={resendCooldown.left}
              className="mt-2"
              loading={resending}
              disabled={resending}
              onClick={() => void resendLink()}
            />
          </div>
        )}

        <Field
          label="Email"
          htmlFor="identifier"
          error={errors.identifier?.message}
        >
          <input
            id="identifier"
            type="email"
            autoComplete="email"
            {...register("identifier")}
            className={inputStyles}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
        >
          <PasswordInput
            id="password"
            autoComplete="current-password"
            {...register("password")}
          />
        </Field>

        <div className="-mt-2 flex justify-end">
          <Link
            to="/forgot-password"
            className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          disabled={isSubmitting}
          loading={isSubmitting}
          className="w-full"
        >
          {isSubmitting ? "Logging in…" : "Log in"}
        </Button>

        <p className="text-center text-sm text-slate-600 dark:text-slate-400">
          Don&apos;t have an account?{" "}
          <Link
            to="/register"
            aria-disabled={isSubmitting}
            onClick={(event) => {
              if (isSubmitting) event.preventDefault();
            }}
            className="font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            Register
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
