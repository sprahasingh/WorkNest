import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import {
  registerAndVerify,
  signupInviteAndVerify,
  takeInvitationToken,
  takeVerificationToken,
} from "./emailDeliveryMock.js";
import mongoose from "mongoose";
import { Task } from "../src/models/Task.js";
import { Organization } from "../src/models/Organization.js";

const app = createApp();

async function registerOrg(email: string, orgName: string) {
  const res = await registerAndVerify(app, {
    name: "Admin User",
    email,
    password: "password123",
    orgName,
  });
  const accessToken = res.body.accessToken as string;
  const refreshCookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);
  return {
    accessToken,
    refreshCookie,
    orgId: me.body.memberships[0].tenantId.id as string,
    userId: me.body.user.id as string,
  };
}

async function addMember(
  orgId: string,
  adminToken: string,
  email: string,
  role: "member" | "manager" = "member",
) {
  await request(app)
    .post(`/api/orgs/${orgId}/invites`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ email, role });
  const token = takeInvitationToken(email);
  const signup = await signupInviteAndVerify(app, token, email, {
    name: `User ${email}`,
    password: "password123",
  });
  const accessToken = signup.body.accessToken as string;
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);
  return { accessToken, userId: me.body.user.id as string };
}

async function createProject(orgId: string, token: string, key: string) {
  const res = await request(app)
    .post(`/api/orgs/${orgId}/projects`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Project ${key}`, key });
  return res.body.project._id as string;
}

async function createTask(
  orgId: string,
  projectId: string,
  token: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`/api/orgs/${orgId}/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

describe("personal information", () => {
  it("updates profile and password after verifying the current password", async () => {
    const account = await registerOrg("profile@example.com", "Profile Org");
    expect(account.refreshCookie).toBeTruthy();

    const updated = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${account.accessToken}`)
      .set("Cookie", account.refreshCookie!)
      .send({
        name: "Updated Person",
        currentPassword: "password123",
        newPassword: "new-password-456",
      });

    expect(updated.status).toBe(200);
    expect(updated.body.user).toMatchObject({ name: "Updated Person" });
    expect(updated.body.user.passwordHash).toBeUndefined();

    const changeRequest = await request(app)
      .post("/api/auth/me/email-change")
      .set("Authorization", `Bearer ${account.accessToken}`)
      .send({
        email: "updated@example.com",
        currentPassword: "new-password-456",
      });
    expect(changeRequest.status).toBe(202);
    expect(changeRequest.body.user).toMatchObject({
      email: "profile@example.com",
      pendingEmail: "updated@example.com",
    });
    const token = takeVerificationToken("updated@example.com", "email-change");

    const emailVerified = await request(app)
      .post("/api/auth/verify-email-change")
      .send({ token });
    expect(emailVerified.status).toBe(200);
    expect(emailVerified.body.user.email).toBe("updated@example.com");
    expect(emailVerified.body.user.emailChangeTokenHash).toBeUndefined();

    const newCredentials = await request(app).post("/api/auth/login").send({
      identifier: "updated@example.com",
      password: "new-password-456",
    });
    expect(newCredentials.status).toBe(200);

    const refresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", account.refreshCookie!);
    expect(refresh.status).toBe(200);
  });

  it("renames without a password, rejects a wrong current password, and a duplicate email", async () => {
    const first = await registerOrg("first-profile@example.com", "First Org");
    await registerOrg("taken-profile@example.com", "Second Org");

    // A new name alone doesn't need the password.
    const renamed = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${first.accessToken}`)
      .send({ name: "Changed Person" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.user.name).toBe("Changed Person");

    const incorrectPassword = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${first.accessToken}`)
      .send({
        name: "Changed Person",
        currentPassword: "wrong-password",
        newPassword: "another-password-1",
      });
    expect(incorrectPassword.status).toBe(401);
    expect(incorrectPassword.body.error.code).toBe("CURRENT_PASSWORD_INVALID");

    const duplicateEmail = await request(app)
      .post("/api/auth/me/email-change")
      .set("Authorization", `Bearer ${first.accessToken}`)
      .send({
        email: "taken-profile@example.com",
        currentPassword: "password123",
      });
    expect(duplicateEmail.status).toBe(409);
    expect(duplicateEmail.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("cancels a pending email change and invalidates its verification link", async () => {
    const account = await registerOrg("cancel-email@example.com", "Cancel Org");
    const changeRequest = await request(app)
      .post("/api/auth/me/email-change")
      .set("Authorization", `Bearer ${account.accessToken}`)
      .send({
        email: "cancelled@example.com",
        currentPassword: "password123",
      });
    expect(changeRequest.status).toBe(202);
    const token = takeVerificationToken(
      "cancelled@example.com",
      "email-change",
    );

    const canceled = await request(app)
      .delete("/api/auth/me/email-change")
      .set("Authorization", `Bearer ${account.accessToken}`);

    expect(canceled.status).toBe(200);
    expect(canceled.body.user).toMatchObject({
      email: "cancel-email@example.com",
      pendingEmail: null,
    });

    const staleVerification = await request(app)
      .post("/api/auth/verify-email-change")
      .send({ token });
    expect(staleVerification.status).toBe(400);
    expect(staleVerification.body.error.code).toBe(
      "EMAIL_VERIFICATION_INVALID",
    );
  });

  it("updates email immediately for configured verification-bypass addresses", async () => {
    const account = await registerOrg("bypass-owner@example.com", "Bypass Org");
    const originalBypassEmails = env.EMAIL_VERIFICATION_BYPASS_EMAILS;
    env.EMAIL_VERIFICATION_BYPASS_EMAILS = ["demo-change@example.com"];

    try {
      const response = await request(app)
        .post("/api/auth/me/email-change")
        .set("Authorization", `Bearer ${account.accessToken}`)
        .send({
          email: "DEMO-CHANGE@example.com",
          currentPassword: "password123",
        });

      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({
        email: "demo-change@example.com",
        pendingEmail: null,
      });
      expect(() =>
        takeVerificationToken("demo-change@example.com", "email-change"),
      ).toThrow("No email-change verification email was sent");
    } finally {
      env.EMAIL_VERIFICATION_BYPASS_EMAILS = originalBypassEmails;
    }
  });
});

describe("account deletion", () => {
  it("blocks a sole admin with teammates, then frees the email for re-registration", async () => {
    const admin = await registerOrg("leaver@example.com", "Leaver Org");
    const member = await addMember(
      admin.orgId,
      admin.accessToken,
      "stayer@example.com",
    );

    const blocked = await request(app)
      .delete("/api/auth/me")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("SOLE_ADMIN");

    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "DEL",
    );
    const task = await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Handover",
      assigneeIds: [member.userId],
    });

    const deleted = await request(app)
      .delete("/api/auth/me")
      .set("Authorization", `Bearer ${member.accessToken}`);
    expect(deleted.status).toBe(204);

    const after = await request(app)
      .get(`/api/orgs/${admin.orgId}/tasks/${task.body.task._id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(after.body.task.assigneeIds).toEqual([]);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "stayer@example.com", password: "password123" });
    expect(login.status).toBe(401);

    const again = await registerAndVerify(app, {
      name: "Back Again",
      email: "stayer@example.com",
      password: "password123",
      orgName: "Fresh Start",
    });
    expect(again.status).toBe(201);
  });

  it("deletes a workspace that would be left with no members", async () => {
    const solo = await registerOrg("solo@example.com", "Solo Org");
    const projectId = await createProject(solo.orgId, solo.accessToken, "SOL");
    await createTask(solo.orgId, projectId, solo.accessToken, {
      title: "Only mine",
    });

    const deleted = await request(app)
      .delete("/api/auth/me")
      .set("Authorization", `Bearer ${solo.accessToken}`);
    expect(deleted.status).toBe(204);

    expect(await Organization.exists({ _id: solo.orgId })).toBeNull();
    expect(
      await Task.collection.countDocuments({
        tenantId: new mongoose.Types.ObjectId(solo.orgId),
      }),
    ).toBe(0);
  });
});
