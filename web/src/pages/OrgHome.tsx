import { useOrg } from "@/hooks/useOrg";

/**
 * Temporary placeholder for the org-scoped landing area. Replaced by the
 * real dashboard and layout once those are built.
 */
export function OrgHome() {
  const { orgName, role } = useOrg();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <p className="text-lg text-slate-700">
        You&apos;re viewing <span className="font-semibold">{orgName}</span>{" "}
        as <span className="font-mono">{role}</span>
      </p>
    </div>
  );
}
