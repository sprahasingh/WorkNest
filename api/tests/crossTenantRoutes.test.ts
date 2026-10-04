import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { setupOrg } from "./orgHelpers.js";
import { inMinutes } from "./orgHelpers.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const app = createApp();
app.set("trust proxy", 1);
const SECRET = "AAA-SECRET";

// Every route that works on an organization's data, found by reading the route
// files, so a route added later is covered without anyone remembering to list
// it. Each router is mounted in app.ts under a path; that table must name
// every mount, which the check below enforces.
const MOUNTS: Record<string, { prefix: string; file: string; router: string }> =
  {
    members: {
      prefix: "/members",
      file: "members",
      router: "(?:membersRouter|router)",
    },
    orgs: { prefix: "", file: "orgs", router: "router" },
    invites: { prefix: "/invites", file: "invites", router: "router" },
    projects: { prefix: "/projects", file: "projects", router: "router" },
    projectTasks: {
      prefix: "/projects/:projectId/tasks",
      file: "tasks",
      router: "projectTasksRouter",
    },
    projectActivity: {
      prefix: "/projects/:projectId/activity",
      file: "tasks",
      router: "projectActivityRouter",
    },
    tasks: { prefix: "/tasks", file: "tasks", router: "tasksRouter" },
    audit: { prefix: "/audit-logs", file: "audit", router: "router" },
    dashboard: { prefix: "/dashboard", file: "dashboard", router: "router" },
    notifications: {
      prefix: "/notifications",
      file: "notifications",
      router: "notificationsRouter",
    },
    chat: { prefix: "/chat", file: "chat", router: "chatRouter" },
    meetings: {
      prefix: "/meetings",
      file: "meetings",
      router: "meetingsRouter",
    },
    billing: { prefix: "/billing", file: "billing", router: "router" },
  };

function discoverRoutes(): [Method, string][] {
  const appSource = readFileSync(join(__dirname, "../src/app.ts"), "utf8");
  const mounted = [...appSource.matchAll(/orgRouter\.use\(/g)].length;
  expect(mounted, "a new router was mounted: add it to MOUNTS").toBe(
    Object.keys(MOUNTS).length,
  );
  const found = new Set<string>();
  for (const { prefix, file, router } of Object.values(MOUNTS)) {
    const dir = join(__dirname, "../src/modules", file);
    for (const name of readdirSync(dir).filter((n) =>
      n.endsWith(".routes.ts"),
    )) {
      if (/public|myInvites/i.test(name)) continue;
      const source = readFileSync(join(dir, name), "utf8");
      const pattern = new RegExp(
        `${router}\\.(get|post|put|patch|delete)\\(\\s*"([^"]*)"`,
        "g",
      );
      for (const match of source.matchAll(pattern)) {
        const path = match[2] === "/" ? prefix || "/" : `${prefix}${match[2]}`;
        found.add(`${match[1].toUpperCase()} ${path}`);
      }
    }
  }
  return [...found].sort().map((entry) => {
    const [method, path] = entry.split(" ");
    return [method as Method, path];
  });
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const call = (
  method: Method,
  url: string,
  token: string,
  body: object = {},
) => {
  const agent = request(app);
  const req =
    method === "GET"
      ? agent.get(url)
      : method === "POST"
        ? agent.post(url)
        : method === "PUT"
          ? agent.put(url)
          : method === "PATCH"
            ? agent.patch(url)
            : agent.delete(url);
  req.set("Authorization", `Bearer ${token}`);
  return method === "GET" || method === "DELETE" ? req : req.send(body);
};

// Every org-scoped route, tried two ways by someone from a different
// organization: (1) through the other organization's URL, and (2) through
// their own URL while pointing at the other organization's ids. Neither may
// read, change or even reveal anything.
describe("cross-tenant isolation on every org route", () => {
  it("keeps organization A's data away from organization B on all routes", async () => {
    const a = await setupOrg(app, "xta.test");
    const b = await setupOrg(app, "xtb.test");
    const sam = await a.addMember("sam");

    const project = await call(
      "POST",
      `/api/orgs/${a.orgId}/projects`,
      a.admin.token,
      {
        name: `${SECRET} project`,
        key: "XTA",
      },
    );
    expect(project.status).toBe(201);
    const projectId = project.body.project._id ?? project.body.project.id;
    const task = await call(
      "POST",
      `/api/orgs/${a.orgId}/projects/${projectId}/tasks`,
      a.admin.token,
      {
        title: `${SECRET} task`,
      },
    );
    const taskId = task.body.task._id ?? task.body.task.id;
    const activity = await call(
      "POST",
      `/api/orgs/${a.orgId}/tasks/${taskId}/activity`,
      a.admin.token,
      {
        type: "update_request",
        mentionMemberIds: [sam.id],
      },
    );
    const activityId =
      activity.body.activity?._id ??
      activity.body.activity?.id ??
      activity.body.item?._id ??
      "000000000000000000000001";
    const convo = await call(
      "POST",
      `/api/orgs/${a.orgId}/chat/conversations`,
      a.admin.token,
      {
        type: "direct",
        userId: sam.id,
      },
    );
    const conversationId = convo.body.conversation.id;
    const message = await call(
      "POST",
      `/api/orgs/${a.orgId}/chat/conversations/${conversationId}/messages`,
      a.admin.token,
      { text: `${SECRET} message` },
    );
    const messageId = message.body.message.id;
    const meeting = await call(
      "POST",
      `/api/orgs/${a.orgId}/meetings`,
      a.admin.token,
      {
        title: `${SECRET} meeting`,
        startsAt: inMinutes(120),
        endsAt: inMinutes(180),
        attendeeIds: [sam.id],
      },
    );
    const meetingId = meeting.body.meeting.id ?? meeting.body.meeting._id;
    const invite = await call(
      "POST",
      `/api/orgs/${a.orgId}/invites`,
      a.admin.token,
      {
        email: "newbie@xta.test",
        role: "member",
      },
    );
    const inviteId =
      invite.body.invite?._id ??
      invite.body.invite?.id ??
      "000000000000000000000002";

    const ids: Record<string, string> = {
      projectId: String(projectId),
      taskId: String(taskId),
      activityId: String(activityId),
      conversationId: String(conversationId),
      messageId: String(messageId),
      meetingId: String(meetingId),
      inviteId: String(inviteId),
      memberId: sam.membershipId,
      userId: sam.id,
    };
    // The setup really created everything (no stand-in ids), so the checks
    // below are aimed at real documents.
    for (const [name, value] of Object.entries(ids)) {
      expect(value, name).toMatch(/^[a-f0-9]{24}$/);
      expect(value, name).not.toMatch(/^0{23}[0-9]$/);
    }
    const fill = (path: string) =>
      path.replace(
        /:([A-Za-z]+)/g,
        (_m, name: string) => ids[name] ?? "000000000000000000000003",
      );

    const problems: string[] = [];
    const routes = discoverRoutes();
    expect(routes.length).toBeGreaterThan(70);
    for (const [method, path] of routes) {
      // (1) B calls A's URL: B is not a member, so every route must say 404.
      const viaA = await call(
        method,
        `/api/orgs/${a.orgId}${fill(path)}`,
        b.admin.token,
      );
      if (viaA.status !== 404)
        problems.push(`via A's URL  ${method} ${path} -> ${viaA.status}`);

      // (2) B calls its own URL with A's ids.
      const viaB = await call(
        method,
        `/api/orgs/${b.orgId}${fill(path)}`,
        b.admin.token,
      );
      const text = JSON.stringify(viaB.body);
      if (text.includes(SECRET))
        problems.push(
          `LEAK ${method} ${path} -> ${viaB.status} body contains A's data`,
        );
      if (
        viaB.status >= 200 &&
        viaB.status < 300 &&
        /:[A-Za-z]+/.test(path) &&
        !path.endsWith("/summary")
      ) {
        problems.push(`2xx with A's ids ${method} ${path} -> ${viaB.status}`);
      }
    }
    expect(problems).toEqual([]);

    // Empty bodies can be turned away by validation before anything is looked
    // up, so the changes that matter are also tried with valid bodies.
    const attempts: [Method, string, object][] = [
      ["PATCH", `/projects/${ids.projectId}`, { name: "Hijacked" }],
      ["POST", `/projects/${ids.projectId}/tasks`, { title: "Planted" }],
      ["POST", `/projects/${ids.projectId}/archive`, {}],
      ["DELETE", `/projects/${ids.projectId}`, {}],
      ["PATCH", `/tasks/${ids.taskId}`, { title: "Hijacked", status: "done" }],
      [
        "POST",
        `/tasks/${ids.taskId}/activity`,
        { type: "question", content: "hi" },
      ],
      ["DELETE", `/tasks/${ids.taskId}`, {}],
      ["PATCH", `/members/${ids.memberId}`, { role: "admin" }],
      ["DELETE", `/members/${ids.memberId}`, {}],
      [
        "POST",
        `/chat/conversations/${ids.conversationId}/messages`,
        { text: "planted" },
      ],
      [
        "POST",
        `/chat/conversations/${ids.conversationId}/members`,
        { userIds: [b.admin.id] },
      ],
      ["PATCH", `/chat/messages/${ids.messageId}`, { text: "edited" }],
      [
        "POST",
        `/chat/messages/${ids.messageId}/reactions`,
        { emoji: "\u{1F44D}" },
      ],
      ["DELETE", `/chat/messages/${ids.messageId}`, {}],
      ["PATCH", `/meetings/${ids.meetingId}`, { title: "Hijacked" }],
      ["PUT", `/meetings/${ids.meetingId}/response`, { response: "accepted" }],
      ["POST", `/meetings/${ids.meetingId}/cancel`, {}],
      ["DELETE", `/invites/${ids.inviteId}`, {}],
      ["POST", `/invites/${ids.inviteId}/accept`, {}],
    ];
    const weak: string[] = [];
    for (const [method, path, body] of attempts) {
      const res = await call(
        method,
        `/api/orgs/${b.orgId}${path}`,
        b.admin.token,
        body,
      );
      if (res.status < 400) weak.push(`${method} ${path} -> ${res.status}`);
      else if (res.status === 400)
        weak.push(
          `${method} ${path} -> 400 (body rejected, isolation not proven)`,
        );
    }
    expect(weak).toEqual([]);

    // Nothing of A's changed.
    const after = await call(
      "GET",
      `/api/orgs/${a.orgId}/projects/${projectId}`,
      a.admin.token,
    );
    expect(after.status).toBe(200);
    expect(JSON.stringify(after.body)).toContain(SECRET);
    const members = await call(
      "GET",
      `/api/orgs/${a.orgId}/members`,
      a.admin.token,
    );
    expect(JSON.stringify(members.body)).toContain("sam@xta.test");
    const mtg = await call(
      "GET",
      `/api/orgs/${a.orgId}/meetings/${meetingId}`,
      a.admin.token,
    );
    expect(mtg.status).toBe(200);
    const chat = await call(
      "GET",
      `/api/orgs/${a.orgId}/chat/conversations/${conversationId}/messages`,
      a.admin.token,
    );
    expect(JSON.stringify(chat.body)).toContain(SECRET);
    const tk = await call(
      "GET",
      `/api/orgs/${a.orgId}/tasks/${taskId}`,
      a.admin.token,
    );
    expect(tk.status).toBe(200);
  });
});
