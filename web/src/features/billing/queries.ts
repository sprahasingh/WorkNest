import { queryOptions } from "@tanstack/react-query";
import { orgKeys } from "@/features/org/queries";
import { getBillingConfig } from "./api";

export const billingQuery = (orgId: string) =>
  queryOptions({
    queryKey: orgKeys.billing(orgId),
    queryFn: () => getBillingConfig(orgId),
    staleTime: 60 * 1000,
  });
