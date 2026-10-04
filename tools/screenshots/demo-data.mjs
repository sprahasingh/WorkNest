// Builds the Sunshine demo organization that the product screenshots are taken
// from: five people, four projects with a few weeks of history, a group chat,
// two direct messages and some meetings.
//
// Start from an empty database, run `npm run seed` in api/ (it creates the
// Acme Corp organization and its accounts), start the API, then run this. It
// turns Acme into Sunshine, so it only makes sense on a throwaway database.
//
//   API_URL      the API, default http://localhost:4000/api
//   MONGODB_URI  the same database the API uses (required)
//
// It writes the ids it created to .cache/demo.json for capture.mjs.
import fs from "node:fs";
import { MongoClient, ObjectId } from "mongodb";

const API = process.env.API_URL ?? "http://localhost:4000/api";
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI)
  throw new Error("Set MONGODB_URI to the database the API uses");

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// ---- 1. Rename the seeded org and people
const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db();
const people = [
  ["admin@acme.demo", "Spraha Singh", "spraha.singh@sunshine.com"],
  ["manager@acme.demo", "Govind Kaushal", "govind.kaushal@sunshine.com"],
  ["member@acme.demo", "Aditi Sharma", "aditi.sharma@sunshine.com"],
];
for (const [from, name, email] of people)
  await db
    .collection("users")
    .updateOne({ email: from }, { $set: { name, email } });
const org = await db.collection("organizations").findOne({ slug: "acme" });
await db.collection("organizations").updateOne(
  { _id: org._id },
  {
    $set: {
      name: "Sunshine",
      slug: "sunshine",
      timeZone: "America/Los_Angeles",
    },
  },
);

// start from a clean slate: the stock seed adds sample projects we don't want here
for (const c of [
  "projects",
  "tasks",
  "auditlogs",
  "taskactivities",
  "notifications",
])
  await db.collection(c).deleteMany({ tenantId: org._id });

// two more teammates, cloned from an existing account so the password still works
const template = await db
  .collection("users")
  .findOne({ email: "spraha.singh@sunshine.com" });
const extra = [
  ["Divyansh Chaudhary", "divyansh.chaudhary@sunshine.com", "member"],
  ["Ishita Verma", "ishita.verma@sunshine.com", "member"],
];
for (const [name, email, role] of extra) {
  const { _id, ...rest } = template;
  const created = await db.collection("users").insertOne({
    ...rest,
    name,
    email,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.collection("memberships").insertOne({
    tenantId: org._id,
    userId: created.insertedId,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
await db
  .collection("organizations")
  .updateOne({ _id: org._id }, { $set: { seatsUsed: 5 } });

async function login(email) {
  const { accessToken } = await call("POST", "/auth/login", null, {
    email,
    password: "password123",
  });
  const me = await call("GET", "/auth/me", accessToken);
  return { token: accessToken, id: me.user.id };
}
// The first-run tour should not cover the pictures, so mark everyone as having seen it.
await db
  .collection("users")
  .updateMany({}, { $set: { onboardingSeenAt: new Date() } });
const spraha = await login("spraha.singh@sunshine.com");
const govind = await login("govind.kaushal@sunshine.com");
const aditi = await login("aditi.sharma@sunshine.com");
const divyansh = await login("divyansh.chaudhary@sunshine.com");
const ishita = await login("ishita.verma@sunshine.com");
const O = org._id.toString();
const A = (u, m, p, b) => call(m, `/orgs/${O}${p}`, u.token, b);

await A(spraha, "POST", "/plan", { plan: "pro" }).catch(() =>
  A(spraha, "PATCH", "/plan", { plan: "pro" }),
);

// ---- 2. Projects and tasks
const day = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mk = async (name, key, priority, due, description) =>
  (
    await A(spraha, "POST", "/projects", {
      name,
      key,
      priority,
      dueDate: due,
      description,
    })
  ).project._id;
const web = await mk(
  "Website Relaunch",
  "WEB",
  "high",
  day(24),
  "New marketing site: content, design system and launch.",
);
const app = await mk(
  "Mobile App 2.0",
  "APP",
  "medium",
  day(52),
  "Offline mode, push notifications and a refreshed navigation.",
);
const onb = await mk(
  "Customer Onboarding",
  "ONB",
  "medium",
  day(38),
  "A guided first week for new clients.",
);
const brd = await mk(
  "Brand Refresh",
  "BRD",
  "low",
  day(66),
  "Updated logo, colour palette and tone of voice.",
);

let n = 0;
const T = async (
  project,
  title,
  {
    assignees = [],
    priority = "medium",
    due = null,
    status = "todo",
    description,
    by,
    ago = 0,
  } = {},
) => {
  n += 1;
  // some people add their own tasks, the rest are created by the admin
  by ??= assignees.length === 1 && n % 2 === 0 ? assignees[0] : spraha;
  const created = await A(by, "POST", `/projects/${project}/tasks`, {
    title,
    priority,
    ...(due !== null ? { dueDate: day(due) } : {}),
    assigneeIds: assignees.map((a) => a.id),
    ...(description ? { description } : {}),
  });
  const id = created.task._id;
  if (status !== "todo") {
    const owner = assignees[0] ?? spraha;
    await A(assignees.length ? owner : spraha, "PATCH", `/tasks/${id}`, {
      status,
    }).catch(() => A(spraha, "PATCH", `/tasks/${id}`, { status }));
  }
  return { id, ago, status };
};
const made = [];
const add = async (...args) => made.push(await T(...args));

// Website Relaunch
await add(web, "Audit current site content", {
  assignees: [aditi],
  priority: "medium",
  due: -2,
  status: "done",
  ago: 40,
});
await add(web, "Define site map and navigation", {
  assignees: [ishita],
  priority: "high",
  due: 1,
  status: "done",
  ago: 34,
});
await add(web, "Write homepage copy", {
  assignees: [aditi],
  priority: "high",
  due: 3,
  status: "in_progress",
  ago: 24,
});
await add(web, "Design homepage hero section", {
  assignees: [ishita, govind],
  priority: "high",
  due: 2,
  status: "in_progress",
  ago: 22,
  description:
    "Mobile first. Needs final sign off from Spraha before development.",
});
await add(web, "Build reusable component library", {
  assignees: [divyansh],
  priority: "medium",
  due: 9,
  status: "in_progress",
  ago: 9,
});
await add(web, "Set up analytics and consent banner", {
  assignees: [divyansh],
  priority: "low",
  due: 12,
  ago: 12,
});
await add(web, "Accessibility review (WCAG AA)", {
  assignees: [govind],
  priority: "medium",
  due: 16,
  ago: 9,
});
await add(web, "Migrate blog posts", {
  assignees: [aditi],
  priority: "low",
  due: 19,
  ago: 7,
});
await add(web, "Redirect map for old URLs", {
  assignees: [divyansh],
  priority: "high",
  due: -3,
  ago: 26,
});
// Mobile App 2.0
await add(app, "Offline sync design spec", {
  assignees: [govind],
  priority: "high",
  due: 4,
  status: "in_progress",
  ago: 30,
});
await add(app, "Push notification service", {
  assignees: [divyansh],
  priority: "medium",
  due: 15,
  ago: 20,
});
await add(app, "Navigation redesign prototype", {
  assignees: [ishita],
  priority: "medium",
  due: 8,
  status: "in_progress",
  ago: 6,
});
await add(app, "Crash reporting rollout", {
  assignees: [divyansh],
  priority: "low",
  due: -1,
  status: "done",
  ago: 35,
});
await add(app, "App store listing refresh", {
  assignees: [aditi],
  priority: "low",
  due: 30,
  ago: 5,
});
// Customer Onboarding
await add(onb, "Welcome email sequence", {
  assignees: [aditi],
  priority: "medium",
  due: 6,
  status: "in_progress",
  ago: 4,
});
await add(onb, "Kickoff call template", {
  assignees: [govind],
  priority: "low",
  due: 10,
  status: "done",
  ago: 28,
});
await add(onb, "Client portal walkthrough video", {
  assignees: [ishita],
  priority: "medium",
  due: 21,
  ago: 8,
});
await add(onb, "First week checklist", {
  assignees: [govind, aditi],
  priority: "high",
  due: 5,
  ago: 11,
});
// Brand Refresh
await add(brd, "Moodboards and references", {
  assignees: [ishita],
  priority: "low",
  due: 14,
  status: "done",
  ago: 21,
});
await add(brd, "Logo exploration round one", {
  assignees: [ishita],
  priority: "medium",
  due: 25,
  ago: 6,
});
await add(brd, "Tone of voice guide", {
  assignees: [aditi],
  priority: "low",
  due: 40,
  ago: 3,
});

// spread creation dates over the last weeks so the dashboard chart has a real shape
const now = Date.now();
for (const t of made) {
  const created = new Date(
    now - t.ago * 86400000 - Math.random() * 6 * 3600000,
  );
  const set = { createdAt: created };
  if (t.status === "done")
    set.completedAt = new Date(now - (1 + Math.random() * 11) * 86400000);
  await db
    .collection("tasks")
    .updateOne({ _id: new ObjectId(t.id) }, { $set: set });
}
await db
  .collection("projects")
  .updateMany(
    { tenantId: org._id },
    { $set: { createdAt: new Date(now - 45 * 86400000) } },
  );

// Updates and questions on the board
const task = (title) =>
  db
    .collection("tasks")
    .findOne({ tenantId: org._id, title })
    .then((t) => t._id.toString());
const hero = await task("Design homepage hero section");
await A(spraha, "POST", `/tasks/${hero}/activity`, {
  type: "update_request",
  content: "Could you share where this stands before Thursday's review?",
});
const upd = await A(ishita, "POST", `/tasks/${hero}/activity`, {
  type: "update",
  content:
    "Desktop and tablet layouts are done. Mobile variant is about 60% complete, I'll post it for review tomorrow.",
});
await A(govind, "POST", `/tasks/${hero}/activity`, {
  type: "question",
  content:
    "Are we keeping the video background or switching to a still image for performance?",
});
const copy = await task("Write homepage copy");
await A(aditi, "POST", `/tasks/${copy}/activity`, {
  type: "update",
  content:
    "First draft is in the shared doc. Waiting on feedback for the pricing section.",
});

// ---- 3. Chat
const chat = (u, m, p, b) => A(u, m, `/chat${p}`, b);
const group = (
  await chat(spraha, "POST", "/conversations", {
    type: "group",
    name: "Website Relaunch",
    memberIds: [govind.id, aditi.id, divyansh.id, ishita.id],
  })
).conversation;
const say = (u, id, text, extra = {}) =>
  chat(u, "POST", `/conversations/${id}/messages`, { text, ...extra });
await say(
  spraha,
  group.id,
  "Morning everyone. Quick reminder that the homepage review is on Thursday at 14:00.",
);
await say(
  govind,
  group.id,
  "Thanks Spraha. I'll have the accessibility checklist ready before then.",
);
const q = await say(
  aditi,
  group.id,
  "Copy for the homepage is drafted. Could someone check the pricing section? I'm not sure about the tone.",
  {},
);
await say(
  ishita,
  group.id,
  "I'll take a look this afternoon. The hero layouts are almost done too.",
  { replyToId: q.message.id },
);
const ok = await say(
  divyansh,
  group.id,
  "Component library is on track. Buttons, forms and cards are merged, navigation is next.",
);
await chat(spraha, "POST", `/messages/${ok.message.id}/reactions`, {
  emoji: "👍",
});
await chat(govind, "POST", `/messages/${ok.message.id}/reactions`, {
  emoji: "🎉",
});
await chat(aditi, "POST", `/messages/${ok.message.id}/reactions`, {
  emoji: "👍",
});
await say(
  spraha,
  group.id,
  "@Divyansh Chaudhary great progress. Can you also look at the redirect map? It's now overdue.",
  { mentionIds: [divyansh.id] },
);
await say(divyansh, group.id, "On it, I'll have it done by tomorrow morning.");
await say(
  govind,
  group.id,
  "Draft agenda for Thursday is in the meeting invite. Add anything you want to cover.",
);
const dm = (
  await chat(govind, "POST", "/conversations", {
    type: "direct",
    userId: spraha.id,
  })
).conversation;
await say(
  govind,
  dm.id,
  "Do you have five minutes to go over the offline sync spec?",
);
await say(spraha, dm.id, "Sure, give me ten and I'll join the call.");
await say(govind, dm.id, "Perfect, sending a link now.");
const dm2 = (
  await chat(aditi, "POST", "/conversations", {
    type: "direct",
    userId: spraha.id,
  })
).conversation;
await say(
  aditi,
  dm2.id,
  "Could we move our 1:1 to Friday morning? Thursday is getting busy.",
);
await say(
  aditi,
  dm2.id,
  "Also, the new tone of voice guide is ready for your comments whenever you have a moment.",
);
await chat(spraha, "POST", `/conversations/${group.id}/read`);
await chat(spraha, "POST", `/conversations/${dm.id}/read`);

// ---- 4. Meetings
const TZ = "America/Los_Angeles";
const offsetMs = (utc) => {
  const d = new Date(utc);
  return (
    new Date(d.toLocaleString("en-US", { timeZone: TZ })).getTime() -
    new Date(d.toLocaleString("en-US", { timeZone: "UTC" })).getTime()
  );
};
// the instant when it is h:m on the given day in the studio's time zone
const localAt = (y, mo, dd, h, m) => {
  const guess = Date.UTC(y, mo, dd, h, m);
  return new Date(guess - offsetMs(guess));
};
const todayLocal = () => {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .split("-")
    .map(Number);
  return { y: p[0], mo: p[1] - 1, d: p[2] };
};
// the nth upcoming weekday (1 = the next one), so meetings never land on a weekend
const at = (n, h, m = 0) => {
  const t = todayLocal();
  const day = new Date(Date.UTC(t.y, t.mo, t.d));
  let left = n;
  while (left > 0) {
    day.setUTCDate(day.getUTCDate() + 1);
    const w = day.getUTCDay();
    if (w !== 0 && w !== 6) left -= 1;
  }
  return localAt(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    h,
    m,
  );
};
const iso = (d) => d.toISOString();
const meet = (u, b) => A(u, "POST", "/meetings", b);
const heroTask = await task("Design homepage hero section");
const soon = new Date(Date.now() + 9 * 60000);
await meet(govind, {
  title: "Daily standup",
  agenda: "Blockers and priorities for the day.",
  startsAt: iso(soon),
  endsAt: iso(new Date(soon.getTime() + 15 * 60000)),
  joinUrl: "https://meet.jit.si/Sunshine-standup",
  attendeeIds: [spraha.id, aditi.id, divyansh.id, ishita.id],
  projectId: web,
});
const weekly = [0, 1, 2, 3, 4, 5].map((i) => at(2 + i * 5, 10));
await meet(spraha, {
  title: "Weekly project sync",
  agenda: "Progress, risks and decisions across all projects.",
  startsAt: iso(weekly[0]),
  endsAt: iso(new Date(weekly[0].getTime() + 45 * 60000)),
  joinUrl: "https://meet.google.com/snh-wkly-syn",
  location: "Studio, Meeting room 2",
  attendeeIds: [govind.id, aditi.id, divyansh.id, ishita.id],
  repeat: { freq: "weekly", starts: weekly.map(iso) },
});
await meet(spraha, {
  title: "Homepage design review",
  agenda:
    "1. Hero section options\n2. Navigation structure\n3. Accessibility notes\n4. Sign off and next steps",
  startsAt: iso(at(1, 14)),
  endsAt: iso(at(1, 15)),
  joinUrl: "https://meet.jit.si/Sunshine-design-review",
  attendeeIds: [govind.id, ishita.id, aditi.id],
  projectId: web,
  taskId: heroTask,
});
await meet(govind, {
  title: "Mobile App 2.0 planning",
  agenda: "Scope for the offline mode release.",
  startsAt: iso(at(3, 11)),
  endsAt: iso(at(3, 12, 30)),
  joinUrl: "https://meet.jit.si/Sunshine-app-planning",
  attendeeIds: [spraha.id, divyansh.id],
  projectId: app,
});
await meet(spraha, {
  title: "Client check-in",
  startsAt: iso(at(5, 16)),
  endsAt: iso(at(5, 16, 30)),
  location: "Video call",
  joinUrl: "https://meet.google.com/xyz-clnt-chk",
  attendeeIds: [govind.id],
});
await A(aditi, "GET", "/meetings?view=upcoming");

// accept some invites so the RSVP states look real
const upcoming = (await A(govind, "GET", "/meetings?view=upcoming")).meetings;
for (const m of upcoming)
  if (m.title === "Homepage design review" || m.title === "Weekly project sync")
    await A(govind, "PUT", `/meetings/${m.id}/response`, {
      response: "accepted",
      scope: "all",
    });
const sofiaMeetings = (await A(aditi, "GET", "/meetings?view=upcoming"))
  .meetings;
for (const m of sofiaMeetings)
  if (m.title === "Homepage design review")
    await A(aditi, "PUT", `/meetings/${m.id}/response`, {
      response: "tentative",
    });

// give the audit log and dashboard history a believable past
const taskDocs = new Map(
  (await db.collection("tasks").find({ tenantId: org._id }).toArray()).map(
    (t) => [String(t._id), t],
  ),
);
for (const log of await db
  .collection("auditlogs")
  .find({ tenantId: org._id })
  .toArray()) {
  let at = null;
  const t = taskDocs.get(String(log.entityId));
  if (log.action === "task.created" && t) at = t.createdAt;
  else if (log.action === "task.updated" && t) {
    const to = log.metadata?.status?.to;
    at =
      to === "done"
        ? (t.completedAt ?? new Date(t.createdAt.getTime() + 5 * 86400000))
        : new Date(
            Math.min(
              Date.now() - 3600000,
              t.createdAt.getTime() + 2 * 86400000,
            ),
          );
  } else if (log.action === "project.created")
    at = new Date(now - 46 * 86400000);
  else if (log.action === "plan.changed") at = new Date(now - 44 * 86400000);
  else if (log.action === "org.seeded") at = new Date(now - 60 * 86400000);
  if (at)
    await db
      .collection("auditlogs")
      .updateOne({ _id: log._id }, { $set: { createdAt: at, updatedAt: at } });
}

// ---- 5. Make the timeline look like a real working day
const stamp = async (conversationId, minutesAgo) => {
  const msgs = await db
    .collection("messages")
    .find({ conversationId: new ObjectId(conversationId) })
    .sort({ _id: 1 })
    .toArray();
  let last = null;
  for (const [i, m] of msgs.entries()) {
    const at = new Date(
      Date.now() - (minutesAgo[i] ?? minutesAgo[minutesAgo.length - 1]) * 60000,
    );
    await db
      .collection("messages")
      .updateOne({ _id: m._id }, { $set: { createdAt: at, updatedAt: at } });
    last = at;
  }
  await db
    .collection("conversations")
    .updateOne(
      { _id: new ObjectId(conversationId) },
      { $set: { lastMessageAt: last, "members.$[].lastReadAt": new Date(0) } },
    );
};
await stamp(
  group.id,
  [230, 224, 209, 197, 182, 181, 180, 169, 164, 158, 60].slice(0, 10),
);
await stamp(dm.id, [95, 92, 91]);
await stamp(dm2.id, [30, 27]);
const sprahaId = new ObjectId(spraha.id);
const keep = new Date();
for (const cid of [group.id, dm.id])
  await db
    .collection("conversations")
    .updateOne(
      { _id: new ObjectId(cid) },
      { $set: { "members.$[].lastReadAt": keep } },
    );
await db
  .collection("conversations")
  .updateOne(
    { _id: new ObjectId(dm2.id) },
    { $set: { "members.$[m].lastReadAt": new Date(0) } },
    { arrayFilters: [{ "m.userId": sprahaId }] },
  );
// updates on the board were written a few hours and days ago, not just now
const acts = await db
  .collection("taskactivities")
  .find({ tenantId: org._id })
  .sort({ _id: 1 })
  .toArray();
for (const [i, a] of acts.entries()) {
  const at = new Date(Date.now() - (26 - i * 7) * 3600000);
  await db
    .collection("taskactivities")
    .updateOne({ _id: a._id }, { $set: { createdAt: at, updatedAt: at } });
}
// people joined over the past weeks
const ms = await db
  .collection("memberships")
  .find({ tenantId: org._id })
  .sort({ _id: 1 })
  .toArray();
for (const [i, m] of ms.entries()) {
  const at = new Date(Date.now() - (60 - i * 9) * 86400000);
  await db
    .collection("memberships")
    .updateOne({ _id: m._id }, { $set: { createdAt: at, updatedAt: at } });
}
// a calmer bell
const unread = await db
  .collection("notifications")
  .find({ userId: sprahaId, readAt: null })
  .sort({ _id: -1 })
  .toArray();
for (const n of unread.slice(2))
  await db
    .collection("notifications")
    .updateOne({ _id: n._id }, { $set: { readAt: new Date() } });

fs.mkdirSync(new URL("./.cache", import.meta.url), { recursive: true });
fs.writeFileSync(
  new URL("./.cache/demo.json", import.meta.url),
  JSON.stringify(
    {
      org: O,
      web,
      app,
      onb,
      brd,
      hero,
      group: group.id,
      dm: dm.id,
      // The browser clock is frozen here when taking pictures, five minutes
      // before the "Daily standup" meeting, so every picture reads the same.
      shotTime: new Date(soon.getTime() - 5 * 60000).toISOString(),
    },
    null,
    2,
  ),
);
console.log("Demo organization ready. Ids written to .cache/demo.json");
await client.close();
