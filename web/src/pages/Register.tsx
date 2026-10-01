import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import { AuthShell } from "@/components/AuthShell";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";

const registerFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
  orgName: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters")
    .max(80),
});

type RegisterFormValues = z.infer<typeof registerFormSchema>;

const REGISTER_FIELDS = ["name", "email", "password", "orgName"] as const;

export function Register() {
  const { register: registerUser } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(
    null,
  );

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
  });

  const onSubmit = async (values: RegisterFormValues) => {
    setFormError(null);
    try {
      const result = await registerUser(values);
      setVerificationEmail(result.email);
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.code === "EMAIL_ALREADY_REGISTERED") {
        setError("email", {
          type: "exists",
          message: "You already have an account with this email.",
        });
        return;
      }
      if (Object.keys(parsed.fieldErrors).length === 0) {
        setFormError(parsed.message);
        return;
      }
      const unmatched = applyFieldErrors(
        parsed.fieldErrors,
        REGISTER_FIELDS,
        setError,
      );
      if (unmatched.length > 0) {
        setFormError(unmatched.join(" "));
      }
    }
  };

  if (verificationEmail) {
    return (
      <AuthShell>
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              Verify your email
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              We sent a verification link to{" "}
              <strong>{verificationEmail}</strong>. Your account and
              organization will be created after you confirm this address.
            </p>
          </div>
          <Link
            to="/login"
            className="inline-block text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            Return to login
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        noValidate
        className="space-y-4"
      >
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Create your account
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Sets up your account and your first organization.
          </p>
        </div>

        <ErrorBanner message={formError} />

        <Field label="Your name" htmlFor="name" error={errors.name?.message}>
          <input
            id="name"
            type="text"
            autoComplete="name"
            {...register("name")}
            className={inputStyles}
          />
        </Field>

        <Field
          label="Email"
          htmlFor="email"
          error={
            errors.email?.type === "exists" ? undefined : errors.email?.message
          }
        >
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register("email")}
            className={inputStyles}
          />
          {errors.email?.type === "exists" && (
            <p
              role="alert"
              className="mt-1 text-sm text-red-600 dark:text-red-400"
            >
              {errors.email.message}{" "}
              <Link
                to="/login"
                className="font-medium text-teal-700 underline dark:text-teal-400"
              >
                Log in instead
              </Link>
            </p>
          )}
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
        >
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            {...register("password")}
            className={inputStyles}
          />
        </Field>

        <Field
          label="Organization name"
          htmlFor="orgName"
          error={errors.orgName?.message}
        >
          <input
            id="orgName"
            type="text"
            autoComplete="organization"
            {...register("orgName")}
            className={inputStyles}
          />
        </Field>

        <Button
          type="submit"
          disabled={isSubmitting}
          loading={isSubmitting}
          className="w-full"
        >
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>

        <p className="text-center text-sm text-slate-600 dark:text-slate-400">
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            Log in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
