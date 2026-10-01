import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { AuthShell } from "@/components/AuthShell";
import { parseApiError } from "@/lib/apiError";
import { resolvePostAuthPath } from "@/lib/postAuthRedirect";

export function VerifyRegistration() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = new URLSearchParams(location.search).get("token");
  const { verifyRegistration } = useAuth();
  const startedToken = useRef<string | null>(null);
  const [message, setMessage] = useState(
    token
      ? "Verifying your email address…"
      : "This verification link is missing its token.",
  );
  const [hasError, setHasError] = useState(!token);

  useEffect(() => {
    if (!token || startedToken.current === token) return;
    startedToken.current = token;
    let isCurrent = true;

    void verifyRegistration(token)
      .then((me) => {
        if (isCurrent) {
          navigate(resolvePostAuthPath(me.memberships), { replace: true });
        }
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        setMessage(parseApiError(error).message);
        setHasError(true);
      });

    return () => {
      isCurrent = false;
    };
  }, [navigate, token, verifyRegistration]);

  return (
    <AuthShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            {hasError ? "Email verification failed" : "Verify your email"}
          </h1>
          <p
            role={hasError ? "alert" : "status"}
            className="mt-2 text-sm text-slate-600 dark:text-slate-400"
          >
            {message}
          </p>
        </div>
        {hasError && (
          <Link
            to="/register"
            className="inline-block text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            Return to registration
          </Link>
        )}
      </div>
    </AuthShell>
  );
}
