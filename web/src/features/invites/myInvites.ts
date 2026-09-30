import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { acceptMyInvite, declineMyInvite, listMyInvites } from "@/api/invites";
import { useAuth } from "@/auth/auth-context";

export const myInviteKeys = {
  all: ["me", "invites"] as const,
};

// Invitations waiting for the signed-in user, from any organization.
export function useMyInvites(enabled = true) {
  return useQuery({
    queryKey: myInviteKeys.all,
    queryFn: listMyInvites,
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useAcceptMyInvite() {
  const queryClient = useQueryClient();
  const { refreshMemberships } = useAuth();

  return useMutation({
    mutationFn: (inviteId: string) => acceptMyInvite(inviteId),
    onSuccess: async () => {
      await refreshMemberships();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: myInviteKeys.all });
    },
  });
}

export function useDeclineMyInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (inviteId: string) => declineMyInvite(inviteId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: myInviteKeys.all });
    },
  });
}
