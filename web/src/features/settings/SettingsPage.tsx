import { useRef, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { getCountryForTimezone } from "countries-and-timezones";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/auth/auth-context";
import {
  useOrgDetails,
  useUpdateOrg,
  useChangePlan,
} from "@/features/org/queries";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { updatePersonalInformation, type Plan } from "@/api/auth";
import { cn } from "@/lib/cn";
import {
  PLAN_LIMITS,
  PLAN_NAMES,
  PLAN_ORDER,
  formatTaskLimit,
} from "@/lib/plans";

const DELETE_CONFIRMATION_TEXT = "delete my account";

const TIME_ZONE_VALUES = Array.from(
  new Set([...Intl.supportedValuesOf("timeZone"), "UTC"]),
).sort();

function timeZoneAreaLabel(timeZone: string) {
  const [, ...areaParts] = timeZone.split("/");
  const area = areaParts.map((part) => part.replaceAll("_", " ")).join(" / ");
  return area ? `${area} (${timeZone})` : timeZone;
}

const TIME_ZONE_GROUPS = TIME_ZONE_VALUES.reduce<Record<string, string[]>>(
  (groups, timeZone) => {
    const region = timeZone.split("/")[0] ?? "Other";
    (groups[region] ??= []).push(timeZone);
    return groups;
  },
  {},
);

function buildTimeZoneSearchText(timeZone: string) {
  const [region = "Other", ...areaParts] = timeZone.split("/");
  const country = getCountryForTimezone(timeZone);
  const displayName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "long",
  })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value;

  return [
    timeZoneAreaLabel(timeZone),
    timeZone,
    region,
    ...areaParts.map((part) => part.replaceAll("_", " ")),
    country?.name,
    country?.id,
    country?.id === "US" ? "USA US" : undefined,
    timeZone === "Asia/Calcutta" ? "Kolkata Asia/Kolkata" : undefined,
    displayName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

const TIME_ZONE_SEARCH_TEXT = new Map(
  TIME_ZONE_VALUES.map((timeZone) => [
    timeZone,
    buildTimeZoneSearchText(timeZone),
  ]),
);

function TimeZoneSelect({
  control,
  disabled,
}: {
  control: ReturnType<
    typeof useForm<OrganizationSettingsFormValues>
  >["control"];
  disabled: boolean;
}) {
  const { field } = useController({ name: "timeZone", control });
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const matchesSearch = (timeZone: string) =>
    !normalizedSearch ||
    (
      TIME_ZONE_SEARCH_TEXT.get(timeZone) ?? buildTimeZoneSearchText(timeZone)
    ).includes(normalizedSearch);
  const savedTimeZone =
    field.value && !TIME_ZONE_VALUES.includes(field.value) ? field.value : null;
  const visibleGroups = Object.entries(TIME_ZONE_GROUPS)
    .map(
      ([region, timeZones]) =>
        [region, timeZones.filter(matchesSearch)] as const,
    )
    .filter(([, timeZones]) => timeZones.length > 0);
  const visibleTimeZones = visibleGroups.flatMap(([, timeZones]) => timeZones);
  const visibleSavedTimeZone = savedTimeZone && matchesSearch(savedTimeZone);
  const visibleOptionValues = [
    ...(visibleSavedTimeZone && savedTimeZone ? [savedTimeZone] : []),
    ...visibleTimeZones,
  ];
  const closeDropdown = () => {
    setIsOpen(false);
    setSearch("");
  };

  const handleOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex =
        (index +
          (event.key === "ArrowDown" ? 1 : -1) +
          visibleOptionValues.length) %
        visibleOptionValues.length;
      optionRefs.current[nextIndex]?.focus();
    } else if (event.key === "Escape") {
      closeDropdown();
      triggerRef.current?.focus();
    }
  };

  let optionIndex = 0;
  const renderOption = (timeZone: string) => {
    const index = optionIndex++;
    return (
      <button
        key={timeZone}
        ref={(element) => {
          optionRefs.current[index] = element;
        }}
        type="button"
        tabIndex={-1}
        role="option"
        aria-selected={field.value === timeZone}
        onKeyDown={(event) => handleOptionKeyDown(event, index)}
        onClick={() => {
          field.onChange(timeZone);
          closeDropdown();
          triggerRef.current?.focus();
        }}
        className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:text-slate-200 dark:hover:bg-slate-700 dark:focus:bg-slate-700"
      >
        {timeZoneAreaLabel(timeZone)}
      </button>
    );
  };

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          field.onBlur();
          setIsOpen(false);
          setSearch("");
        }
      }}
    >
      <button
        ref={(element) => {
          triggerRef.current = element;
          field.ref(element);
        }}
        id="timeZone"
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="timeZone-options"
        onClick={() => {
          if (isOpen) {
            closeDropdown();
          } else {
            setIsOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
          }
        }}
        className={cn(
          inputStyles,
          "flex items-center justify-between text-left",
        )}
      >
        <span>{timeZoneAreaLabel(field.value)}</span>
        <span aria-hidden="true" className="ml-2 text-slate-500">
          ▾
        </span>
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 shadow-lg dark:border-slate-600 dark:bg-slate-800">
          <input
            type="search"
            autoFocus
            aria-label="Search time zones"
            placeholder="Search time zones"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeDropdown();
                triggerRef.current?.focus();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                optionRefs.current[0]?.focus();
              }
            }}
            className={cn(inputStyles, "mt-0")}
          />
          <div
            id="timeZone-options"
            role="listbox"
            aria-label="Time zones"
            className="max-h-64 overflow-y-auto"
          >
            {visibleSavedTimeZone &&
              savedTimeZone &&
              renderOption(savedTimeZone)}
            {visibleGroups.map(([region, timeZones]) => (
              <div key={region} role="group" aria-label={region}>
                <p className="px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {region}
                </p>
                {timeZones.map(renderOption)}
              </div>
            ))}
            {visibleTimeZones.length === 0 && !visibleSavedTimeZone && (
              <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                No time zones found
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const organizationSettingsFormSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  timeZone: z
    .string()
    .trim()
    .min(1)
    .refine((timeZone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone });
        return true;
      } catch {
        return false;
      }
    }, "Enter a valid IANA time zone"),
});

type OrganizationSettingsFormValues = z.infer<
  typeof organizationSettingsFormSchema
>;

const ORGANIZATION_SETTINGS_FIELDS = ["name", "timeZone"] as const;

const personalInformationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100),
    email: z.string().trim().email("Enter a valid email"),
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().max(72).optional(),
    confirmNewPassword: z.string().optional(),
  })
  .superRefine((values, context) => {
    if (values.newPassword && values.newPassword.length < 8) {
      context.addIssue({
        code: "custom",
        path: ["newPassword"],
        message: "New password must be at least 8 characters",
      });
    }
    if (values.newPassword !== values.confirmNewPassword) {
      context.addIssue({
        code: "custom",
        path: ["confirmNewPassword"],
        message: "Passwords do not match",
      });
    }
  });

type PersonalInformationFormValues = z.infer<typeof personalInformationSchema>;

const PERSONAL_INFORMATION_FIELDS = [
  "name",
  "email",
  "currentPassword",
  "newPassword",
] as const;

function PersonalInformationCard() {
  const { user, updateCurrentUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PersonalInformationFormValues>({
    resolver: zodResolver(personalInformationSchema),
    defaultValues: {
      name: user?.name ?? "",
      email: user?.email ?? "",
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    },
  });

  const cancelEditing = () => {
    reset({
      name: user?.name ?? "",
      email: user?.email ?? "",
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    });
    setFormError(null);
    setIsEditing(false);
  };

  const onSubmit = async (values: PersonalInformationFormValues) => {
    setFormError(null);
    try {
      const updatedUser = await updatePersonalInformation({
        name: values.name,
        email: values.email,
        currentPassword: values.currentPassword,
        ...(values.newPassword ? { newPassword: values.newPassword } : {}),
      });
      updateCurrentUser(updatedUser);
      reset({
        name: updatedUser.name,
        email: updatedUser.email,
        currentPassword: "",
        newPassword: "",
        confirmNewPassword: "",
      });
      setIsEditing(false);
      toast.success("Personal information updated");
    } catch (error) {
      const parsed = parseApiError(error);
      if (Object.keys(parsed.fieldErrors).length === 0) {
        setFormError(parsed.message);
        return;
      }
      const unmatched = applyFieldErrors(
        parsed.fieldErrors,
        PERSONAL_INFORMATION_FIELDS,
        setError,
      );
      if (unmatched.length > 0) setFormError(unmatched.join(" "));
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-medium text-slate-800 dark:text-slate-100">
            Personal information
          </h2>
          {!isEditing && (
            <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-slate-500 dark:text-slate-400">Name</dt>
                <dd className="break-words font-medium text-slate-800 dark:text-slate-200">
                  {user?.name ?? "Unavailable"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-slate-500 dark:text-slate-400">Email</dt>
                <dd className="break-all font-medium text-slate-800 dark:text-slate-200">
                  {user?.email ?? "Unavailable"}
                </dd>
              </div>
            </dl>
          )}
        </div>
        {!isEditing && user && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsEditing(true)}
            className="w-full shrink-0 sm:w-auto"
          >
            Edit personal information
          </Button>
        )}
      </div>

      {isEditing && (
        <form
          id="personal-information-form"
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          noValidate
          className="mt-4 space-y-4"
        >
          <ErrorBanner message={formError} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Name"
              htmlFor="profile-name"
              error={errors.name?.message}
            >
              <input
                id="profile-name"
                autoComplete="name"
                {...register("name")}
                className={inputStyles}
              />
            </Field>
            <Field
              label="Email"
              htmlFor="profile-email"
              error={errors.email?.message}
            >
              <input
                id="profile-email"
                type="email"
                autoComplete="email"
                {...register("email")}
                className={inputStyles}
              />
            </Field>
            <Field
              label="Current password"
              htmlFor="profile-current-password"
              error={errors.currentPassword?.message}
            >
              <input
                id="profile-current-password"
                type="password"
                autoComplete="current-password"
                {...register("currentPassword")}
                className={inputStyles}
              />
            </Field>
            <Field
              label="New password (optional)"
              htmlFor="profile-new-password"
              error={errors.newPassword?.message}
            >
              <input
                id="profile-new-password"
                type="password"
                autoComplete="new-password"
                {...register("newPassword")}
                className={inputStyles}
              />
            </Field>
            <Field
              label="Confirm new password"
              htmlFor="profile-confirm-password"
              error={errors.confirmNewPassword?.message}
            >
              <input
                id="profile-confirm-password"
                type="password"
                autoComplete="new-password"
                {...register("confirmNewPassword")}
                className={inputStyles}
              />
            </Field>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Confirm your current password to save changes. Leave the new
            password blank to keep it unchanged.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={cancelEditing}
              disabled={isSubmitting}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !user}
              loading={isSubmitting}
              className="w-full sm:w-auto"
            >
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

interface DowngradeBlockedDetail {
  seatsUsed: number;
  projectCount: number;
  projectsOverTaskLimit?: number;
  targetSeatLimit: number;
  targetProjectLimit: number;
  targetActiveTaskLimit?: number | null;
}

export function SettingsPage() {
  const { orgId } = useOrg();
  const { logout, isLoggingOut, deleteAccount, isDeletingAccount } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const canUpdateOrg = useCan("org:update");
  const canChangePlan = useCan("plan:change");

  const [formError, setFormError] = useState<string | null>(null);

  const { data: org, isPending, isError } = useOrgDetails(orgId);
  const updateOrg = useUpdateOrg(orgId);
  const changePlan = useChangePlan(orgId);

  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<OrganizationSettingsFormValues>({
    resolver: zodResolver(organizationSettingsFormSchema),
    values: org
      ? { name: org.name, timeZone: org.timeZone ?? "UTC" }
      : undefined,
  });

  const onOrganizationSettingsSubmit = async (
    values: OrganizationSettingsFormValues,
  ) => {
    setFormError(null);
    try {
      await updateOrg.mutateAsync(values);
      toast.success("Organization settings updated");
    } catch (error) {
      const parsed = parseApiError(error);
      if (Object.keys(parsed.fieldErrors).length === 0) {
        setFormError(parsed.message);
        return;
      }
      const unmatched = applyFieldErrors(
        parsed.fieldErrors,
        ORGANIZATION_SETTINGS_FIELDS,
        setError,
      );
      if (unmatched.length > 0) {
        setFormError(unmatched.join(" "));
      }
    }
  };

  const handlePlanChange = async (newPlan: Plan) => {
    const name = PLAN_NAMES[newPlan];
    try {
      await changePlan.mutateAsync(newPlan);
      toast.success(`You're now on the ${name} plan`);
    } catch (error) {
      const parsed = parseApiError(error);

      if (parsed.code === "PLAN_DOWNGRADE_BLOCKED" && parsed.details[0]) {
        const detail = parsed.details[0] as DowngradeBlockedDetail;
        const reasons: string[] = [];
        if (detail.seatsUsed > detail.targetSeatLimit) {
          reasons.push(
            `${detail.seatsUsed} seats in use (${name} allows ${detail.targetSeatLimit})`,
          );
        }
        if (detail.projectCount > detail.targetProjectLimit) {
          reasons.push(
            `${detail.projectCount} projects (${name} allows ${detail.targetProjectLimit})`,
          );
        }
        if (detail.projectsOverTaskLimit && detail.targetActiveTaskLimit) {
          const count = detail.projectsOverTaskLimit;
          reasons.push(
            `${count} ${count === 1 ? "project has" : "projects have"} more than ${detail.targetActiveTaskLimit} active tasks`,
          );
        }
        toast.error(`Can't switch to ${name} yet`, {
          description: `${reasons.join("; ")}. Reduce usage first.`,
        });
        return;
      }

      toast.error(parsed.message);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await deleteAccount();
      toast.success("Your account has been deleted");
    } catch (error) {
      toast.error(parseApiError(error).message);
    }
  };

  if (isPending) {
    return (
      <div className="bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <PersonalInformationCard />
          <div className="h-32 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
    );
  }

  if (isError || !org) {
    return (
      <div className="bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
        <p className="mx-auto max-w-2xl text-sm text-red-600 dark:text-red-400">
          Couldn&apos;t load organization settings.
        </p>
        <div className="mx-auto max-w-2xl">
          <PersonalInformationCard />
        </div>
      </div>
    );
  }

  const currentPlan = org.plan as Plan;
  const currentRank = PLAN_ORDER.indexOf(currentPlan);
  const pendingPlan = changePlan.isPending ? changePlan.variables : null;

  return (
    <div className="bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Settings
        </h1>

        <PersonalInformationCard />

        <Card>
          <h2 className="font-medium text-slate-800 dark:text-slate-100">
            Organization settings
          </h2>

          <div className="mt-3">
            <ErrorBanner message={formError} />
          </div>

          <form
            onSubmit={(event) =>
              void handleSubmit(onOrganizationSettingsSubmit)(event)
            }
            noValidate
            className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          >
            <div className="flex-1">
              <Field label="Name" htmlFor="name" error={errors.name?.message}>
                <input
                  id="name"
                  type="text"
                  disabled={!canUpdateOrg}
                  {...register("name")}
                  className={inputStyles}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field
                label="Time zone"
                htmlFor="timeZone"
                error={errors.timeZone?.message}
              >
                <TimeZoneSelect control={control} disabled={!canUpdateOrg} />
              </Field>
            </div>

            {canUpdateOrg && (
              <Button
                type="submit"
                disabled={isSubmitting}
                loading={isSubmitting}
              >
                {isSubmitting ? "Saving…" : "Save"}
              </Button>
            )}
          </form>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-slate-800 dark:text-slate-100">
              Plan
            </h2>
            <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-sm font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
              {PLAN_NAMES[currentPlan]}
            </span>
          </div>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Seats</dt>
              <dd className="text-slate-700 dark:text-slate-300">
                {org.seatsUsed} / {org.seatLimit}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Projects</dt>
              <dd className="text-slate-700 dark:text-slate-300">
                {org.projectCount} / {org.projectLimit}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">
                Active tasks per project
              </dt>
              <dd className="text-slate-700 dark:text-slate-300">
                {formatTaskLimit(PLAN_LIMITS[currentPlan].activeTaskLimit)}
              </dd>
            </div>
          </dl>

          <ul aria-label="Plans" className="mt-5 grid gap-3 sm:grid-cols-3">
            {PLAN_ORDER.map((plan, rank) => {
              const limits = PLAN_LIMITS[plan];
              const isCurrent = plan === currentPlan;
              const isUpgrade = rank > currentRank;
              return (
                <li
                  key={plan}
                  className={cn(
                    "flex flex-col rounded-xl border p-4",
                    isCurrent
                      ? "border-teal-500 bg-teal-50/50 dark:border-teal-500/70 dark:bg-teal-900/10"
                      : "border-slate-200 dark:border-slate-700",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900 dark:text-slate-50">
                      {PLAN_NAMES[plan]}
                    </p>
                    {isCurrent && (
                      <span className="rounded-full bg-teal-600 px-2 py-0.5 text-xs font-medium text-white">
                        Current
                      </span>
                    )}
                  </div>
                  <ul className="mt-3 flex-1 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                    <li>{limits.seatLimit} seats</li>
                    <li>{limits.projectLimit} projects</li>
                    <li>
                      {limits.activeTaskLimit === null
                        ? "Unlimited active tasks"
                        : `${limits.activeTaskLimit} active tasks per project`}
                    </li>
                  </ul>
                  {canChangePlan && !isCurrent && (
                    <Button
                      size="sm"
                      variant={isUpgrade ? "primary" : "secondary"}
                      onClick={() => void handlePlanChange(plan)}
                      disabled={changePlan.isPending}
                      loading={pendingPlan === plan}
                      className="mt-4 w-full"
                    >
                      {isUpgrade
                        ? `Upgrade to ${PLAN_NAMES[plan]}`
                        : `Switch to ${PLAN_NAMES[plan]}`}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          {!canChangePlan && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Only admins can change the plan.
            </p>
          )}
        </Card>

        <Card>
          <h2 className="font-medium text-slate-800 dark:text-slate-100">
            Session
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Sign out of WorkNest on this device.
          </p>
          <Button
            variant="secondary"
            onClick={() => void logout()}
            loading={isLoggingOut}
            className="mt-4"
          >
            {isLoggingOut ? "Logging out…" : "Log out"}
          </Button>
        </Card>

        <Card className="border-red-200 dark:border-red-900/40">
          <h2 className="font-medium text-red-700 dark:text-red-400">
            Danger zone
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Delete your account and leave every workspace you belong to.
            You&apos;ll be signed out, and your email is freed so you can sign
            up or accept an invite again later. If you&apos;re the only admin of
            a workspace with other people in it, make someone else an admin
            first.
          </p>

          {!showDeleteConfirm ? (
            <Button
              variant="secondary"
              onClick={() => setShowDeleteConfirm(true)}
              className="mt-4 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-950/20"
            >
              Delete account
            </Button>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Type{" "}
                <span className="font-mono font-semibold">
                  {DELETE_CONFIRMATION_TEXT}
                </span>{" "}
                to confirm.
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={DELETE_CONFIRMATION_TEXT}
                className={inputStyles}
              />
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmText("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleDeleteAccount()}
                  disabled={
                    deleteConfirmText !== DELETE_CONFIRMATION_TEXT ||
                    isDeletingAccount
                  }
                  loading={isDeletingAccount}
                  className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isDeletingAccount
                    ? "Deleting…"
                    : "Permanently delete account"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
