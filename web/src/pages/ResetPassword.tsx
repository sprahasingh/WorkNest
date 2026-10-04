import { PASSWORD_TOO_LONG, passwordFitsLimit } from "@/lib/passwordPolicy";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Field } from "@/components/ui/Field";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PasswordHelp } from "@/components/ui/PasswordHelp";
import { resetPassword } from "@/api/auth";
import { parseApiError } from "@/lib/apiError";

const schema = z
  .object({
    password: z
      .string()
      .min(8, "Use at least 8 characters")
      .refine(passwordFitsLimit, PASSWORD_TOO_LONG),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .superRefine((values, context) => {
    if (values.password !== values.confirmPassword) {
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords do not match",
      });
    }
  });

type FormValues = z.infer<typeof schema>;

export function ResetPassword() {
  const location = useLocation();
  const token = new URLSearchParams(location.search).get("token");
  const [formError, setFormError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const passwordValue = useWatch({ control, name: "password" }) ?? "";

  const onSubmit = async ({ password }: FormValues) => {
    if (!token) return;
    setFormError(null);
    try {
      await resetPassword(token, password);
      setIsComplete(true);
    } catch (error) {
      setFormError(parseApiError(error).message);
    }
  };

  return (
    <AuthShell>
      {isComplete ? (
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <path d="m5 12 4 4L19 6" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              Password updated
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Your password is ready. Log in with your new credentials.
            </p>
          </div>
          <Link
            to="/login"
            className="inline-flex w-full items-center justify-center rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:bg-teal-500 dark:hover:bg-teal-400"
          >
            Go to log in
          </Link>
        </div>
      ) : (
        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          noValidate
          className="space-y-4"
        >
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              Choose a new password
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Use at least 8 characters for your new password.
            </p>
          </div>

          {!token && (
            <ErrorBanner message="This reset link is missing or invalid. Request a fresh link to continue." />
          )}
          <ErrorBanner message={formError} />

          <Field
            label="New password"
            htmlFor="password"
            error={errors.password?.message}
          >
            <PasswordInput
              id="password"
              autoComplete="new-password"
              {...register("password")}
            />
            <PasswordHelp
              password={passwordValue}
              fieldError={errors.password?.message}
            />
          </Field>
          <Field
            label="Confirm new password"
            htmlFor="confirmPassword"
            error={errors.confirmPassword?.message}
          >
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              {...register("confirmPassword")}
            />
          </Field>

          <Button
            type="submit"
            disabled={!token || isSubmitting}
            loading={isSubmitting}
            className="w-full"
          >
            {isSubmitting ? "Updating password…" : "Update password"}
          </Button>
          <p className="text-center text-sm text-slate-600 dark:text-slate-400">
            Need a fresh link?{" "}
            <Link
              to="/forgot-password"
              className="font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              Request another
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
