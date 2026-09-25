import { useQuery } from "@tanstack/react-query";
import { listMembers } from "./api";

export function useMembers(orgId: string) {
  return useQuery({
    queryKey: ["orgs", orgId, "members"],
    queryFn: () => listMembers(orgId),
  });
}
