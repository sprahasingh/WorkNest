import type { MeetingChoice } from "./api";

// What the person doing the removal picked for the meetings being left
// behind. "handover" isn't valid until someone has been chosen.
export interface MeetingChoiceState {
  action: "cancel" | "handover";
  userId: string;
}

export const DEFAULT_MEETING_CHOICE: MeetingChoiceState = {
  action: "cancel",
  userId: "",
};

export function isMeetingChoiceReady(state: MeetingChoiceState): boolean {
  return state.action === "cancel" || state.userId !== "";
}

export function toMeetingChoice(state: MeetingChoiceState): MeetingChoice {
  return state.action === "handover"
    ? { action: "handover", userId: state.userId }
    : { action: "cancel" };
}
