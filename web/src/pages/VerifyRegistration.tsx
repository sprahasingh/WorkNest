import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { AuthShell } from "@/components/AuthShell";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
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
          <Link
            to="/register"
            className="inline-block text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            Return to registration
          </Link>
        ) : (
          <form
            onSubmit={(event) => void onSubmit(event)}
            noValidate
            className="space-y-4"
          >
            <ErrorBanner message={formError} />
            <Field label="Password" htmlFor="verify-password">
              <input
                id="verify-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputStyles}
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
