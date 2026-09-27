import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@/api/auth";
import { changeMemberRole, listMembers, removeMember } from "./api";

export const memberKeys = {
  all: (orgId: string) => ["orgs", orgId, "members"] as const,
};

export function useMembers(orgId: string) {
  return useQuery({
    queryKey: memberKeys.all(orgId),
    queryFn: () => listMembers(orgId),
  });
}

export function useChangeMemberRole(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: Role }) =>
      changeMemberRole(orgId, memberId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(orgId) });
    },
  });
}

export function useRemoveMember(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberId: string) => removeMember(orgId, memberId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(orgId) });
    },
  });
}
