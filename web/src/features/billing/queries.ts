import { queryOptions } from "@tanstack/react-query";
import { getBillingConfig } from "./api";

export const billingQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["org", orgId, "billing"],
    queryFn: () => getBillingConfig(orgId),
    staleTime: 60 * 1000,
  });
