import { apiClient } from "@/api/client";

export type Rsvp = "pending" | "accepted" | "tentative" | "declined";

export interface Attendee {
  userId: string;
  name: string;
  email: string;
  response: Rsvp;
  respondedAt: string | null;
}

export type Recurrence = "daily" | "weekly" | "monthly";
export type Scope = "this" | "all";

export interface Proposal {
  userId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  note: string;
  createdAt: string;
}

export interface Meeting {
  id: string;
  title: string;
  agenda: string;
  notes: string;
  startsAt: string;
  endsAt: string;
  joinUrl: string | null;
  location: string;
  cancelledAt: string | null;
  series: {
    id: string;
    index: number | null;
    count: number | null;
    frequency: Recurrence | null;
  } | null;
  link: {
    projectId: string | null;
    projectName: string | null;
    taskId: string | null;
    // Empty when the task isn't one you're allowed to see.
    taskTitle: string | null;
  } | null;
  proposals: Proposal[];
  organizer: { id: string; name: string };
  isOrganizer: boolean;
  myResponse: Rsvp | null;
  attendees: Attendee[];
  createdAt: string;
  updatedAt: string;
}

export interface MeetingSummary {
  pendingInvites: number;
  next: { id: string; title: string; startsAt: string; endsAt: string } | null;
}

export interface MeetingInput {
  title: string;
  agenda: string;
  startsAt: string;
  endsAt: string;
  joinUrl: string;
  location: string;
  attendeeIds: string[];
  projectId: string | null;
  taskId: string | null;
  // Every date of a repeating meeting, worked out in the browser so it
  // follows the person's own calendar.
  repeat?: { freq: Recurrence; starts: string[] };
}

const base = (orgId: string) => `/orgs/${orgId}/meetings`;

export async function listMeetings(
  orgId: string,
  params: {
    view: "upcoming" | "past" | "range";
    from?: string;
    to?: string;
    projectId?: string;
    taskId?: string;
  },
) {
  const response = await apiClient.get<{ meetings: Meeting[] }>(base(orgId), {
    params,
  });
  return response.data.meetings;
}

export async function getMeeting(orgId: string, meetingId: string) {
  const response = await apiClient.get<{ meeting: Meeting }>(
    `${base(orgId)}/${meetingId}`,
  );
  return response.data.meeting;
}

export async function getMeetingSummary(orgId: string) {
  const response = await apiClient.get<MeetingSummary>(
    `${base(orgId)}/summary`,
  );
  return response.data;
}

export async function createMeeting(orgId: string, input: MeetingInput) {
  const response = await apiClient.post<{ meeting: Meeting }>(
    base(orgId),
    input,
  );
  return response.data.meeting;
}

export async function updateMeeting(
  orgId: string,
  meetingId: string,
  input: Partial<Omit<MeetingInput, "repeat">> & {
    notes?: string;
    scope?: Scope;
  },
) {
  const response = await apiClient.patch<{ meeting: Meeting }>(
    `${base(orgId)}/${meetingId}`,
    input,
  );
  return response.data.meeting;
}

export async function cancelMeeting(
  orgId: string,
  meetingId: string,
  scope: Scope = "this",
) {
  const response = await apiClient.post<{ meeting: Meeting }>(
    `${base(orgId)}/${meetingId}/cancel`,
    { scope },
  );
  return response.data.meeting;
}

export async function respondToMeeting(
  orgId: string,
  meetingId: string,
  response: Exclude<Rsvp, "pending">,
  scope: Scope = "this",
) {
  const result = await apiClient.put<{ meeting: Meeting }>(
    `${base(orgId)}/${meetingId}/response`,
    { response, scope },
  );
  return result.data.meeting;
}

export async function proposeMeetingTime(
  orgId: string,
  meetingId: string,
  input: { startsAt: string; endsAt: string; note?: string },
) {
  const response = await apiClient.post<{ meeting: Meeting }>(
    `${base(orgId)}/${meetingId}/proposals`,
    input,
  );
  return response.data.meeting;
}

export async function acceptMeetingProposal(
  orgId: string,
  meetingId: string,
  userId: string,
) {
  const response = await apiClient.post<{ meeting: Meeting }>(
    `${base(orgId)}/${meetingId}/proposals/${userId}/accept`,
  );
  return response.data.meeting;
}

export async function dismissMeetingProposal(
  orgId: string,
  meetingId: string,
  userId: string,
) {
  const response = await apiClient.delete<{ meeting: Meeting }>(
    `${base(orgId)}/${meetingId}/proposals/${userId}`,
  );
  return response.data.meeting;
}

// Upcoming meetings you can see that are linked to a task or a project.
export async function listLinkedMeetings(
  orgId: string,
  link: { taskId?: string; projectId?: string },
) {
  return listMeetings(orgId, { view: "upcoming", ...link });
}
