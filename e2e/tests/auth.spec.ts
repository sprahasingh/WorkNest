import { expect, test, type Page } from "@playwright/test";
import { latestLink } from "./mail";

const PASSWORD = "Moonlit-harbor-42";
const unique = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function fillRegisterForm(
  page: Page,
  email: string,
  password = PASSWORD,
) {
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Test Person");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Type your password again").fill(password);
  await page.getByLabel("Organization name").fill("E2E Org");
}

test("suggests a fix for a mistyped email and refuses a common password", async ({
  page,
}) => {
  await fillRegisterForm(page, "someone@gmial.com", "Password123");
  await page.getByLabel("Your name").click(); // leave the email field
  const hint = page.getByRole("button", { name: "someone@gmail.com" });
  await expect(hint).toBeVisible();
  await hint.click();
  await expect(page.getByLabel("Email")).toHaveValue("someone@gmail.com");

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("commonly used")).toBeVisible();
});

test("signs the first device in after the link is opened elsewhere", async ({
  page,
  browser,
}) => {
  const email = `flow-${unique()}@e2e.test`;
  await fillRegisterForm(page, email);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();

  // Open the link in a different browser, like a phone would.
  const link = await latestLink(email);
  const other = await browser.newContext();
  const phone = await other.newPage();
  await phone.goto(link);
  await phone.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await phone.getByRole("button", { name: "Confirm and continue" }).click();
  await expect(phone).not.toHaveURL(/verify-email/);

  // The first page notices on its own.
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeHidden({
    timeout: 20_000,
  });
  await other.close();
});

test("says the email isn't confirmed instead of 'invalid password'", async ({
  page,
}) => {
  const email = `pending-${unique()}@e2e.test`;
  await fillRegisterForm(page, email);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(
    page.getByText("You haven't confirmed your email yet."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Send a new link/ }),
  ).toBeVisible();

  // A wrong password still gets the ordinary message.
  await page.getByLabel("Password", { exact: true }).fill("Some-other-pass-9");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
});

test("lists this device under Settings", async ({ page }) => {
  const email = `devices-${unique()}@e2e.test`;
  await fillRegisterForm(page, email);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.goto(await latestLink(email));
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Confirm and continue" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/verify-email"));

  await expect(page).toHaveURL(/\/orgs\/\w+\/dashboard/);
  await page.goto(page.url().replace("/dashboard", "/settings"));
  await expect(page.getByText("Where you're signed in")).toBeVisible();
  await expect(page.getByText("This device", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Log out of this device" }),
  ).toBeVisible();
});
