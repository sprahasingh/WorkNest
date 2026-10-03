import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationKeys } from "@/features/notifications/queries";
import { listTasks } from "@/features/tasks/api";
import {
  acceptMeetingProposal,
  cancelMeeting,
  createMeeting,
  dismissMeetingProposal,
  getMeeting,
  getMeetingSummary,
  listMeetings,
  proposeMeetingTime,
  respondToMeeting,
  updateMeeting,
  type Meeting,
  type MeetingInput,
  type Rsvp,
  type Scope,
} from "./api";

const SUMMARY_POLL_MS = 60_000;
const LIST_POLL_MS = 60_000;

export const meetingKeys = {
  all: (orgId: string) => ["orgs", orgId, "meetings"] as const,
  list: (orgId: string, view: "upcoming" | "past") =>
    [...meetingKeys.all(orgId), "list", view] as const,
  range: (orgId: string, from: string, to: string) =>
    [...meetingKeys.all(orgId), "range", from, to] as const,
  detail: (orgId: string, meetingId: string) =>
    [...meetingKeys.all(orgId), "detail", meetingId] as const,
  summary: (orgId: string) => [...meetingKeys.all(orgId), "summary"] as const,
};

export interface MeetingFilter {
  projectId?: string;
  taskId?: string;
}

export function useMeetings(
  orgId: string,
  view: "upcoming" | "past",
  filter: MeetingFilter = {},
) {
  return useQuery({
    queryKey: [...meetingKeys.list(orgId, view), filter] as const,
    queryFn: () => listMeetings(orgId, { view, ...filter }),
    refetchInterval: LIST_POLL_MS,
  });
}

// Active tasks of a project, for choosing what a meeting is about.
export function useProjectTaskOptions(orgId: string, projectId: string | null) {
  return useQuery({
    queryKey: ["orgs", orgId, "meetings", "task-options", projectId],
    queryFn: () => listTasks(orgId, projectId!, { view: "active", limit: 100 }),
    enabled: projectId !== null,
    select: (data) => data.items,
  });
}

export function useMeetingsInRange(orgId: string, from: Date, to: Date) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return useQuery({
    queryKey: meetingKeys.range(orgId, fromIso, toIso),
    queryFn: () =>
      listMeetings(orgId, { view: "range", from: fromIso, to: toIso }),
    refetchInterval: LIST_POLL_MS,
  });
}

export function useMeeting(orgId: string, meetingId: string | null) {
  return useQuery({
    queryKey: meetingKeys.detail(orgId, meetingId ?? ""),
    queryFn: () => getMeeting(orgId, meetingId!),
    enabled: meetingId !== null,
    retry: false,
  });
}

export function useMeetingSummary(orgId: string) {
  return useQuery({
    queryKey: meetingKeys.summary(orgId),
    queryFn: () => getMeetingSummary(orgId),
    refetchInterval: SUMMARY_POLL_MS,
  });
}

function useAfterChange(orgId: string) {
  const queryClient = useQueryClient();
  return (meeting?: Meeting) => {
    if (meeting) {
      queryClient.setQueryData(meetingKeys.detail(orgId, meeting.id), meeting);
    }
    void queryClient.invalidateQueries({ queryKey: meetingKeys.all(orgId) });
    void queryClient.invalidateQueries({
      queryKey: notificationKeys.all(orgId),
    });
  };
}

export function useCreateMeeting(orgId: string) {
  const afterChange = useAfterChange(orgId);
  return useMutation({
    mutationFn: (input: MeetingInput) => createMeeting(orgId, input),
    onSuccess: afterChange,
  });
}

export function useUpdateMeeting(orgId: string, meetingId: string) {
  const afterChange = useAfterChange(orgId);
  return useMutation({
    mutationFn: (
      input: Partial<Omit<MeetingInput, "repeat">> & {
        notes?: string;
        scope?: Scope;
      },
    ) => updateMeeting(orgId, meetingId, input),
    onSuccess: afterChange,
  });
}

export function useCancelMeeting(orgId: string) {
  const afterChange = useAfterChange(orgId);
  return useMutation({
    mutationFn: ({ meetingId, scope }: { meetingId: string; scope: Scope }) =>
      cancelMeeting(orgId, meetingId, scope),
    onSuccess: afterChange,
  });
}

export function useRespondToMeeting(orgId: string) {
  const afterChange = useAfterChange(orgId);
  return useMutation({
    mutationFn: ({
      meetingId,
      response,
      scope,
    }: {
      meetingId: string;
      response: Exclude<Rsvp, "pending">;
      scope?: Scope;
    }) => respondToMeeting(orgId, meetingId, response, scope),
    onSuccess: afterChange,
  });
}

export function useProposeTime(orgId: string, meetingId: string) {
  const afterChange = useAfterChange(orgId);
  return useMutation({
    mutationFn: (input: { startsAt: string; endsAt: string; note?: string }) =>
      proposeMeetingTime(orgId, meetingId, input),
    onSuccess: afterChange,
  });
}

export function useProposalActions(orgId: string, meetingId: string) {
  const afterChange = useAfterChange(orgId);
  return {
    accept: useMutation({
      mutationFn: (userId: string) =>
        acceptMeetingProposal(orgId, meetingId, userId),
      onSuccess: afterChange,
    }),
    dismiss: useMutation({
      mutationFn: (userId: string) =>
        dismissMeetingProposal(orgId, meetingId, userId),
      onSuccess: afterChange,
    }),
  };
}
