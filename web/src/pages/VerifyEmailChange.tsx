import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { AuthShell } from "@/components/AuthShell";
import { parseApiError } from "@/lib/apiError";
import { verifyEmailChange } from "@/api/auth";

type VerificationState = "checking" | "success" | "error";

export function VerifyEmailChange() {
  const location = useLocation();
  const token = new URLSearchParams(location.search).get("token");
  const { updateCurrentUser } = useAuth();
  const startedToken = useRef<string | null>(null);
  const [state, setState] = useState<VerificationState>(
    token ? "checking" : "error",
  );
  const [message, setMessage] = useState(
    token
      ? "Confirming your email address…"
      : "This verification link is missing its token.",
  );

  useEffect(() => {
    if (!token || startedToken.current === token) return;
    startedToken.current = token;
    let isCurrent = true;

    void verifyEmailChange(token)
      .then((user) => {
        if (!isCurrent) return;
        updateCurrentUser(user);
        setMessage("Your email address has been updated.");
        setState("success");
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        setMessage(parseApiError(error).message);
        setState("error");
      });

    return () => {
      isCurrent = false;
    };
  }, [token, updateCurrentUser]);

  return (
    <AuthShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            {state === "checking"
              ? "Confirming email"
              : state === "success"
                ? "Email updated"
                : "Email not updated"}
          </h1>
          <p
            role={state === "error" ? "alert" : "status"}
            className="mt-2 text-sm text-slate-600 dark:text-slate-400"
          >
            {message}
          </p>
        </div>
        {state !== "checking" && (
          <Link
            to="/login"
            className="inline-block text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            Return to WorkNest
          </Link>
        )}
      </div>
    </AuthShell>
  );
}
