import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@/api/auth";
import { dashboardKeys } from "@/features/dashboard/queries";
import { orgKeys } from "@/features/org/queries";
import {
  changeMemberRole,
  getMeetingImpact,
  listMembers,
  removeMember,
  type MeetingChoice,
} from "./api";

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
    mutationFn: ({
      memberId,
      meetings,
    }: {
      memberId: string;
      meetings?: MeetingChoice;
    }) => removeMember(orgId, memberId, meetings),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(orgId) });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.all(orgId),
      });
      void queryClient.invalidateQueries({
        queryKey: orgKeys.detail(orgId),
      });
    },
  });
}

// How many upcoming meetings someone organizes, asked before they're removed.
export function useMeetingImpact(orgId: string, memberId: string | null) {
  return useQuery({
    queryKey: [...memberKeys.all(orgId), "meeting-impact", memberId],
    queryFn: () => getMeetingImpact(orgId, memberId!),
    enabled: memberId !== null,
    staleTime: 0,
    gcTime: 0,
  });
}
