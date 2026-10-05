import { useOrg } from "@/hooks/useOrg";
import { useOrgDetails } from "@/features/org/queries";

export const PAUSED_HINT =
  "This account is over its plan limits. Remove the extra work or upgrade to continue.";

// True while the organization uses more than its plan allows and has no
// grace period left. The server
// refuses changes then; this lets buttons say so before anyone tries.
export function useAccountPaused(): boolean {
  const { orgId } = useOrg();
  return useOrgDetails(orgId).data?.usage?.paused === true;
}

export const GROWTH_BLOCKED_HINT =
  "This workspace is over the Free plan limits, so nothing new can be added. Archive or delete the extras, or renew your plan.";

// True when nothing new can be added: over the plan during the grace period
// (or while the archiving that ends it is due), or paused. Editing, finishing,
// archiving and deleting still work.
export function useGrowthBlocked(): boolean {
  const { orgId } = useOrg();
  const usage = useOrgDetails(orgId).data?.usage;
  return usage?.restricted === true || usage?.paused === true;
}
