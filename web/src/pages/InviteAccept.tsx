import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/auth-context";
import {
  acceptInvite,
  getInvitePreview,
  signupViaInvite,
} from "@/api/invites";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";

const signupFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72),
});

type SignupFormValues = z.infer<typeof signupFormSchema>;

const SIGNUP_FIELDS = ["name", "password"] as const;

export function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

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
    formState: { errors, isSubmitting },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupFormSchema),
  });

  if (!token || previewQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-500">Loading…</p>
      </div>
    );
  }

  if (previewQuery.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">This invite doesn&apos;t exist.</p>
      </div>
    );
  }

  const preview = previewQuery.data;

  if (preview.expired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="max-w-sm text-center text-slate-600">
          This invite has expired or was revoked. Ask an admin to send a new
          one.
        </p>
      </div>
    );
  }

  const isMatchingUser =
    auth.status === "authenticated" &&
    auth.user.email.toLowerCase() === preview.email.toLowerCase();

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
      const { accessToken } = await signupViaInvite(token, values);
      const me = await auth.establishSession(accessToken);
      const orgId = me.memberships[0]?.tenantId.id;
      navigate(orgId ? `/orgs/${orgId}/dashboard` : "/orgs", {
        replace: true,
      });
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
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm space-y-4 rounded-lg bg-white p-8 shadow">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            You&apos;re invited
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Join{" "}
            <span className="font-medium">{preview.organizationName}</span>{" "}
            as <span className="font-mono">{preview.role}</span>
          </p>
        </div>

        {formError && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        )}

        {isMatchingUser ? (
          <button
            type="button"
            onClick={() => void handleAccept()}
            disabled={isAccepting}
            className="w-full rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
          >
            {isAccepting ? "Joining…" : `Accept as ${preview.email}`}
          </button>
        ) : (
          <form
            onSubmit={(event) => void handleSubmit(onSubmit)(event)}
            noValidate
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                type="email"
                value={preview.email}
                disabled
                className="mt-1 w-full rounded border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500"
              />
            </div>

            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-slate-700"
              >
                Your name
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                {...register("name")}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register("password")}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.password.message}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
            >
              {isSubmitting ? "Creating account…" : "Create account & join"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
