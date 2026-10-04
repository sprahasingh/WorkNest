import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { AuthShell } from "@/components/AuthShell";
import { Field, inputStyles } from "@/components/ui/Field";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { resendVerification } from "@/api/auth";
import { useCooldown } from "@/hooks/useCooldown";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { ResendButton } from "@/components/ui/ResendButton";
import { parseApiError } from "@/lib/apiError";
import { resolvePostAuthPath } from "@/lib/postAuthRedirect";

// Finishing sign-up asks for the password chosen when it started, so a link
// sent to someone's inbox can't activate an account a stranger set up.
export function VerifyRegistration() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = new URLSearchParams(location.search).get("token");
  const { verifyRegistration } = useAuth();
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // For a link that has expired: ask for a new one.
  const [resendEmail, setResendEmail] = useState("");
  const [resendNote, setResendNote] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const cooldown = useCooldown(60);
  const [linkError, setLinkError] = useState<string | null>(
    token ? null : "This verification link is missing its token.",
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !password) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      const me = await verifyRegistration(token, password);
      navigate(resolvePostAuthPath(me.memberships), { replace: true });
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.code === "REGISTRATION_PASSWORD_MISMATCH") {
        setFormError(parsed.message);
      } else {
        setLinkError(parsed.message);
      }
      setIsSubmitting(false);
    }
  };

  const onResend = async (event: FormEvent) => {
    event.preventDefault();
    if (!resendEmail.trim()) return;
    setIsResending(true);
    setResendNote(null);
    try {
      await resendVerification(resendEmail.trim());
      cooldown.start();
      setResendNote(
        "If a sign-up is waiting for that email, we've sent a new link. Check your inbox and your spam or junk folder.",
      );
    } catch (error) {
      setResendNote(parseApiError(error).message);
    } finally {
      setIsResending(false);
    }
  };

  return (
    <AuthShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            {linkError ? "Email verification failed" : "Confirm your email"}
          </h1>
          <p
            role={linkError ? "alert" : undefined}
            className="mt-2 text-sm text-slate-600 dark:text-slate-400"
          >
            {linkError ??
              "Enter the password you chose when you signed up to finish creating your account."}
          </p>
        </div>

        {linkError ? (
          <div className="space-y-4">
            <form
              onSubmit={(event) => void onResend(event)}
              noValidate
              className="space-y-3"
            >
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Links work for one hour, and a newer link replaces an older one.
                Enter the email you signed up with and we&apos;ll send a new
                one.
              </p>
              <Field label="Email" htmlFor="resend-email">
                <input
                  id="resend-email"
                  type="email"
                  autoComplete="email"
                  value={resendEmail}
                  onChange={(event) => setResendEmail(event.target.value)}
                  className={inputStyles}
                />
              </Field>
              {resendNote && (
                <p
                  role="status"
                  className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-100"
                >
                  {resendNote}
                </p>
              )}
              <ResendButton
                type="submit"
                variant="primary"
                label="Send a new link"
                secondsLeft={cooldown.left}
                disabled={!resendEmail.trim() || isResending}
                loading={isResending}
                className="w-full"
              />
            </form>
            <Link
              to="/register"
              className="inline-block text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              Return to registration
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(event) => void onSubmit(event)}
            noValidate
            className="space-y-4"
          >
            <ErrorBanner message={formError} />
            <Field label="Password" htmlFor="verify-password">
              <PasswordInput
                id="verify-password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
              />
            </Field>
            <Button
              type="submit"
              disabled={!password || isSubmitting}
              loading={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? "Confirming…" : "Confirm and continue"}
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
