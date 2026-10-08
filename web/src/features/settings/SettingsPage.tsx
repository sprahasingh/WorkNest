import { PASSWORD_TOO_LONG, passwordFitsLimit } from "@/lib/passwordPolicy";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCooldown } from "@/hooks/useCooldown";
import { useLocation } from "react-router";
import {
  useController,
  useForm,
  useWatch,
  type Control,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { getCountryForTimezone } from "countries-and-timezones";
import { useOrg } from "@/hooks/useOrg";
import { useContextualOverlay } from "@/hooks/useContextualOverlay";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/auth/auth-context";
import {
  useOrgDetails,
  useOrgPlanRestoreCheck,
  useUpdateOrg,
  useChangePlan,
} from "@/features/org/queries";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/Modal";
import { ResendButton } from "@/components/ui/ResendButton";
import { PasswordHelp } from "@/components/ui/PasswordHelp";
import {
  cancelEmailChange,
  resendEmailChange,
  requestEmailChange,
  updatePersonalInformation,
  type Plan,
} from "@/api/auth";
import { cn } from "@/lib/cn";
import { ChatRetentionCard } from "./ChatRetentionCard";
import { LeaveOrganizationCard } from "./LeaveOrganizationCard";
import { SessionsCard } from "./SessionsCard";
import { billingQuery } from "@/features/billing/queries";
import { payForPlan } from "@/features/billing/razorpay";
import {
  cancelScheduledChange,
  scheduleFreeDowngrade,
} from "@/features/billing/api";
import { TestPaymentBox } from "@/features/billing/TestPaymentBox";
import { TestPlanDatesBox } from "@/features/billing/TestPlanDatesBox";
import { copyTestCard } from "@/features/billing/testDetails";
import { orgKeys } from "@/features/org/queries";
import {
  projectKeys,
  refreshRestoreCandidates,
  usePlanArchivedRestoreTasks,
  useProjects,
} from "@/features/projects/queries";
import { dashboardKeys } from "@/features/dashboard/queries";
import { InfoButton, InfoPanel } from "@/components/ui/InfoToggle";
import { RestoreProjectsPrompt } from "./RestoreProjectsPrompt";
import {
  canReviewRestoreCandidates,
  eligibleRestoreCandidates,
  persistHandledRestoreSignature,
  readHandledRestoreSignature,
  restorePromptSignature as getRestorePromptSignature,
  shouldRenderRestorePrompt,
} from "@/lib/planRestorePrompt";
import {
  PLAN_LIMITS,
  PLAN_NAMES,
  PLAN_ORDER,
  PLAN_PRICE_PAISE,
  formatRupees,
  formatTaskLimit,
  type BillingCycle,
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
  control: Control<OrganizationSettingsFormValues>;
  disabled: boolean;
}) {
  const { field } = useController({ name: "timeZone", control });
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const selectedTimeZone = field.value ?? "UTC";
  const matchesSearch = (timeZone: string) =>
    !normalizedSearch ||
    (
      TIME_ZONE_SEARCH_TEXT.get(timeZone) ?? buildTimeZoneSearchText(timeZone)
    ).includes(normalizedSearch);
  const savedTimeZone =
    selectedTimeZone && !TIME_ZONE_VALUES.includes(selectedTimeZone)
      ? selectedTimeZone
      : null;
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
  useContextualOverlay(isOpen, triggerRef, popoverRef, (reason) => {
    closeDropdown();
    if (reason === "escape") triggerRef.current?.focus();
  });

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
        aria-selected={selectedTimeZone === timeZone}
        onKeyDown={(event) => handleOptionKeyDown(event, index)}
        onClick={() => {
          field.onChange(timeZone);
          closeDropdown();
          triggerRef.current?.focus();
        }}
        className="block min-h-11 w-full px-3 py-3 text-left text-sm text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:text-slate-200 dark:hover:bg-slate-700 dark:focus:bg-slate-700"
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
        aria-label={`Time zone: ${timeZoneAreaLabel(selectedTimeZone)}`}
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
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsOpen((open) => !open);
          }
        }}
        className={cn(
          inputStyles,
          "flex items-center justify-between text-left",
        )}
      >
        <span>{timeZoneAreaLabel(selectedTimeZone)}</span>
        <span aria-hidden="true" className="ml-2 text-slate-500">
          ▾
        </span>
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute z-20 mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 shadow-lg dark:border-slate-600 dark:bg-slate-800"
        >
          <input
            type="search"
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="timeZone-options"
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
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                optionRefs.current[
                  Math.max(0, visibleOptionValues.length - 1)
                ]?.focus();
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
  chatRetentionDays: z.union([
    z.literal(90),
    z.literal(180),
    z.literal(365),
    z.null(),
  ]),
  currentPassword: z
    .string()
    .min(1, "Enter your current password to save organization settings"),
});

type OrganizationSettingsFormValues = z.infer<
  typeof organizationSettingsFormSchema
>;

const ORGANIZATION_SETTINGS_FIELDS = [
  "name",
  "timeZone",
  "chatRetentionDays",
  "currentPassword",
] as const;

const personalInformationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100),
    currentPassword: z.string().optional(),
    newPassword: z
      .string()
      .refine(passwordFitsLimit, PASSWORD_TOO_LONG)
      .optional(),
    confirmNewPassword: z.string().optional(),
  })
  .superRefine((values, context) => {
    if (!values.currentPassword) {
      context.addIssue({
        code: "custom",
        path: ["currentPassword"],
        message: "Enter your current password to save personal information",
      });
    }
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
    control,
    formState: { errors, isSubmitting },
  } = useForm<PersonalInformationFormValues>({
    resolver: zodResolver(personalInformationSchema),
    defaultValues: {
      name: user?.name ?? "",
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    },
  });
  const newPasswordValue = useWatch({ control, name: "newPassword" }) ?? "";
  const nameValue = useWatch({ control, name: "name" }) ?? "";

  const cancelEditing = () => {
    reset({
      name: user?.name ?? "",
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
        currentPassword: values.currentPassword,
        ...(values.newPassword ? { newPassword: values.newPassword } : {}),
      });
      updateCurrentUser(updatedUser);
      reset({
        name: updatedUser.name,
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
          <h2
            data-tour="settings-personal"
            className="font-medium text-slate-800 dark:text-slate-100"
          >
            Personal information
          </h2>
          {!isEditing && (
            <dl className="mt-3 text-sm">
              <div className="min-w-0">
                <dt className="text-slate-500 dark:text-slate-400">Name</dt>
                <dd className="break-words font-medium text-slate-800 dark:text-slate-200">
                  {user?.name ?? "Unavailable"}
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
              label="Current password (required to save changes)"
              htmlFor="profile-current-password"
              error={errors.currentPassword?.message}
            >
              <PasswordInput
                id="profile-current-password"
                autoComplete="current-password"
                {...register("currentPassword")}
              />
            </Field>
            <Field
              label="New password (leave blank to keep your current password)"
              htmlFor="profile-new-password"
              error={errors.newPassword?.message}
            >
              <PasswordInput
                id="profile-new-password"
                autoComplete="new-password"
                {...register("newPassword")}
              />
              <PasswordHelp
                password={newPasswordValue}
                email={user?.email}
                name={nameValue}
                fieldError={errors.newPassword?.message}
              />
            </Field>
            <Field
              label="Confirm new password"
              htmlFor="profile-confirm-password"
              error={errors.confirmNewPassword?.message}
            >
              <PasswordInput
                id="profile-confirm-password"
                autoComplete="new-password"
                {...register("confirmNewPassword")}
              />
            </Field>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Your current password confirms it’s you. Enter a new password only
            if you want to replace it.
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
      <EmailAddressSection />
    </Card>
  );
}

const emailChangeFormSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  currentPassword: z.string().min(1, "Enter your current password"),
});

type EmailChangeFormValues = z.infer<typeof emailChangeFormSchema>;
const EMAIL_CHANGE_FIELDS = ["email", "currentPassword"] as const;

function EmailAddressSection() {
  const { user, updateCurrentUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const resendCooldown = useCooldown(60);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EmailChangeFormValues>({
    resolver: zodResolver(emailChangeFormSchema),
    defaultValues: { email: "", currentPassword: "" },
  });

  const onSubmit = async (values: EmailChangeFormValues) => {
    setFormError(null);
    const currentEmail = user?.email;
    try {
      const updatedUser = await requestEmailChange(values);
      updateCurrentUser(updatedUser);
      reset({ email: "", currentPassword: "" });
      setIsEditing(false);
      toast.success(
        updatedUser.pendingEmail
          ? `Verification link sent to ${updatedUser.pendingEmail}`
          : updatedUser.email !== currentEmail
            ? "Email address updated"
            : "Email address unchanged",
      );
    } catch (error) {
      const parsed = parseApiError(error);
      if (Object.keys(parsed.fieldErrors).length === 0) {
        setFormError(parsed.message);
        return;
      }
      const unmatched = applyFieldErrors(
        parsed.fieldErrors,
        EMAIL_CHANGE_FIELDS,
        setError,
      );
      if (unmatched.length > 0) setFormError(unmatched.join(" "));
    }
  };

  const cancelEditing = () => {
    reset({ email: "", currentPassword: "" });
    setFormError(null);
    setIsEditing(false);
  };

  const resendPendingEmailChange = async () => {
    setIsResending(true);
    try {
      updateCurrentUser(await resendEmailChange());
      resendCooldown.start();
      toast.success("We sent a new link. The old one no longer works.");
    } catch (error) {
      toast.error(parseApiError(error).message);
    } finally {
      setIsResending(false);
    }
  };

  const cancelPendingEmailChange = async () => {
    setIsCanceling(true);
    try {
      updateCurrentUser(await cancelEmailChange());
      toast.success("Pending email change canceled");
    } catch (error) {
      toast.error(parseApiError(error).message);
    } finally {
      setIsCanceling(false);
    }
  };

  return (
    <section className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-700">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3
            data-tour="settings-email"
            className="text-sm font-medium text-slate-800 dark:text-slate-100"
          >
            Email address
          </h3>
          <p className="mt-1 break-all text-sm font-medium text-slate-800 dark:text-slate-200">
            {user?.email ?? "Unavailable"}
          </p>
          {user?.pendingEmail && (
            <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="break-all text-sm text-amber-700 dark:text-amber-300">
                Verification pending for {user.pendingEmail}. Your current email
                remains active until confirmed. Look in your spam or junk folder
                if the link hasn&apos;t arrived.
              </p>
              <ResendButton
                size="sm"
                secondsLeft={resendCooldown.left}
                onClick={() => void resendPendingEmailChange()}
                disabled={isResending}
                loading={isResending}
                className="w-fit shrink-0"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void cancelPendingEmailChange()}
                disabled={isCanceling}
                loading={isCanceling}
                className="w-fit shrink-0"
              >
                Cancel email change
              </Button>
            </div>
          )}
        </div>
        {!isEditing && user && (
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsEditing(true)}
              className="w-full sm:w-auto"
            >
              Change email
            </Button>
          </div>
        )}
      </div>

      {isEditing && (
        <div className="mt-4 space-y-3">
          <ErrorBanner message={formError} />
          <form
            onSubmit={(event) => void handleSubmit(onSubmit)(event)}
            noValidate
            className="grid gap-3 sm:grid-cols-2"
          >
            <Field
              label="New email"
              htmlFor="new-email"
              error={errors.email?.message}
            >
              <input
                id="new-email"
                type="email"
                autoComplete="email"
                {...register("email")}
                className={inputStyles}
              />
            </Field>
            <Field
              label="Current password"
              htmlFor="email-current-password"
              error={errors.currentPassword?.message}
            >
              <PasswordInput
                id="email-current-password"
                autoComplete="current-password"
                {...register("currentPassword")}
              />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
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
                {isSubmitting ? "Sending…" : "Send verification link"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </section>
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
  const { user: signedInUser, deleteAccount, isDeletingAccount } = useAuth();
  const queryClient = useQueryClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [dangerInfoOpen, setDangerInfoOpen] = useState(false);
  const dangerInfoId = useId();
  const canUpdateOrg = useCan("org:update");
  const canChangePlan = useCan("plan:change");

  const [formError, setFormError] = useState<string | null>(null);

  const { data: org, isPending, isError } = useOrgDetails(orgId);
  const restoreCheckOrgQuery = useOrgPlanRestoreCheck(orgId, canChangePlan);
  const restoreCheckedPlan = restoreCheckOrgQuery.data?.plan;
  const restoreCheckedExpiry = restoreCheckOrgQuery.data?.planExpiresAt;
  const archivedProjectsQuery = useProjects(
    orgId,
    { view: "archived" },
    canChangePlan,
  );
  const archivedTasksQuery = usePlanArchivedRestoreTasks(orgId, canChangePlan);
  useEffect(() => {
    if (!canChangePlan || !restoreCheckedPlan) return;
    void refreshRestoreCandidates(queryClient, orgId);
  }, [
    canChangePlan,
    orgId,
    queryClient,
    restoreCheckedPlan,
    restoreCheckedExpiry,
  ]);

  // A link from Messages lands on the chat history card.
  const { hash } = useLocation();
  useEffect(() => {
    if (!org) return;
    const targetId =
      hash === "#chat-history"
        ? "chat-history"
        : hash === "#plan"
          ? "plan"
          : null;
    if (!targetId) return;
    document.getElementById(targetId)?.scrollIntoView({ block: "start" });
  }, [hash, org]);
  const updateOrg = useUpdateOrg(orgId);
  const changePlan = useChangePlan(orgId);
  const planInfoId = useId();
  // A lower plan the person asked for while the paid one is still running.
  const [switchNotice, setSwitchNotice] = useState<Plan | null>(null);
  const [planInfoOpen, setPlanInfoOpen] = useState(false);
  const [payingFor, setPayingFor] = useState<Plan | null>(null);
  const [planReview, setPlanReview] = useState<Plan | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<Plan | null>(
    null,
  );
  const [quoteExpired, setQuoteExpired] = useState(false);
  const [impactChanged, setImpactChanged] = useState(false);
  const [reviewHelp, setReviewHelp] = useState<string | null>(null);
  const reviewHelpIds = {
    credit: useId(),
    upgrade: useId(),
    expiry: useId(),
    amount: useId(),
    downgrade: useId(),
    free: useId(),
    impact: useId(),
  };
  const [handledRestoreSignature, setHandledRestoreSignature] = useState(() =>
    readHandledRestoreSignature(orgId),
  );
  const [restorePromptRequested, setRestorePromptRequested] = useState(false);
  const [restoreInfoOpen, setRestoreInfoOpen] = useState(false);
  const restoreInfoId = useId();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const billing = useQuery({
    ...billingQuery(orgId),
    enabled: canChangePlan,
  });
  const openPlanReview = (plan: Plan) => {
    setImpactChanged(false);
    setQuoteExpired(false);
    setPlanReview(plan);
  };
  const paymentsOn = billing.data?.enabled === true;
  const testMode = billing.data?.keyId?.startsWith("rzp_test_") === true;
  const eligibleArchivedProjects = eligibleRestoreCandidates(
    archivedProjectsQuery.data?.projects ?? [],
  );
  const forceArchivedTasks = archivedTasksQuery.data ?? [];
  const restorePlanOrg = restoreCheckOrgQuery.data ?? org;
  const restorePromptSignature = restorePlanOrg
    ? getRestorePromptSignature(
        orgId,
        restorePlanOrg.plan,
        eligibleArchivedProjects,
        forceArchivedTasks,
      )
    : null;
  const restorePrompt = shouldRenderRestorePrompt(
    canChangePlan,
    restorePromptSignature,
    handledRestoreSignature,
    restorePromptRequested,
  );
  const canReopenRestore = canReviewRestoreCandidates(
    canChangePlan,
    restorePromptSignature,
  );
  const archivedByPlan = eligibleArchivedProjects;
  const closeRestorePrompt = () => {
    setRestorePromptRequested(false);
    if (!restorePromptSignature) return;
    persistHandledRestoreSignature(orgId, restorePromptSignature);
    setHandledRestoreSignature(restorePromptSignature);
  };

  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<OrganizationSettingsFormValues>({
    resolver: zodResolver(organizationSettingsFormSchema),
    values: org
      ? {
          name: org.name,
          timeZone: org.timeZone ?? "UTC",
          chatRetentionDays: (org.chatRetentionDays ?? null) as
            90 | 180 | 365 | null,
          currentPassword: "",
        }
      : undefined,
  });
  const chatRetentionValue =
    useWatch({ control, name: "chatRetentionDays" }) ?? null;

  // Changing the time zone asks first whether date-only due dates should
  // stay on the same calendar day or be left exactly as stored.
  const [timeZoneChoice, setTimeZoneChoice] =
    useState<OrganizationSettingsFormValues | null>(null);
  const [retentionConfirmation, setRetentionConfirmation] = useState<{
    values: OrganizationSettingsFormValues;
    moveDueDates?: boolean;
  } | null>(null);
  const [isEditingOrganization, setIsEditingOrganization] = useState(false);

  const cancelOrganizationEdit = () => {
    if (org) {
      reset({
        name: org.name,
        timeZone: org.timeZone ?? "UTC",
        chatRetentionDays: (org.chatRetentionDays ?? null) as
          90 | 180 | 365 | null,
        currentPassword: "",
      });
    }
    setFormError(null);
    setTimeZoneChoice(null);
    setRetentionConfirmation(null);
    setIsEditingOrganization(false);
  };

  const onOrganizationSettingsSubmit = async (
    values: OrganizationSettingsFormValues,
    moveDueDates?: boolean,
  ) => {
    setFormError(null);
    if (
      moveDueDates === undefined &&
      org &&
      values.timeZone !== (org.timeZone ?? "UTC")
    ) {
      setTimeZoneChoice(values);
      return;
    }
    if (
      org &&
      values.chatRetentionDays !== (org.chatRetentionDays ?? null) &&
      values.chatRetentionDays !== null
    ) {
      setTimeZoneChoice(null);
      setRetentionConfirmation({ values, moveDueDates });
      return;
    }
    await saveOrganizationSettings(values, moveDueDates);
  };

  async function saveOrganizationSettings(
    values: OrganizationSettingsFormValues,
    moveDueDates?: boolean,
  ) {
    try {
      await updateOrg.mutateAsync(
        moveDueDates === undefined ? values : { ...values, moveDueDates },
      );
      setValue("currentPassword", "");
      setTimeZoneChoice(null);
      setIsEditingOrganization(false);
      setRetentionConfirmation(null);
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
  }

  const handlePlanChange = async (newPlan: Plan) => {
    const name = PLAN_NAMES[newPlan];
    // A paid plan can't be left or cancelled before its end date: the period
    // is already paid for. Say so instead of calling the server.
    if (
      org &&
      org.plan !== "free" &&
      org.planExpiresAt &&
      new Date(org.planExpiresAt) > new Date() &&
      PLAN_ORDER.indexOf(newPlan) < PLAN_ORDER.indexOf(org.plan) &&
      planReview !== newPlan
    ) {
      openPlanReview(newPlan);
      return;
    }
    // Moving up, or renewing the current plan, costs money when payments are
    // on; moving down never does.
    if (paymentsOn && newPlan !== "free") {
      setPayingFor(newPlan);
      // Razorpay's window covers the screen once it opens, so in test mode the
      // card number is already on the clipboard, ready to paste.
      if (testMode) void copyTestCard();
      try {
        const result = await payForPlan(
          orgId,
          newPlan,
          cycle,
          {
            name: signedInUser?.name,
            email: signedInUser?.email,
          },
          billing.data?.quotes?.[newPlan]?.[cycle]?.quoteToken,
        );
        if (result.status === "dismissed" && result.reason) {
          const tryTestCard = testMode && /international/i.test(result.reason);
          toast.error("The payment didn't go through", {
            description: tryTestCard
              ? `${result.reason} Use the Indian test card in the box below.`
              : result.reason,
            action: tryTestCard
              ? {
                  label: "Copy test card",
                  onClick: () => void copyTestCard(),
                }
              : undefined,
          });
        }
        if (result.status === "paid") {
          setPlanReview(null);
          const scheduled =
            PLAN_ORDER.indexOf(newPlan) <
            PLAN_ORDER.indexOf(org?.plan ?? "free");
          toast.success(
            scheduled
              ? `Payment received. ${name} is scheduled for ${formatPlanDate(org?.planExpiresAt)}`
              : `Payment received. You're now on the ${name} plan`,
          );
          void queryClient.invalidateQueries({
            queryKey: orgKeys.detail(orgId),
          });
          void queryClient.invalidateQueries({
            queryKey: dashboardKeys.all(orgId),
          });
          void queryClient.invalidateQueries({
            queryKey: projectKeys.all(orgId),
          });
          void refreshRestoreCandidates(queryClient, orgId);
          void queryClient.invalidateQueries({
            queryKey: billingQuery(orgId).queryKey,
          });
        }
      } catch (error) {
        const parsed = parseApiError(error);
        if (parsed.code === "QUOTE_EXPIRED") setQuoteExpired(true);
        if (parsed.code === "USAGE_CHANGED") {
          setImpactChanged(true);
          await billing.refetch();
          return;
        }
        if (parsed.code === "PAYMENT_PROCESSING") {
          setPlanReview(null);
          toast.info("Payment verified; subscription update is processing", {
            description:
              "The plan change will appear in Settings once it finishes. Refresh Plans shortly.",
          });
          void billing.refetch();
          void queryClient.invalidateQueries({
            queryKey: orgKeys.detail(orgId),
          });
          return;
        }
        toast.error("The payment didn't go through", {
          description: parsed.message,
        });
      } finally {
        setPayingFor(null);
      }
      return;
    }
    if (newPlan === "free") {
      try {
        const fingerprint = billing.data?.impacts.free?.fingerprint;
        if (!fingerprint) {
          await billing.refetch();
          setImpactChanged(true);
          return;
        }
        await scheduleFreeDowngrade(orgId, fingerprint);
        setPlanReview(null);
        toast.success("Free is scheduled for your plan expiry");
        await billing.refetch();
        void queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) });
      } catch (error) {
        const parsed = parseApiError(error);
        if (parsed.code === "USAGE_CHANGED") {
          setImpactChanged(true);
          await billing.refetch();
          return;
        }
        toast.error(parsed.message);
      }
      return;
    }
    try {
      await changePlan.mutateAsync(newPlan);
      setPlanReview(null);
      toast.success(`You're now on the ${name} plan`);
      void refreshRestoreCandidates(queryClient, orgId);
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.code === "QUOTE_EXPIRED") setQuoteExpired(true);

      if (parsed.code === "PLAN_ACTIVE_UNTIL_END") {
        setSwitchNotice(newPlan);
        return;
      }

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
            `${detail.projectCount} active projects (${name} allows ${detail.targetProjectLimit})`,
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
  // " - Rs 449" on the buy button, using what this org would really pay.
  const upgradeLabel = (plan: Plan) => {
    if (!paymentsOn || plan === "free") return "";
    // Falls back to the list price while the personal quote is still loading,
    // so every buy button shows what it costs.
    const amount =
      billing.data?.quotes?.[plan]?.[cycle]?.amount ??
      PLAN_PRICE_PAISE[plan][cycle];
    if (amount === 0) return " · Covered by plan credit";
    return ` \u00B7 ${formatRupees(amount)}`;
  };
  const planEndsAt = org.planExpiresAt ? new Date(org.planExpiresAt) : null;
  const pendingPlan = changePlan.isPending ? changePlan.variables : null;
  const selectedQuote =
    planReview && planReview !== "free"
      ? billing.data?.quotes?.[planReview]?.[cycle]
      : null;
  const selectedImpact = planReview
    ? (billing.data?.impacts?.[planReview] ?? selectedQuote?.impact ?? null)
    : null;
  const premiumToProOverLimit =
    planReview === "pro" &&
    currentPlan === "premium" &&
    selectedImpact !== null &&
    !selectedImpact.withinLimits;
  const pendingChange = billing.data?.scheduledChange ?? null;
  const formatPlanDate = (value: string | Date | null | undefined) => {
    if (!value) return "No expiry date";
    return `${new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: org.timeZone ?? "UTC",
      timeZoneName: "short",
    }).format(new Date(value))} (${org.timeZone ?? "UTC"})`;
  };

  return (
    <div className="bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Settings
        </h1>

        <PersonalInformationCard />

        <Card>
          <h2
            data-tour="settings-organization"
            className="font-medium text-slate-800 dark:text-slate-100"
          >
            Organization settings
          </h2>

          {org && !isEditingOrganization ? (
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <dl className="grid gap-3 text-sm sm:grid-cols-3 sm:gap-8">
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Name</dt>
                  <dd className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">
                    {org.name}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">
                    Time zone
                  </dt>
                  <dd className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">
                    {org.timeZone ?? "UTC"}
                  </dd>
                </div>
                {org && (
                  <ChatRetentionCard
                    org={org}
                    canEdit={canUpdateOrg}
                    editing={false}
                    value={chatRetentionValue}
                    onChange={(value) =>
                      setValue("chatRetentionDays", value, {
                        shouldDirty: true,
                      })
                    }
                  />
                )}
              </dl>
              {canUpdateOrg && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setFormError(null);
                    setIsEditingOrganization(true);
                  }}
                  className="w-full sm:w-auto"
                >
                  Edit
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="mt-3">
                <ErrorBanner message={formError} />
              </div>
              <form
                onSubmit={(event) =>
                  void handleSubmit((values) =>
                    onOrganizationSettingsSubmit(values),
                  )(event)
                }
                noValidate
                className="mt-3 grid gap-3 sm:grid-cols-2"
              >
                <Field label="Name" htmlFor="name" error={errors.name?.message}>
                  <input
                    id="name"
                    type="text"
                    {...register("name")}
                    className={inputStyles}
                  />
                </Field>
                <Field
                  label="Time zone"
                  htmlFor="timeZone"
                  error={errors.timeZone?.message}
                >
                  <TimeZoneSelect control={control} disabled={false} />
                </Field>
                {org && (
                  <ChatRetentionCard
                    org={org}
                    canEdit={canUpdateOrg}
                    editing
                    value={chatRetentionValue}
                    onChange={(value) =>
                      setValue("chatRetentionDays", value, {
                        shouldDirty: true,
                      })
                    }
                  />
                )}
                <Field
                  label="Current password (required to save)"
                  htmlFor="org-current-password"
                  error={errors.currentPassword?.message}
                >
                  <PasswordInput
                    id="org-current-password"
                    autoComplete="current-password"
                    {...register("currentPassword")}
                    className={inputStyles}
                  />
                </Field>
                <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={cancelOrganizationEdit}
                    disabled={isSubmitting}
                    className="w-full sm:w-auto"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    loading={isSubmitting}
                    className="w-full sm:w-auto"
                  >
                    {isSubmitting ? "Saving…" : "Save"}
                  </Button>
                </div>
              </form>
            </>
          )}
        </Card>

        <Modal
          open={timeZoneChoice !== null}
          onClose={() => {
            if (!updateOrg.isPending) setTimeZoneChoice(null);
          }}
          title="Move due dates with the new time zone?"
        >
          <ErrorBanner message={formError} />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Due dates that are just a date (no time of day) are stored in the
            organization&apos;s time zone. Keep each on the same calendar day,
            or leave them as stored, which can show a different day to people in
            the new time zone. Due dates with a time are never changed.
          </p>
          {updateOrg.isPending && (
            <p
              className="mt-3 text-sm font-medium text-teal-700 dark:text-teal-300"
              aria-live="polite"
            >
              Saving organization settings…
            </p>
          )}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (!updateOrg.isPending) setTimeZoneChoice(null);
              }}
              disabled={updateOrg.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={updateOrg.isPending}
              onClick={() =>
                timeZoneChoice &&
                void onOrganizationSettingsSubmit(timeZoneChoice, false)
              }
            >
              Leave as stored
            </Button>
            <Button
              type="button"
              disabled={updateOrg.isPending}
              loading={updateOrg.isPending}
              onClick={() =>
                timeZoneChoice &&
                void onOrganizationSettingsSubmit(timeZoneChoice, true)
              }
            >
              Keep same days
            </Button>
          </div>
        </Modal>

        <Modal
          open={retentionConfirmation !== null}
          onClose={() => setRetentionConfirmation(null)}
          title="Delete old messages?"
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Messages and attached files older than{" "}
            {retentionConfirmation?.values.chatRetentionDays
              ? `${retentionConfirmation.values.chatRetentionDays} days`
              : "the selected retention period"}{" "}
            will be deleted for everyone, including existing messages. This
            cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => setRetentionConfirmation(null)}
              disabled={updateOrg.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={updateOrg.isPending}
              onClick={() =>
                retentionConfirmation &&
                void saveOrganizationSettings(
                  retentionConfirmation.values,
                  retentionConfirmation.moveDueDates,
                )
              }
            >
              Save and delete old messages
            </Button>
          </div>
        </Modal>

        <Card id="plan" className="scroll-mt-24">
          <div className="flex items-center justify-between">
            <h2
              data-tour="settings-plan"
              className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100"
            >
              Plan
              <InfoButton
                open={planInfoOpen}
                onToggle={() => setPlanInfoOpen((open) => !open)}
                label="About payments and plan changes"
                controls={planInfoId}
              />
            </h2>
            <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-sm font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
              {PLAN_NAMES[currentPlan]}
            </span>
          </div>

          <InfoPanel
            id={planInfoId}
            open={planInfoOpen}
            onClose={() => setPlanInfoOpen(false)}
          >
            {paymentsOn ? (
              <>
                <p>
                  Pay for a month or a year of Pro or Premium through Razorpay.
                  Nothing renews by itself: when the time is up the workspace
                  goes back to Free, and you can renew any time before that.
                  Going from Pro to Premium on the same billing period costs
                  only the remaining price difference. Changing monthly and
                  yearly cycles credits the unused value of the current plan.
                  The plan changes once the payment is confirmed.
                </p>
                <p className="mt-2">
                  Downgrades take effect when the paid period ends. Free is
                  scheduled at no cost; a lower paid plan must be paid in
                  advance. A pending change can be cancelled before that date.
                </p>
              </>
            ) : billing.data?.simulationAllowed ? (
              <>
                <p>
                  Payments are not switched on for this app, so upgrades are
                  simulated: the plan changes straight away and nothing is
                  charged.
                </p>
                <p className="mt-2">
                  Switching to a smaller plan is blocked while you use more
                  seats, projects or tasks than it allows. Only admins can
                  change the plan.
                </p>
              </>
            ) : (
              <p>
                Payments are not switched on for this app. Paid plans cannot be
                activated until a payment is verified; Free changes remain
                available.
              </p>
            )}
          </InfoPanel>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Seats</dt>
              <dd className="text-slate-700 dark:text-slate-300">
                {org.seatsUsed} / {org.seatLimit}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">
                Active projects
              </dt>
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

          {planEndsAt && (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              Your {PLAN_NAMES[currentPlan]} plan runs until{" "}
              {planEndsAt.toLocaleDateString(undefined, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              , then the workspace goes back to Free.
            </p>
          )}

          {paymentsOn && canChangePlan && (
            <div
              role="group"
              aria-label="Billing period"
              className="mt-4 inline-flex rounded-lg border border-slate-200 p-0.5 text-sm dark:border-slate-700"
            >
              {(["monthly", "yearly"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={cycle === option}
                  onClick={() => setCycle(option)}
                  className={cn(
                    "rounded-md px-3 py-1 font-medium",
                    cycle === option
                      ? "bg-teal-600 text-white"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                  )}
                >
                  {option === "monthly" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
          )}

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
                  {paymentsOn && (
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {plan === "free"
                        ? "Free"
                        : `${formatRupees(PLAN_PRICE_PAISE[plan][cycle])} ${
                            cycle === "yearly" ? "a year" : "a month"
                          }`}
                    </p>
                  )}
                  <ul className="mt-3 flex-1 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                    <li>{limits.seatLimit} seats</li>
                    <li>{limits.projectLimit} active projects</li>
                    <li>
                      {limits.activeTaskLimit === null
                        ? "Unlimited active tasks"
                        : `${limits.activeTaskLimit} active tasks per project`}
                    </li>
                  </ul>
                  {canChangePlan &&
                    isCurrent &&
                    paymentsOn &&
                    plan !== "free" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          pendingChange
                            ? setPendingReplacement(plan)
                            : openPlanReview(plan)
                        }
                        disabled={changePlan.isPending || payingFor !== null}
                        loading={payingFor === plan}
                        className="mt-4 w-full"
                      >
                        {`Renew${upgradeLabel(plan)}`}
                      </Button>
                    )}
                  {canChangePlan && !isCurrent && (
                    <Button
                      size="sm"
                      variant={isUpgrade ? "primary" : "secondary"}
                      onClick={() =>
                        pendingChange
                          ? setPendingReplacement(plan)
                          : openPlanReview(plan)
                      }
                      disabled={
                        changePlan.isPending ||
                        payingFor !== null ||
                        (plan !== "free" &&
                          !paymentsOn &&
                          !billing.data?.simulationAllowed)
                      }
                      loading={pendingPlan === plan || payingFor === plan}
                      className="mt-4 w-full"
                    >
                      {isUpgrade
                        ? `Upgrade to ${PLAN_NAMES[plan]}${upgradeLabel(plan)}`
                        : `Switch to ${PLAN_NAMES[plan]}`}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          {pendingChange && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
              <p className="font-medium text-slate-900 dark:text-slate-100">
                {PLAN_NAMES[pendingChange.plan]} is scheduled for{" "}
                {formatPlanDate(pendingChange.startsAt)}
                {pendingChange.billingCycle
                  ? ` · ${pendingChange.billingCycle}`
                  : ""}
              </p>
              {pendingChange.prepaid && pendingChange.expiresAt && (
                <p className="mt-1 text-slate-600 dark:text-slate-300">
                  Payment is verified. The prepaid plan expires{" "}
                  {formatPlanDate(pendingChange.expiresAt)}. Cancelling returns
                  the full payment to the original payment method.
                </p>
              )}
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={async () => {
                  try {
                    await cancelScheduledChange(orgId);
                    await billing.refetch();
                    void queryClient.invalidateQueries({
                      queryKey: orgKeys.detail(orgId),
                    });
                    toast.success(
                      pendingChange.prepaid
                        ? "Scheduled change cancelled and payment refunded"
                        : "Scheduled change cancelled",
                    );
                  } catch (error) {
                    toast.error(parseApiError(error).message);
                  }
                }}
              >
                Cancel Scheduled Change
              </Button>
            </div>
          )}

          {testMode && canChangePlan && <TestPaymentBox />}

          {canChangePlan && billing.data?.testControls && (
            <TestPlanDatesBox
              orgId={orgId}
              onFreePlan={currentPlan === "free"}
            />
          )}

          {!canChangePlan && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Only admins can change the plan.
            </p>
          )}
        </Card>

        <Modal
          open={planReview !== null}
          onClose={() => {
            if (payingFor === null && !changePlan.isPending)
              setPlanReview(null);
          }}
          title="Review subscription change"
          size="lg"
          placement="bottom"
          contentClassName="mt-3 flex flex-1 flex-col overflow-hidden sm:mt-4"
        >
          {planReview && (
            <div className="flex min-h-0 flex-1 flex-col text-sm">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pb-3 pr-1">
                <section
                  aria-label="Subscription dates"
                  className="grid gap-3 sm:grid-cols-2"
                >
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/60">
                    <h3 className="font-medium text-slate-800 dark:text-slate-100">
                      Current subscription
                    </h3>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">
                      {PLAN_NAMES[org.plan]}
                      {billing.data?.current?.billingCycle
                        ? ` · ${billing.data.current.billingCycle}`
                        : ""}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Expires {formatPlanDate(org.planExpiresAt)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-teal-50 p-3 dark:bg-teal-950/30">
                    <h3 className="font-medium text-slate-800 dark:text-slate-100">
                      Selected subscription
                    </h3>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">
                      {PLAN_NAMES[planReview]}
                      {planReview === "free" ? "" : ` · ${cycle}`}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {planReview === "free" ? "Effective " : "Starts "}
                      {formatPlanDate(
                        planReview === "free"
                          ? org.planExpiresAt
                          : (selectedQuote?.startsAt ?? new Date()),
                      )}
                    </p>
                    {planReview !== "free" && selectedQuote && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {PLAN_LIMITS[planReview].seatLimit} seats ·{" "}
                        {PLAN_LIMITS[planReview].projectLimit} active projects ·{" "}
                        {formatTaskLimit(
                          PLAN_LIMITS[planReview].activeTaskLimit,
                        )}{" "}
                        active tasks per project
                      </p>
                    )}
                    {planReview === "free" && (
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Pay today: ₹0. Current paid features remain active until
                        expiry.
                        <span className="block mt-1">
                          Free limits: 5 seats · 3 active projects · 10 active
                          tasks per project.
                        </span>
                        <InfoButton
                          open={reviewHelp === "free"}
                          onToggle={() =>
                            setReviewHelp(reviewHelp === "free" ? null : "free")
                          }
                          label="Free downgrade details"
                          controls={reviewHelpIds.free}
                        />
                        <InfoPanel
                          id={reviewHelpIds.free}
                          open={reviewHelp === "free"}
                          onClose={() => setReviewHelp(null)}
                        >
                          Free limits apply after expiry. The existing 10-day
                          grace period gives you time to reduce usage; extra
                          projects and tasks are archived after grace ends and
                          may be restored if they become eligible again. You can
                          cancel this scheduled change before it takes effect.
                        </InfoPanel>
                      </div>
                    )}
                    {planReview !== "free" && selectedQuote?.scheduled && (
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Pay the full {cycle} price now. Pro starts only after
                        payment is verified and at the current plan expiry.
                        <InfoButton
                          open={reviewHelp === "downgrade"}
                          onToggle={() =>
                            setReviewHelp(
                              reviewHelp === "downgrade" ? null : "downgrade",
                            )
                          }
                          label="About scheduling a paid downgrade"
                          controls={reviewHelpIds.downgrade}
                        />
                        <InfoPanel
                          id={reviewHelpIds.downgrade}
                          open={reviewHelp === "downgrade"}
                          onClose={() => setReviewHelp(null)}
                        >
                          Premium features remain available through the paid
                          expiry. Unused Premium time stays with Premium and is
                          not converted into Pro credit. If payment is not
                          verified, Pro is not scheduled; expiry then follows
                          the existing Free and grace-period rules. You can
                          cancel a verified prepaid schedule for a full refund
                          before it starts.
                        </InfoPanel>
                      </div>
                    )}
                    {selectedQuote && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        Expires {formatPlanDate(selectedQuote.expiresAt)}
                        <InfoButton
                          open={reviewHelp === "expiry"}
                          onToggle={() =>
                            setReviewHelp(
                              reviewHelp === "expiry" ? null : "expiry",
                            )
                          }
                          label="About the new expiry date"
                          controls={reviewHelpIds.expiry}
                        />
                      </p>
                    )}
                    {selectedQuote && (
                      <InfoPanel
                        id={reviewHelpIds.expiry}
                        open={reviewHelp === "expiry"}
                        onClose={() => setReviewHelp(null)}
                      >
                        Credit conversion can produce an expiry partway through
                        a billing period, so the date may differ from a standard
                        monthly or yearly term.
                      </InfoPanel>
                    )}
                  </div>
                </section>

                {planReview !== "free" && selectedQuote && (
                  <section aria-label="Price breakdown" className="space-y-2">
                    <h3 className="font-medium text-slate-800 dark:text-slate-100">
                      Price breakdown
                    </h3>
                    <dl className="space-y-2">
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-600 dark:text-slate-300">
                          New subscription price
                        </dt>
                        <dd>
                          {formatRupees(selectedQuote.originalPricePaise)}
                        </dd>
                      </div>
                      {selectedQuote.unusedCreditPaise > 0 && (
                        <div className="flex justify-between gap-3">
                          <dt className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                            Unused subscription credit
                            <InfoButton
                              open={reviewHelp === "credit"}
                              onToggle={() =>
                                setReviewHelp(
                                  reviewHelp === "credit" ? null : "credit",
                                )
                              }
                              label="About unused subscription credit"
                              controls={reviewHelpIds.credit}
                            />
                          </dt>
                          <dd>
                            −{formatRupees(selectedQuote.unusedCreditPaise)}
                          </dd>
                        </div>
                      )}
                      {selectedQuote.unusedCreditPaise > 0 && (
                        <InfoPanel
                          id={reviewHelpIds.credit}
                          open={reviewHelp === "credit"}
                          onClose={() => setReviewHelp(null)}
                        >
                          We value the unused portion of your prepaid plan using
                          the paid coverage dates and original subscription
                          value, then deduct it from this change.
                        </InfoPanel>
                      )}
                      {selectedQuote.proratedChargePaise !==
                        selectedQuote.amount && (
                        <div className="flex justify-between gap-3">
                          <dt className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                            Prorated upgrade charge
                            <InfoButton
                              open={reviewHelp === "upgrade"}
                              onToggle={() =>
                                setReviewHelp(
                                  reviewHelp === "upgrade" ? null : "upgrade",
                                )
                              }
                              label="About prorated upgrade charge"
                              controls={reviewHelpIds.upgrade}
                            />
                          </dt>
                          <dd>
                            {formatRupees(selectedQuote.proratedChargePaise)}
                          </dd>
                        </div>
                      )}
                      {selectedQuote.proratedChargePaise !==
                        selectedQuote.amount && (
                        <InfoPanel
                          id={reviewHelpIds.upgrade}
                          open={reviewHelp === "upgrade"}
                          onClose={() => setReviewHelp(null)}
                        >
                          This is the plan price difference for the unused part
                          of your current subscription period.
                        </InfoPanel>
                      )}
                      {selectedQuote.creditAppliedPaise > 0 && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-slate-600 dark:text-slate-300">
                            Credit applied
                          </dt>
                          <dd>
                            −{formatRupees(selectedQuote.creditAppliedPaise)}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-semibold dark:border-slate-700">
                        <dt className="flex items-center gap-1">
                          Pay today
                          <InfoButton
                            open={reviewHelp === "amount"}
                            onToggle={() =>
                              setReviewHelp(
                                reviewHelp === "amount" ? null : "amount",
                              )
                            }
                            label="About the amount payable today"
                            controls={reviewHelpIds.amount}
                          />
                        </dt>
                        <dd>
                          {selectedQuote.amount === 0
                            ? "₹0 · Covered by plan credit"
                            : formatRupees(selectedQuote.amount)}
                        </dd>
                      </div>
                    </dl>
                    <InfoPanel
                      id={reviewHelpIds.amount}
                      open={reviewHelp === "amount"}
                      onClose={() => setReviewHelp(null)}
                    >
                      The amount payable is the quoted subscription price after
                      any eligible credit or prorated upgrade adjustment.
                    </InfoPanel>
                    {selectedQuote.completePeriods > 1 && (
                      <p className="rounded-lg bg-slate-50 p-3 text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                        Your credit covers {selectedQuote.completePeriods}{" "}
                        complete billing periods
                        {selectedQuote.partialPeriodMs > 0
                          ? " plus additional partial coverage"
                          : ""}
                        . Prepaid through{" "}
                        {formatPlanDate(selectedQuote.expiresAt)}. No unused
                        credit is discarded.
                        {selectedQuote.partialPeriodMs > 0 &&
                          " The final remainder funds proportional additional time."}
                      </p>
                    )}
                    {quoteExpired && (
                      <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-slate-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-slate-200 sm:flex-row sm:items-center sm:justify-between">
                        <p>
                          The quote expired or your plan changed. Refresh the
                          breakdown before continuing.
                        </p>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            void billing
                              .refetch()
                              .then(() => setQuoteExpired(false));
                          }}
                        >
                          Refresh quote
                        </Button>
                      </div>
                    )}
                  </section>
                )}

                {selectedImpact &&
                  PLAN_ORDER.indexOf(planReview) < currentRank && (
                    <section
                      aria-label="Plan limit impact"
                      aria-live="polite"
                      className={`rounded-lg border p-3 ${
                        selectedImpact.withinLimits
                          ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                          : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-1 font-medium">
                        {selectedImpact.withinLimits
                          ? `Current usage fits the ${PLAN_NAMES[planReview]} plan limits`
                          : `Review usage above the ${PLAN_NAMES[planReview]} plan limits`}
                        <InfoButton
                          open={reviewHelp === "impact"}
                          onToggle={() =>
                            setReviewHelp(
                              reviewHelp === "impact" ? null : "impact",
                            )
                          }
                          label="How downgrade limits affect this workspace"
                          controls={reviewHelpIds.impact}
                        />
                      </div>
                      <p className="mt-1 text-xs opacity-80">
                        Snapshot {formatPlanDate(selectedImpact.capturedAt)}.
                        Usage may change before the effective date.
                      </p>
                      <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                        <li>
                          Members: {selectedImpact.seats.used} /{" "}
                          {selectedImpact.seats.limit} allowed
                        </li>
                        <li>
                          Active projects: {selectedImpact.projects.active} /{" "}
                          {selectedImpact.projects.limit} allowed
                        </li>
                        <li className="sm:col-span-2">
                          {selectedImpact.tasks.limit === null
                            ? "Active tasks: no per-project limit"
                            : selectedImpact.tasks.exceededProjectCount > 0
                              ? `${selectedImpact.tasks.exceededProjectCount} active ${selectedImpact.tasks.exceededProjectCount === 1 ? "project exceeds" : "projects exceed"} ${selectedImpact.tasks.limit} open tasks per project`
                              : `Open tasks: no active project exceeds ${selectedImpact.tasks.limit} per project`}
                        </li>
                      </ul>
                      {premiumToProOverLimit && (
                        <div className="mt-3 rounded-md border border-amber-300 bg-white/70 p-3 dark:border-amber-800 dark:bg-slate-950/40">
                          <h4 className="font-semibold">
                            Your Pro subscription may start later
                          </h4>
                          <p className="mt-1 text-sm leading-relaxed">
                            Your organization currently exceeds Pro limits. If
                            it still exceeds those limits when Premium expires,
                            your workspace will temporarily move to Free.
                            Free&apos;s 10-day grace period and automatic
                            archiving rules may apply. Your prepaid Pro
                            subscription will remain available and its paid
                            period will begin once your organization meets Pro
                            limits.
                          </p>
                        </div>
                      )}
                      {selectedImpact.tasks.overages.length > 0 && (
                        <details className="mt-2 text-sm">
                          <summary className="cursor-pointer font-medium underline underline-offset-2">
                            Show affected projects (
                            {selectedImpact.tasks.overages.length})
                          </summary>
                          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto break-words pl-4">
                            {selectedImpact.tasks.overages.map((overage) => (
                              <li key={overage.projectId}>
                                {overage.projectName}: {overage.activeCount} /{" "}
                                {overage.limit} allowed
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <InfoPanel
                        id={reviewHelpIds.impact}
                        open={reviewHelp === "impact"}
                        onClose={() => setReviewHelp(null)}
                      >
                        {premiumToProOverLimit ? (
                          <>
                            <p>
                              This server snapshot counts organization members,
                              active projects, and open tasks (not done,
                              archived, or binned) in active projects. Premium
                              access continues until{" "}
                              {formatPlanDate(org.planExpiresAt)}. A paid
                              downgrade does not itself archive or delete
                              resources.
                            </p>
                            <p className="mt-2">
                              Pro activates only when members, active projects,
                              and every project&apos;s open tasks fit Pro
                              limits. If they do not fit when Premium expires,
                              the existing expiry flow moves the organization to
                              Free. Its 10-day grace starts at that expiry; when
                              grace ends, excess active projects and open tasks
                              are archived by the existing Free enforcement.
                              Members are never automatically removed and
                              resources are not deleted.
                            </p>
                            <p className="mt-2">
                              The verified Pro payment stays pending. Activation
                              is retried after usage changes and by the
                              lifecycle job; the full paid monthly or yearly
                              period begins only when Pro activates. Eligible
                              items archived by plan limits can be reviewed for
                              restoration after usage fits the active plan.
                              Project restoration restores eligible tasks while
                              capacity remains; tasks that do not fit stay
                              archived. Manually archived items are not
                              included.
                            </p>
                          </>
                        ) : (
                          <>
                            This is a server calculated snapshot using current
                            organization member and active project counts, plus
                            open tasks in active projects. Premium benefits
                            continue until {formatPlanDate(org.planExpiresAt)}.
                            At a paid downgrade, existing resources are not
                            deleted or automatically archived. If usage is over
                            Pro limits when Pro activates, the workspace is
                            paused for changes except deleting or archiving
                            resources and billing or plan actions until it fits.
                            If a verified prepaid Pro schedule is still over
                            limits at expiry, the existing expiry flow moves the
                            workspace to Free and its normal 10-day grace and
                            archiving rules apply; the paid Pro term remains
                            pending and starts when usage fits and it activates.
                            For Free, existing Free expiry and grace rules
                            archive excess active projects and open tasks after
                            10 days; members are never removed automatically.
                            Nothing is deleted.
                          </>
                        )}
                      </InfoPanel>
                    </section>
                  )}

                {impactChanged && (
                  <p
                    role="status"
                    className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
                  >
                    Workspace usage changed. The impact above has been
                    refreshed; review it before continuing.
                  </p>
                )}

                {planReview !== "free" && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Payment is one-time. WorkNest does not automatically renew
                    plans. Dates use your organization time zone (
                    {org.timeZone ?? "UTC"}).
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white pt-3 dark:border-slate-700 dark:bg-slate-800 sm:flex-row sm:justify-end sm:pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setPlanReview(null)}
                  disabled={
                    payingFor !== null || changePlan.isPending || quoteExpired
                  }
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    const plan = planReview;
                    if (plan) void handlePlanChange(plan);
                  }}
                  disabled={payingFor !== null || changePlan.isPending}
                >
                  {planReview === "free"
                    ? "Schedule Downgrade"
                    : selectedQuote?.scheduled
                      ? "Continue to Payment"
                      : selectedQuote?.amount === 0
                        ? "Confirm Change"
                        : paymentsOn
                          ? "Continue to Payment"
                          : "Confirm Change"}
                </Button>
              </div>
            </div>
          )}
        </Modal>

        <Modal
          open={pendingReplacement !== null && pendingChange !== null}
          onClose={() => setPendingReplacement(null)}
          title="Change the scheduled plan?"
        >
          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            This will cancel the pending{" "}
            {PLAN_NAMES[pendingChange?.plan ?? "free"]} change before reviewing{" "}
            {PLAN_NAMES[pendingReplacement ?? "free"]}.
            {pendingChange?.prepaid
              ? " The advance payment will be fully refunded to the original payment method before the new change is reviewed."
              : " No payment is involved in the current schedule."}
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setPendingReplacement(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const replacement = pendingReplacement;
                try {
                  await cancelScheduledChange(orgId);
                  await billing.refetch();
                  void queryClient.invalidateQueries({
                    queryKey: orgKeys.detail(orgId),
                  });
                  setPendingReplacement(null);
                  if (replacement) openPlanReview(replacement);
                  toast.success(
                    "Scheduled change cancelled. Review the new selection.",
                  );
                } catch (error) {
                  toast.error(parseApiError(error).message);
                }
              }}
            >
              Cancel Schedule and Continue
            </Button>
          </div>
        </Modal>

        {canReopenRestore && (
          <Card>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                Archived after plan changes
              </h2>
              <InfoButton
                open={restoreInfoOpen}
                onToggle={() => setRestoreInfoOpen((open) => !open)}
                label="About items archived after plan changes"
                controls={restoreInfoId}
              />
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Review items archived when your plan changed.
            </p>
            <InfoPanel
              id={restoreInfoId}
              open={restoreInfoOpen}
              onClose={() => setRestoreInfoOpen(false)}
            >
              Items over your previous plan limits were archived automatically.
              Eligible projects and tasks can be restored if your current plan
              has room.
            </InfoPanel>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {formatRestoreCandidateCount(
                archivedByPlan.length,
                forceArchivedTasks.length,
              )}
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-4 w-full sm:w-auto"
              onClick={() => setRestorePromptRequested(true)}
            >
              Review archived projects and tasks
            </Button>
          </Card>
        )}

        {restorePrompt && (
          <RestoreProjectsPrompt
            key={restorePromptSignature}
            orgId={orgId}
            projects={archivedByPlan}
            tasks={forceArchivedTasks}
            onClose={closeRestorePrompt}
          />
        )}

        {org && switchNotice && (
          <Modal
            open
            onClose={() => setSwitchNotice(null)}
            title={
              switchNotice === "free"
                ? "Your plan stays active"
                : `Switch to ${PLAN_NAMES[switchNotice]} later`
            }
          >
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {switchNotice === "free"
                ? "Your current paid plan will remain active until it ends. You\u2019ll automatically switch to Free when it expires."
                : `You can switch to ${PLAN_NAMES[switchNotice]} after your current ${PLAN_NAMES[org.plan]} plan ends.`}
            </p>
            {org.planExpiresAt && (
              <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-700/50 dark:text-slate-300">
                Your {PLAN_NAMES[org.plan]} plan ends on{" "}
                <span className="font-medium text-slate-900 dark:text-slate-50">
                  {new Date(org.planExpiresAt).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                .
              </p>
            )}
            <Button
              className="mt-5 w-full sm:ml-auto sm:flex sm:w-auto"
              onClick={() => setSwitchNotice(null)}
            >
              Got it
            </Button>
          </Modal>
        )}

        <SessionsCard />

        {org && <LeaveOrganizationCard orgId={orgId} orgName={org.name} />}

        <Card className="border-red-200 dark:border-red-900/40">
          <h2 className="flex items-center gap-2 font-medium text-red-700 dark:text-red-400">
            Danger zone
            <InfoButton
              open={dangerInfoOpen}
              onToggle={() => setDangerInfoOpen((open) => !open)}
              label="About deleting your account"
              controls={dangerInfoId}
            />
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Delete your account and leave every workspace you belong to.
          </p>
          <InfoPanel
            id={dangerInfoId}
            open={dangerInfoOpen}
            onClose={() => setDangerInfoOpen(false)}
          >
            You&apos;ll be signed out, and your email is freed so you can sign
            up or accept an invite again later. If you&apos;re the only admin of
            a workspace with other people in it, make someone else an admin
            first. A workspace where you&apos;re the only member is deleted
            along with its projects and tasks.
          </InfoPanel>

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

function formatRestoreCandidateCount(projects: number, tasks: number): string {
  const parts: string[] = [];
  if (projects > 0)
    parts.push(`${projects} project${projects === 1 ? "" : "s"}`);
  if (tasks > 0) parts.push(`${tasks} task${tasks === 1 ? "" : "s"}`);
  return `${parts.join(" and ")} can be reviewed for restoration.`;
}
