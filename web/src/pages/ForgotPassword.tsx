import { useState } from "react";
import { Link } from "react-router";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Field, inputStyles } from "@/components/ui/Field";
import { requestPasswordReset } from "@/api/auth";
import { parseApiError } from "@/lib/apiError";

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email"),
});

type FormValues = z.infer<typeof schema>;

export function ForgotPassword() {
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async ({ email }: FormValues) => {
    setFormError(null);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (error) {
      setFormError(parseApiError(error).message);
    }
  };

  return (
    <AuthShell>
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        noValidate
        className="space-y-5"
      >
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Reset your password
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Enter your account email and we&apos;ll send you a secure reset
            link.
          </p>
        </div>

        <ErrorBanner message={formError} />
        {sent && (
          <p
            role="status"
            className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-3 text-sm text-teal-900 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-100"
          >
            Password reset email sent. Check your inbox and spam folder.
          </p>
        )}

        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register("email")}
            className={inputStyles}
          />
        </Field>

        <Button
          type="submit"
          disabled={isSubmitting}
          loading={isSubmitting}
          className="w-full"
        >
          {isSubmitting
            ? "Sending link…"
            : sent
              ? "Send another link"
              : "Send reset link"}
        </Button>

        <p className="text-center text-sm text-slate-600 dark:text-slate-400">
          Remembered your password?{" "}
          <Link
            to="/login"
            className="font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            Back to log in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
