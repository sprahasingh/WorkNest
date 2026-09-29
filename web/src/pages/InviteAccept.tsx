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
import { AuthShell } from "@/components/AuthShell";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";

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
      <AuthShell>
        <p className="text-center text-sm text-slate-500">Loading…</p>
      </AuthShell>
    );
  }

  if (previewQuery.isError) {
    return (
      <AuthShell>
        <p className="text-center text-sm text-slate-600">
          This invite doesn&apos;t exist.
        </p>
      </AuthShell>
    );
  }

  const preview = previewQuery.data;

  if (preview.expired) {
    return (
      <AuthShell>
        <p className="text-center text-sm text-slate-600">
          This invite has expired or was revoked. Ask an admin to send a new
          one.
        </p>
      </AuthShell>
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
    <AuthShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            You&apos;re invited
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Join{" "}
            <span className="font-medium text-slate-700">
              {preview.organizationName}
            </span>{" "}
            as <span className="font-mono">{preview.role}</span>
          </p>
        </div>

        <ErrorBanner message={formError} />

        {isMatchingUser ? (
          <Button
            type="button"
            onClick={() => void handleAccept()}
            disabled={isAccepting}
            className="w-full"
          >
            {isAccepting ? "Joining…" : `Accept as ${preview.email}`}
          </Button>
        ) : (
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
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register("password")}
                className={inputStyles}
              />
            </Field>

            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Creating account…" : "Create account & join"}
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
