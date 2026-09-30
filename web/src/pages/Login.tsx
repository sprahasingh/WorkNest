import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import { resolvePostAuthPath, safeNextPath } from "@/lib/postAuthRedirect";
import { AuthShell } from "@/components/AuthShell";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import {
  ServerWakeTimeoutError,
  subscribeServerWakeChange,
} from "@/api/client";

const loginFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

const LOGIN_FIELDS = ["email", "password"] as const;
const LOGIN_TIMEOUT_MS = 120_000;

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const nextPath = safeNextPath(location.search);
  const [formError, setFormError] = useState<string | null>(null);
  const [isWakingServer, setIsWakingServer] = useState(false);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeServerWakeChange(setIsWakingServer);
    return () => {
      unsubscribe();
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

  const onSubmit = async (values: LoginFormValues) => {
    setFormError(null);
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

        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register("email")}
            className={inputStyles}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
        >
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register("password")}
            className={inputStyles}
          />
        </Field>

        <Button
          type="submit"
          disabled={isSubmitting}
          loading={isSubmitting}
          className="w-full"
        >
          {isWakingServer
            ? "Waking up the server…"
            : isSubmitting
              ? "Logging in…"
              : "Log in"}
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
