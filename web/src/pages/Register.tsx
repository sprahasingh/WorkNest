import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import { AuthShell } from "@/components/AuthShell";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PasswordHelp } from "@/components/ui/PasswordHelp";
import { CheckEmailPanel } from "@/components/CheckEmailPanel";
import { EmailTypoHint } from "@/components/ui/EmailTypoHint";
import { useEmailTypoHint } from "@/hooks/useEmailTypoHint";
import { resolvePostAuthPath } from "@/lib/postAuthRedirect";

const registerFormSchema = z
  .object({
    accountType: z.enum(["admin", "user"]),
    name: z.string().trim().min(1, "Name is required").max(100),
    email: z
      .string()
      .trim()
      .min(1, "Email is required")
      .email("Enter a valid email"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(72),
    confirmPassword: z.string().min(1, "Please type your password again"),
    orgName: z.string().trim().max(80).optional(),
  })
  .superRefine((values, context) => {
    if (values.confirmPassword && values.confirmPassword !== values.password) {
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message:
          "The passwords don't match. Please type the same password in both.",
      });
    }
    if (
      values.accountType === "admin" &&
      (!values.orgName || values.orgName.length < 2)
    ) {
      context.addIssue({
        code: "custom",
        path: ["orgName"],
        message: "Organization name must be at least 2 characters",
      });
    }
  });

type RegisterFormValues = z.infer<typeof registerFormSchema>;

const REGISTER_FIELDS = ["name", "email", "password", "orgName"] as const;

interface WaitingForEmail {
  email: string;
  signupToken: string;
}

export function Register() {
  const { register: registerUser, establishSession } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<WaitingForEmail | null>(null);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { accountType: "admin" },
    shouldUnregister: true,
  });
  const accountType = useWatch({ control, name: "accountType" });
  const emailValue = useWatch({ control, name: "email" }) ?? "";
  const nameValue = useWatch({ control, name: "name" }) ?? "";
  const passwordValue = useWatch({ control, name: "password" }) ?? "";
  const typoHint = useEmailTypoHint(emailValue);
  const emailField = register("email");

  const onSubmit = async (values: RegisterFormValues) => {
    setFormError(null);
    try {
      // The "type it again" fields only check for typos in the browser, so
      // they aren't sent.
      const { accountType, name, email, password, orgName } = values;
      const result = await registerUser({
        accountType,
        name,
        email,
        password,
        orgName,
      });
      if (result.verificationRequired) {
        setWaiting({ email: result.email, signupToken: result.signupToken });
      } else {
        const me = await establishSession(result.accessToken);
        navigate(resolvePostAuthPath(me.memberships), { replace: true });
      }
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

  if (waiting) {
    return (
      <AuthShell>
        <CheckEmailPanel
          email={waiting.email}
          signupToken={waiting.signupToken}
          onSignedIn={(me) =>
            navigate(resolvePostAuthPath(me.memberships), { replace: true })
          }
          onStartOver={() => setWaiting(null)}
        />
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
            Choose how you want to get started. You can join an organization
            later.
          </p>
        </div>

        <ErrorBanner message={formError} />

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            Account type
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="cursor-pointer">
              <input
                type="radio"
                value="admin"
                {...register("accountType")}
                className="peer sr-only"
              />
              <span className="block h-full rounded-lg border border-slate-200 p-3 transition-colors peer-checked:border-teal-600 peer-checked:bg-teal-50/70 peer-focus-visible:ring-2 peer-focus-visible:ring-teal-600 dark:border-slate-700 dark:peer-checked:border-teal-500 dark:peer-checked:bg-teal-950/40">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Admin
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                  Create and manage an organization
                </span>
              </span>
            </label>
            <label className="cursor-pointer">
              <input
                type="radio"
                value="user"
                {...register("accountType")}
                className="peer sr-only"
              />
              <span className="block h-full rounded-lg border border-slate-200 p-3 transition-colors peer-checked:border-teal-600 peer-checked:bg-teal-50/70 peer-focus-visible:ring-2 peer-focus-visible:ring-teal-600 dark:border-slate-700 dark:peer-checked:border-teal-500 dark:peer-checked:bg-teal-950/40">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                  User
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                  Join an organization later
                </span>
              </span>
            </label>
          </div>
        </fieldset>

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
            {...emailField}
            onBlur={(event) => {
              void emailField.onBlur(event);
              typoHint.check();
            }}
            className={inputStyles}
          />
          <EmailTypoHint
            suggestion={typoHint.suggestion}
            onUse={(email) =>
              setValue("email", email, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
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
          <PasswordInput
            id="password"
            autoComplete="new-password"
            {...register("password")}
          />
          <PasswordHelp
            password={passwordValue}
            email={emailValue}
            name={nameValue}
            fieldError={errors.password?.message}
          />
        </Field>

        <Field
          label="Type your password again"
          htmlFor="confirm-password"
          error={errors.confirmPassword?.message}
        >
          <PasswordInput
            id="confirm-password"
            autoComplete="new-password"
            {...register("confirmPassword")}
          />
        </Field>

        {accountType === "admin" && (
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
        )}

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
