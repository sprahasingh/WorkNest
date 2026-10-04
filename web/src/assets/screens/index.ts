// Product screenshots used on the landing page and in the guide. Each one has
// a light and a dark version, and the page shows whichever matches the theme.
// They're taken from a demo organization (Sunshine), not real data.
import auditDark from "./audit-dark.webp";
import auditLight from "./audit-light.webp";
import boardDark from "./board-dark.webp";
import boardLight from "./board-light.webp";
import boardFilterDark from "./board-filter-dark.webp";
import boardFilterLight from "./board-filter-light.webp";
import dashboardDark from "./dashboard-dark.webp";
import dashboardLight from "./dashboard-light.webp";
import dashboardChartsDark from "./dashboard-charts-dark.webp";
import dashboardChartsLight from "./dashboard-charts-light.webp";
import dashboardProjectsDark from "./dashboard-projects-dark.webp";
import dashboardProjectsLight from "./dashboard-projects-light.webp";
import mBoardDark from "./m-board-dark.webp";
import mBoardLight from "./m-board-light.webp";
import mDashboardDark from "./m-dashboard-dark.webp";
import mDashboardLight from "./m-dashboard-light.webp";
import mMeetingsDark from "./m-meetings-dark.webp";
import mMeetingsLight from "./m-meetings-light.webp";
import mMessagesDark from "./m-messages-dark.webp";
import mMessagesLight from "./m-messages-light.webp";
import meetingDetailDark from "./meeting-detail-dark.webp";
import meetingDetailLight from "./meeting-detail-light.webp";
import meetingFormDark from "./meeting-form-dark.webp";
import meetingFormLight from "./meeting-form-light.webp";
import meetingsDark from "./meetings-dark.webp";
import meetingsLight from "./meetings-light.webp";
import meetingsCalendarDark from "./meetings-calendar-dark.webp";
import meetingsCalendarLight from "./meetings-calendar-light.webp";
import membersDark from "./members-dark.webp";
import membersLight from "./members-light.webp";
import membersInviteDark from "./members-invite-dark.webp";
import membersInviteLight from "./members-invite-light.webp";
import messagesDark from "./messages-dark.webp";
import messagesLight from "./messages-light.webp";
import messagesMenuDark from "./messages-menu-dark.webp";
import messagesMenuLight from "./messages-menu-light.webp";
import messagesNewDark from "./messages-new-dark.webp";
import messagesNewLight from "./messages-new-light.webp";
import messagesSearchDark from "./messages-search-dark.webp";
import messagesSearchLight from "./messages-search-light.webp";
import projectNewDark from "./project-new-dark.webp";
import projectNewLight from "./project-new-light.webp";
import projectUpdatesDark from "./project-updates-dark.webp";
import projectUpdatesLight from "./project-updates-light.webp";
import projectsDark from "./projects-dark.webp";
import projectsLight from "./projects-light.webp";
import settingsDark from "./settings-dark.webp";
import settingsLight from "./settings-light.webp";
import settingsPlanDark from "./settings-plan-dark.webp";
import settingsPlanLight from "./settings-plan-light.webp";
import taskNewDark from "./task-new-dark.webp";
import taskNewLight from "./task-new-light.webp";
import taskUpdatesDark from "./task-updates-dark.webp";
import taskUpdatesLight from "./task-updates-light.webp";

export interface Screen {
  light: string;
  dark: string;
  width: number;
  height: number;
}

const desktop = { width: 1280, height: 860 };
const phone = { width: 390, height: 844 };

export const SCREENS = {
  dashboard: { light: dashboardLight, dark: dashboardDark, ...desktop },
  dashboardCharts: {
    light: dashboardChartsLight,
    dark: dashboardChartsDark,
    ...desktop,
  },
  dashboardProjects: {
    light: dashboardProjectsLight,
    dark: dashboardProjectsDark,
    ...desktop,
  },
  projects: { light: projectsLight, dark: projectsDark, ...desktop },
  projectNew: { light: projectNewLight, dark: projectNewDark, ...desktop },
  board: { light: boardLight, dark: boardDark, ...desktop },
  boardFilter: { light: boardFilterLight, dark: boardFilterDark, ...desktop },
  taskNew: { light: taskNewLight, dark: taskNewDark, ...desktop },
  taskUpdates: { light: taskUpdatesLight, dark: taskUpdatesDark, ...desktop },
  projectUpdates: {
    light: projectUpdatesLight,
    dark: projectUpdatesDark,
    ...desktop,
  },
  messages: { light: messagesLight, dark: messagesDark, ...desktop },
  messagesSearch: {
    light: messagesSearchLight,
    dark: messagesSearchDark,
    ...desktop,
  },
  messagesMenu: {
    light: messagesMenuLight,
    dark: messagesMenuDark,
    ...desktop,
  },
  messagesNew: { light: messagesNewLight, dark: messagesNewDark, ...desktop },
  meetings: { light: meetingsLight, dark: meetingsDark, ...desktop },
  meetingDetail: {
    light: meetingDetailLight,
    dark: meetingDetailDark,
    ...desktop,
  },
  meetingForm: { light: meetingFormLight, dark: meetingFormDark, ...desktop },
  meetingsCalendar: {
    light: meetingsCalendarLight,
    dark: meetingsCalendarDark,
    ...desktop,
  },
  members: { light: membersLight, dark: membersDark, ...desktop },
  membersInvite: {
    light: membersInviteLight,
    dark: membersInviteDark,
    ...desktop,
  },
  audit: { light: auditLight, dark: auditDark, ...desktop },
  settings: { light: settingsLight, dark: settingsDark, ...desktop },
  settingsPlan: {
    light: settingsPlanLight,
    dark: settingsPlanDark,
    ...desktop,
  },
  phoneMessages: { light: mMessagesLight, dark: mMessagesDark, ...phone },
  phoneMeetings: { light: mMeetingsLight, dark: mMeetingsDark, ...phone },
  phoneBoard: { light: mBoardLight, dark: mBoardDark, ...phone },
  phoneDashboard: { light: mDashboardLight, dark: mDashboardDark, ...phone },
} satisfies Record<string, Screen>;

export type ScreenName = keyof typeof SCREENS;
