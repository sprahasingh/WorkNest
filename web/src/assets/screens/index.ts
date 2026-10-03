// Product screenshots used on the landing page and in the guide. Each one has
// a light and a dark version, and the page shows whichever matches the theme.
// They're taken from a demo organization (Brightline), not real data.
import auditDark from "./audit-dark.webp";
import auditLight from "./audit-light.webp";
import boardDark from "./board-dark.webp";
import boardLight from "./board-light.webp";
import dashboardDark from "./dashboard-dark.webp";
import dashboardLight from "./dashboard-light.webp";
import mBoardDark from "./m-board-dark.webp";
import mBoardLight from "./m-board-light.webp";
import mDashboardDark from "./m-dashboard-dark.webp";
import mDashboardLight from "./m-dashboard-light.webp";
import mMeetingsDark from "./m-meetings-dark.webp";
import mMeetingsLight from "./m-meetings-light.webp";
import mMessagesDark from "./m-messages-dark.webp";
import mMessagesLight from "./m-messages-light.webp";
import meetingsDark from "./meetings-dark.webp";
import meetingsLight from "./meetings-light.webp";
import membersDark from "./members-dark.webp";
import membersLight from "./members-light.webp";
import messagesDark from "./messages-dark.webp";
import messagesLight from "./messages-light.webp";
import projectsDark from "./projects-dark.webp";
import projectsLight from "./projects-light.webp";
import taskUpdatesDark from "./task-updates-dark.webp";
import taskUpdatesLight from "./task-updates-light.webp";

export interface Screen {
  light: string;
  dark: string;
  width: number;
  height: number;
}

const desktop = { width: 1280, height: 800 };
const tall = { width: 1280, height: 900 };
const phone = { width: 390, height: 844 };

export const SCREENS = {
  dashboard: { light: dashboardLight, dark: dashboardDark, ...tall },
  projects: { light: projectsLight, dark: projectsDark, ...desktop },
  board: { light: boardLight, dark: boardDark, ...desktop },
  taskUpdates: { light: taskUpdatesLight, dark: taskUpdatesDark, ...desktop },
  messages: { light: messagesLight, dark: messagesDark, ...desktop },
  meetings: { light: meetingsLight, dark: meetingsDark, ...tall },
  members: { light: membersLight, dark: membersDark, ...desktop },
  audit: { light: auditLight, dark: auditDark, ...desktop },
  phoneMessages: { light: mMessagesLight, dark: mMessagesDark, ...phone },
  phoneMeetings: { light: mMeetingsLight, dark: mMeetingsDark, ...phone },
  phoneBoard: { light: mBoardLight, dark: mBoardDark, ...phone },
  phoneDashboard: { light: mDashboardLight, dark: mDashboardDark, ...phone },
} satisfies Record<string, Screen>;

export type ScreenName = keyof typeof SCREENS;
