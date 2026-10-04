import { PASSWORD_TOO_LONG, passwordFitsLimit } from "@/lib/passwordPolicy";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/auth-context";
import {
  acceptInvite,
  declineInvite,
  getInvitePreview,
  signupViaInvite,
  type InviteStatus,
} from "@/api/invites";
import { resolvePostAuthPath } from "@/lib/postAuthRedirect";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import { AuthShell } from "@/components/AuthShell";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PasswordHelp } from "@/components/ui/PasswordHelp";
import { CheckEmailPanel } from "@/components/CheckEmailPanel";

const signupFormSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .refine(passwordFitsLimit, PASSWORD_TOO_LONG),
    confirmPassword: z.string().min(1, "Please type your password again"),
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
  });

type SignupFormValues = z.infer<typeof signupFormSchema>;

const SIGNUP_FIELDS = ["name", "password"] as const;

const ROLE_LABELS = { admin: "Admin", manager: "Manager", member: "Member" };

// Why a link that's no longer pending can't be used.
const CLOSED_MESSAGES: Record<Exclude<InviteStatus, "pending">, string> = {
  accepted: "This invite has already been used.",
  declined:
    "This invite was declined. Ask an admin to invite you again if you've changed your mind.",
  revoked:
    "This invite link was replaced or revoked. Ask an admin for a new one.",
  expired: "This invite has expired. Ask an admin to send a new one.",
};

const secondaryLinkStyles =
  "inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";

export function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [waiting, setWaiting] = useState<{
    email: string;
    signupToken: string;
  } | null>(null);

  const previewQuery = useQuery({
    queryKey: ["invites", token],
    queryFn: () => getInvitePreview(token!),
    enabled: Boolean(token),
    retry: false,
  });

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupFormSchema),
  });
  const passwordValue = useWatch({ control, name: "password" }) ?? "";
  const nameValue = useWatch({ control, name: "name" }) ?? "";

  if (!token || previewQuery.isPending) {
    return (
      <AuthShell>
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          Loading…
        </p>
      </AuthShell>
    );
  }

  if (previewQuery.isError) {
    return (
      <AuthShell>
        <p className="text-center text-sm text-slate-600 dark:text-slate-400">
          This invite doesn&apos;t exist.
        </p>
      </AuthShell>
    );
  }

  const preview = previewQuery.data;
  const isSignedIn = auth.status === "authenticated";
  const workspacePath = resolvePostAuthPath(auth.memberships ?? []);
  const loginPath = `/login?next=${encodeURIComponent(`/invite/${token}`)}`;

  const closedMessage = declined
    ? `You declined the invite to ${preview.organizationName}.`
    : preview.status !== "pending"
      ? CLOSED_MESSAGES[preview.status]
      : null;

  if (closedMessage) {
    return (
      <AuthShell>
        <div className="space-y-4 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {closedMessage}
          </p>
          <Link
            to={isSignedIn ? workspacePath : "/login"}
            className={secondaryLinkStyles}
          >
            {isSignedIn ? "Go to your workspace" : "Log in"}
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (waiting) {
    return (
      <AuthShell>
        <CheckEmailPanel
          email={waiting.email}
          signupToken={waiting.signupToken}
          onSignedIn={(me) => {
            const orgId = me.memberships[0]?.tenantId.id;
            navigate(orgId ? `/orgs/${orgId}/dashboard` : "/orgs", {
              replace: true,
            });
          }}
          onStartOver={() => setWaiting(null)}
        />
      </AuthShell>
    );
  }

  const isMatchingUser =
    isSignedIn && auth.user.email.toLowerCase() === preview.email.toLowerCase();
  const isOtherUser = isSignedIn && !isMatchingUser;

  const handleDecline = async () => {
    setFormError(null);
    setIsDeclining(true);
    try {
      await declineInvite(token);
      setDeclined(true);
    } catch (error) {
      setFormError(parseApiError(error).message);
    } finally {
      setIsDeclining(false);
    }
  };

  const handleAccept = async () => {
    setFormError(null);
    setIsAccepting(true);
    try {
      const { membership } = await acceptInvite(token);
      await auth.refreshMemberships();
      navigate(`/orgs/${membership.tenantId}/dashboard`, { replace: true });
    } catch (error) {
      const parsed = parseApiError(error);
      setFormError(parsed.message);
      setIsAccepting(false);
    }
  };

  const onSubmit = async (values: SignupFormValues) => {
    setFormError(null);
    try {
      const result = await signupViaInvite(token, {
        name: values.name,
        password: values.password,
      });
      if (!result.verificationRequired) {
        const me = await auth.establishSession(result.accessToken);
        const orgId = me.memberships[0]?.tenantId.id;
        navigate(orgId ? `/orgs/${orgId}/dashboard` : "/orgs", {
          replace: true,
        });
        return;
      }
      setWaiting({ email: result.email, signupToken: result.signupToken });
    } catch (error) {
      const parsed = parseApiError(error);
      if (Object.keys(parsed.fieldErrors).length === 0) {
        setFormError(parsed.message);
        return;
      }
      const unmatched = applyFieldErrors(
        parsed.fieldErrors,
        SIGNUP_FIELDS,
        setError,
      );
      if (unmatched.length > 0) {
        setFormError(unmatched.join(" "));
      }
    }
  };

  return (
    <AuthShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            You&apos;re invited
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Join{" "}
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {preview.organizationName}
            </span>{" "}
            as{" "}
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {ROLE_LABELS[preview.role].toLowerCase()}
            </span>
          </p>
        </div>

        <ErrorBanner message={formError} />

        {isMatchingUser && (
          <div className="space-y-2">
            <Button
              type="button"
              onClick={() => void handleAccept()}
              disabled={isAccepting || isDeclining}
              loading={isAccepting}
              className="w-full"
            >
              {isAccepting ? "Joining…" : `Join as ${preview.email}`}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handleDecline()}
              disabled={isAccepting || isDeclining}
              loading={isDeclining}
              className="w-full"
            >
              Decline
            </Button>
          </div>
        )}

        {isOtherUser && (
          <div className="space-y-3">
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              This invite is for{" "}
              <span className="font-medium">{preview.email}</span>, but
              you&apos;re signed in as{" "}
              <span className="font-medium">{auth.user.email}</span>.
            </p>
            <Button
              type="button"
              onClick={() => void auth.logout()}
              disabled={auth.isLoggingOut}
              loading={auth.isLoggingOut}
              className="w-full"
            >
              Log out and continue as {preview.email}
            </Button>
            <Link to={workspacePath} className={secondaryLinkStyles}>
              Stay signed in as {auth.user.email}
            </Link>
          </div>
        )}

        {!isSignedIn && preview.accountExists && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-800 dark:text-slate-100">
                {preview.email}
              </span>{" "}
              already has a WorkNest account. Log in to join. Your other
              organizations stay as they are.
            </p>
            <Link
              to={loginPath}
              className="inline-flex w-full items-center justify-center rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400"
            >
              Log in to accept
            </Link>
          </div>
        )}

        {!isSignedIn && !preview.accountExists && (
          <form
            onSubmit={(event) => void handleSubmit(onSubmit)(event)}
            noValidate
            className="space-y-4"
          >
            <Field label="Email" htmlFor="invite-email">
              <input
                id="invite-email"
                type="email"
                value={preview.email}
                disabled
                className={inputStyles}
              />
            </Field>

            <Field
              label="Your name"
              htmlFor="name"
              error={errors.name?.message}
            >
              <input
                id="name"
                type="text"
                autoComplete="name"
                {...register("name")}
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
                autoComplete="new-password"
                {...register("password")}
              />
              <PasswordHelp
                password={passwordValue}
                email={preview.email}
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

            <Button
              type="submit"
              disabled={isSubmitting}
              loading={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? "Creating account…" : "Create account & join"}
            </Button>

            <p className="text-center text-sm text-slate-500 dark:text-slate-400">
              Already have an account?{" "}
              <Link
                to={loginPath}
                className="font-medium text-teal-700 hover:underline dark:text-teal-400"
              >
                Log in
              </Link>
            </p>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
