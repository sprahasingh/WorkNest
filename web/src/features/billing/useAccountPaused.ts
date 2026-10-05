import { useOrg } from "@/hooks/useOrg";
import { useOrgDetails } from "@/features/org/queries";

export const PAUSED_HINT =
  "This account is over its plan limits. Remove the extra work or upgrade to continue.";

// True while the organization uses more than its plan allows. The server
// refuses changes then; this lets buttons say so before anyone tries.
export function useAccountPaused(): boolean {
  const { orgId } = useOrg();
  return useOrgDetails(orgId).data?.usage?.overLimit === true;
}
