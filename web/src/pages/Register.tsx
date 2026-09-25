import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";

const registerFormSchema = z.object({
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
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

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
      await registerUser(values);
      navigate("/orgs", { replace: true });
    } catch (error) {
      const parsed = parseApiError(error);
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        noValidate
        className="w-full max-w-sm space-y-4 rounded-lg bg-white p-8 shadow"
      >
        <h1 className="text-2xl font-bold text-slate-800">
          Create your account
        </h1>

        {formError && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        )}

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
            <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-700"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register("email")}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
          {errors.email && (
            <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
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

        <div>
          <label
            htmlFor="orgName"
            className="block text-sm font-medium text-slate-700"
          >
            Organization name
          </label>
          <input
            id="orgName"
            type="text"
            autoComplete="organization"
            {...register("orgName")}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
          {errors.orgName && (
            <p className="mt-1 text-sm text-red-600">
              {errors.orgName.message}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
        >
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>

        <p className="text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-slate-800 underline">
            Log in
          </Link>
        </p>
      </form>
    </div>
  );
}
