# Screenshot tools

These scripts build the demo organization (Sunshine) and retake every product screenshot, so the pictures on the landing page, in the "How to use" guide and in the main README can be regenerated instead of drawn by hand.

Where the pictures live, and how the site uses them, is explained in [web/src/assets/screens/README.md](../../web/src/assets/screens/README.md).

## What you need

- A throwaway MongoDB database (the demo script renames the seeded Acme organization, so don't point it at real data).
- The API and the web app running locally, both talking to that database.
- Node, and a Chromium or Chrome browser. Set `BROWSER` to its path if Playwright doesn't find one.

## Steps

```bash
# 1. In api/: start from an empty database and add the seed accounts
cd api
npm run seed

# 2. Start the API (npm run dev in api/) and the web app (npm run dev in web/)

# 3. Install these tools once
cd tools/screenshots
npm install

# 4. Build the Sunshine organization
MONGODB_URI="<the same URI the API uses>" npm run demo

# 5. Restart the API, then take the pictures (see "Good to know" if it stops at sign-in)
npm run capture

# 6. Check everything is in place, and refresh the README
cd ../../web
npm run screens:check
npm run screens:readme
```

`npm run capture` writes straight into `web/src/assets/screens/<section>/`. To look at the result before replacing anything, add `--out ./preview`. To retake one picture:

```bash
npm run capture -- --only tasks/board,phone/01-dashboard
npm run capture -- --theme dark
```

## Good to know

- The API limits sign-ins and requests per IP address, and a full run comes close to those limits. Restart the API after `npm run demo`, and if a run stops at the sign-in page, restart it again and capture one theme at a time (`npm run capture -- --theme light`, restart, then `--theme dark`).
- Dates in the demo are relative to today, so a retake always looks current. The meeting that "starts in a few minutes" is created a few minutes before you run the demo script, so take the pictures soon after.
- The names typed into forms (the new project, the invited email, the search word) are in the `DEMO` block at the top of `capture.mjs`.
- The people, projects, tasks, chat and meetings are in `demo-data.mjs`. Change the data there and run steps 1 to 5 again.
