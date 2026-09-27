import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orgKeys } from "@/features/org/queries";
import {
  createInvite,
  listInvites,
  revokeInvite,
  type CreateInviteInput,
} from "./api";

export const inviteKeys = {
  all: (orgId: string) => ["orgs", orgId, "invites"] as const,
};

export function useInvites(orgId: string) {
  return useQuery({
    queryKey: inviteKeys.all(orgId),
    queryFn: () => listInvites(orgId),
  });
}

export function useCreateInvite(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateInviteInput) => createInvite(orgId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inviteKeys.all(orgId) });
      void queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) });
    },
  });
}

export function useRevokeInvite(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (inviteId: string) => revokeInvite(orgId, inviteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inviteKeys.all(orgId) });
      void queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) });
    },
  });
}
