// Takes the product screenshots and saves them where the site and the README
// expect them: web/src/assets/screens/<section>/<file>.<theme>.webp.
//
// It reads web/src/assets/screens/screens.json for the list, sizes and file
// names, and signs in as the demo users from demo-data.mjs. Run that first.
//
//   WEB_URL     the running web app, default http://localhost:5173
//   BROWSER     path to a Chromium or Chrome binary (default: Playwright's)
//
//   node capture.mjs                              everything, both themes
//   node capture.mjs --only tasks/board,phone/01-dashboard   some screens
//   node capture.mjs --theme dark                 one theme
//   node capture.mjs --out ./preview              write somewhere else first
//
// If a run stops at the sign-in page, the API's login limit was reached.
// Restart the API and run again.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import sharp from "sharp";

// Demo values typed into forms. Change them here if you want different ones.
const DEMO = {
  admin: "spraha.singh@sunshine.com",
  invitee: "ishita.verma@sunshine.com", // sees Accept / Maybe / Decline on a meeting
  password: "password123",
  newProject: {
    name: "Customer Portal",
    key: "PRT",
    description: "A self-service area where clients can follow their projects.",
  },
  newTaskTitle: "Prepare launch checklist",
  newMeetingTitle: "Sprint planning",
  newMeetingPlace: "Meeting room 2",
  inviteEmail: "teammate@sunshine.com",
  searchTerm: "homepage",
  chatToRightClick: "Govind",
  meetingToOpen: "Homepage design review",
  messageToRightClick: "Component library is on track",
};

const here = path.dirname(fileURLToPath(import.meta.url));
const screensDir = path.resolve(here, "../../web/src/assets/screens");
const manifest = JSON.parse(
  fs.readFileSync(path.join(screensDir, "screens.json"), "utf8"),
);
const ids = JSON.parse(
  fs.readFileSync(path.join(here, ".cache/demo.json"), "utf8"),
);

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const only = option("only")?.split(",") ?? null;
const themes = option("theme") ? [option("theme")] : ["light", "dark"];
const outDir = option("out") ? path.resolve(option("out")) : screensDir;
const base = process.env.WEB_URL ?? "http://localhost:5173";
const O = ids.org;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// What to do on the page before the picture is taken, for each screen.
const shots = {
  "dashboard/tasks-overview": async (p) => {
    await open(p, "/dashboard", 2200);
    await scrollToHeading(p, "Dashboard", 20);
  },
  "dashboard/tasks-status": async (p) => {
    await open(p, "/dashboard", 2200);
    await scrollToHeading(p, "Where tasks stand", 16);
    await sleep(1500);
  },
  "dashboard/tasks-workload": async (p) => {
    await open(p, "/dashboard", 2200);
    // The picture starts wherever the page ends up when it is scrolled all the
    // way down, so it never repeats what the picture before it already shows.
    await p.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await sleep(1500);
  },
  "dashboard/projects-overview": async (p) => {
    await openProjectsView(p);
    await scrollToHeading(p, "Dashboard", 20);
  },
  "dashboard/projects-flow": async (p) => {
    await openProjectsView(p);
    await scrollToHeading(p, "Created and marked done by project", 16);
    await sleep(1500);
  },
  "projects/list": async (p) => {
    await open(p, "/projects", 1200);
  },
  "projects/new-project": async (p) => {
    await open(p, "/projects");
    await p
      .getByRole("button", { name: /new project/i })
      .first()
      .click();
    await sleep(500);
    await p.getByLabel(/^name/i).first().fill(DEMO.newProject.name);
    await p.getByPlaceholder("e.g. OPS").fill(DEMO.newProject.key);
    await p.getByLabel(/^description/i).fill(DEMO.newProject.description);
    await sleep(300);
  },
  "tasks/board": async (p) => {
    await open(p, `/projects/${ids.web}`, 1500);
  },
  "tasks/new-task": async (p) => {
    await open(p, `/projects/${ids.web}`, 1200);
    await p
      .getByRole("button", { name: /new task/i })
      .first()
      .click();
    await sleep(500);
    await p
      .getByLabel(/^title/i)
      .first()
      .fill(DEMO.newTaskTitle);
    await sleep(300);
  },
  "tasks/filter": async (p) => {
    await open(p, `/projects/${ids.web}`, 1500);
    await p.locator("select").first().selectOption({ label: "High" });
    await sleep(900);
  },
  "updates/task-updates": async (p) => {
    await open(p, `/projects/${ids.web}?task=${ids.hero}`, 1500);
  },
  "updates/project-updates": async (p) => {
    await open(p, `/projects/${ids.web}`, 1200);
    await p.getByRole("button", { name: "Project updates" }).click();
    await sleep(1200);
  },
  "messages/group-chat": async (p) => {
    await open(p, `/messages/${ids.group}`, 1600);
  },
  "messages/search": async (p) => {
    await open(p, `/messages/${ids.group}`, 1200);
    await p.getByPlaceholder(/Search people/).fill(DEMO.searchTerm);
    await sleep(1500);
  },
  "messages/chat-menu": async (p) => {
    await open(p, `/messages/${ids.group}`, 1400);
    const row = p.getByText(new RegExp(DEMO.chatToRightClick)).first();
    await row.click({ button: "right" });
    await sleep(600);
  },
  "messages/message-options": async (p) => {
    await open(p, `/messages/${ids.group}`, 1600);
    await p
      .getByText(DEMO.messageToRightClick)
      .first()
      .click({ button: "right" });
    await sleep(600);
  },
  "messages/new-conversation": async (p) => {
    await open(p, `/messages/${ids.group}`, 1200);
    await p.getByRole("button", { name: /^new/i }).first().click();
    await sleep(600);
  },
  "meetings/upcoming": async (p) => {
    await open(p, "/meetings", 1500);
  },
  "meetings/meeting-detail": async (p) => {
    await open(p, "/meetings", 1200);
    await p.getByText(DEMO.meetingToOpen).first().click();
    await sleep(900);
  },
  "meetings/schedule": async (p) => {
    await open(p, "/meetings", 1200);
    await p
      .getByRole("button", { name: /schedule meeting/i })
      .first()
      .click();
    await sleep(600);
    await p
      .getByLabel(/^title/i)
      .first()
      .fill(DEMO.newMeetingTitle);
    // A weekday about a week and a half out, so no "you already have a meeting" warning shows.
    const day = new Date();
    day.setDate(day.getDate() + 9);
    while ([0, 6].includes(day.getDay())) day.setDate(day.getDate() + 1);
    await p
      .locator('input[type="date"]')
      .first()
      .fill(day.toISOString().slice(0, 10));
    const times = p.locator('input[type="time"]');
    await times.nth(0).fill("15:00");
    await times.nth(1).fill("15:30");
    await p
      .getByPlaceholder("e.g. Boardroom 2")
      .fill(DEMO.newMeetingPlace)
      .catch(() => {});
    await sleep(400);
  },
  "meetings/calendar": async (p) => {
    await open(p, "/meetings", 1000);
    await p.getByRole("tab", { name: "Calendar" }).click();
    await sleep(1000);
  },
  "team/members": async (p) => {
    await open(p, "/members", 1200);
  },
  "team/invite": async (p) => {
    await open(p, "/members", 1200);
    await scrollToHeading(p, "Invites", 20, false);
    await p.getByLabel(/email/i).first().fill(DEMO.inviteEmail);
    await sleep(700);
  },
  "settings/plans": async (p) => {
    await open(p, "/settings", 1400);
    await scrollToHeading(p, "Plan", 16);
    await sleep(900);
  },
  "audit/audit-log": async (p) => {
    await open(p, "/audit", 1400);
  },
  "phone/01-dashboard": async (p) => {
    await open(p, "/dashboard", 1200);
  },
  "phone/02-board": async (p) => {
    await open(p, `/projects/${ids.web}`, 1400);
  },
  "phone/03-messages": async (p) => {
    await open(p, `/messages/${ids.group}`, 1500);
  },
  "phone/04-meetings": async (p) => {
    await open(p, "/meetings", 1500);
  },
};

// Screens that need a different person signed in.
const signedInAs = { "meetings/meeting-detail": DEMO.invitee };

async function open(page, route, wait = 1200) {
  await page.goto(`${base}/orgs/${O}${route}`);
  await sleep(wait);
}
// Scrolls so the card or heading with this text sits just under the app bar,
// leaving a small gap above it. The gap is in pixels.
async function scrollToHeading(page, text, gap, useCard = true) {
  await page.evaluate(
    ({ text, gap, useCard }) => {
      const matches = [...document.querySelectorAll("h1, h2, h3")].filter(
        (el) => el.textContent.trim().startsWith(text),
      );
      const heading = matches[0];
      if (!heading) throw new Error(`No heading starting with "${text}"`);
      // A chart heading belongs to a card, and the card's edge is what should line up.
      const card = heading.closest(
        "section, [class*='rounded-xl'], [class*='rounded-2xl']",
      );
      const target =
        useCard && card && card.contains(heading) && heading.tagName !== "H1"
          ? card
          : heading;
      const appBar = 64;
      window.scrollTo(
        0,
        window.scrollY + target.getBoundingClientRect().top - appBar - gap,
      );
    },
    { text, gap, useCard },
  );
  await sleep(500);
}
async function openProjectsView(page) {
  await open(page, "/dashboard", 1500);
  await page.getByRole("tab", { name: "Projects" }).click();
  await page.waitForURL(/view=projects/);
  await sleep(2200);
}
async function scrollBy(page, pixels) {
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, pixels);
}

// The keys the manifest lists, in "section/id" form, mapped to their files.
const wanted = [];
for (const section of manifest.sections) {
  for (const screen of section.screens) {
    // Phone shots are keyed by file name because their ids repeat other sections.
    const key =
      section.id === "phone"
        ? `phone/${screen.file}`
        : `${section.id}/${screen.id}`;
    wanted.push({ key, section, screen, size: manifest.sizes[section.size] });
  }
}
const missing = wanted.filter((w) => !shots[w.key]).map((w) => w.key);
if (missing.length)
  throw new Error(`No capture steps for: ${missing.join(", ")}`);

const browser = await chromium.launch({
  ...(process.env.BROWSER ? { executablePath: process.env.BROWSER } : {}),
  args: ["--no-sandbox"],
});

async function signIn(dark, size, user, isPhone) {
  const context = await browser.newContext({
    viewport: size,
    colorScheme: dark ? "dark" : "light",
    locale: "en-GB",
    timezoneId: "America/Los_Angeles",
    deviceScaleFactor: 1,
    ...(isPhone ? { hasTouch: true, isMobile: true } : {}),
  });
  // Freeze the browser clock a few minutes before the demo's "starts soon"
  // meeting, so labels like "Starts in 5 min" and "19 hours ago" read the same
  // in every picture, in both themes, however long the run takes.
  await context.clock.setFixedTime(new Date(ids.shotTime));
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("Page error:", error.message));
  await page.goto(`${base}/login`);
  await page.getByLabel("Email").fill(user);
  await page.locator('input[type="password"]').first().fill(DEMO.password);
  await page
    .getByRole("button", { name: /log in|sign in/i })
    .first()
    .click();
  try {
    await page.waitForURL(/\/orgs/, { timeout: 20000 });
  } catch {
    throw new Error(
      `Could not sign in as ${user}. If the API has rate limited this machine, restart it and run again, one theme at a time (--theme light, then --theme dark).`,
    );
  }
  return page;
}

let saved = 0;
for (const theme of themes) {
  const dark = theme === "dark";
  const pages = new Map();
  for (const { key, section, screen, size } of wanted) {
    if (only && !only.includes(key)) continue;
    const user = signedInAs[key] ?? DEMO.admin;
    const isPhone = section.id === "phone";
    const pageKey = `${user}|${isPhone}`;
    if (!pages.has(pageKey))
      pages.set(pageKey, await signIn(dark, size, user, isPhone));
    const page = pages.get(pageKey);
    try {
      try {
        await shots[key](page);
      } catch {
        // Pages sometimes finish a navigation late. One more try is enough.
        await sleep(1000);
        await shots[key](page);
      }
      // Never save a page that is still showing its loading state.
      await page
        .getByText("Loading…", { exact: true })
        .first()
        .waitFor({ state: "detached", timeout: 10000 });
      // A focus ring left on a button (usually a dialog's close button) looks like a glitch.
      await page.evaluate(
        () =>
          document.activeElement instanceof HTMLButtonElement &&
          document.activeElement.blur(),
      );
      await page.mouse.move(size.width / 2, 2);
      await sleep(200);
      const png = await page.screenshot();
      const target = path.join(
        outDir,
        section.id,
        `${screen.file}.${theme}.webp`,
      );
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await sharp(png).webp({ quality: 82, effort: 6 }).toFile(target);
      saved += 1;
      console.log(`saved ${path.relative(process.cwd(), target)}`);
    } catch (error) {
      console.log(
        `FAILED ${key} (${theme}): ${String(error.message).split("\n")[0]}`,
      );
    }
    await page.keyboard.press("Escape");
  }
  for (const page of pages.values()) await page.context().close();
}
await browser.close();
console.log(
  `${saved} picture(s) written. Now run: npm run screens:check (in web/)`,
);
