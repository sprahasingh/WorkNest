import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(
    (env.BREVO_API_KEY && env.BREVO_FROM) || (env.SMTP_URL && env.SMTP_FROM),
  );
}

export interface EmailAttachment {
  name: string;
  // Base64, as both Brevo and nodemailer take it.
  content: string;
}

async function sendEmail(
  recipient: string,
  subject: string,
  text: string,
  purpose:
    | "verification"
    | "password reset"
    | "invitation"
    | "email change notice"
    | "feedback"
    | "plan reminder",
  replyTo?: string,
  attachment?: EmailAttachment,
): Promise<void> {
  // Names can come from people, so line breaks are never allowed in a subject.
  subject = subject.replace(/[\r\n]+/g, " ");
  if (!isEmailDeliveryConfigured()) {
    throw new AppError(
      503,
      "EMAIL_DELIVERY_UNAVAILABLE",
      `Email ${purpose} is not configured. Contact your administrator.`,
    );
  }

  if (env.BREVO_API_KEY && env.BREVO_FROM) {
    let response: Response;
    try {
      response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": env.BREVO_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: { email: env.BREVO_FROM, name: "WorkNest" },
          to: [{ email: recipient }],
          ...(replyTo ? { replyTo: { email: replyTo } } : {}),
          subject,
          textContent: text,
          ...(attachment
            ? {
                attachment: [
                  { name: attachment.name, content: attachment.content },
                ],
              }
            : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      logger.error({ err: error }, `Brevo ${purpose} email request failed`);
      throw new AppError(
        503,
        "EMAIL_DELIVERY_FAILED",
        `The ${purpose} email could not be sent. Please try again later.`,
      );
    }

    if (!response.ok) {
      logger.error(
        { status: response.status },
        `Brevo rejected the ${purpose} email`,
      );
      throw new AppError(
        503,
        "EMAIL_DELIVERY_FAILED",
        `The ${purpose} email could not be sent. Please try again later.`,
      );
    }
    return;
  }

  try {
    await nodemailer.createTransport(env.SMTP_URL!).sendMail({
      from: env.SMTP_FROM!,
      to: recipient,
      ...(replyTo ? { replyTo } : {}),
      subject,
      text,
      ...(attachment
        ? {
            attachments: [
              {
                filename: attachment.name,
                content: Buffer.from(attachment.content, "base64"),
              },
            ],
          }
        : {}),
    });
  } catch {
    throw new AppError(
      503,
      "EMAIL_DELIVERY_FAILED",
      `The ${purpose} email could not be sent. Please try again later.`,
    );
  }
}

export async function sendVerificationEmail(
  recipient: string,
  verificationUrl: string,
  purpose: "registration" | "email-change",
): Promise<void> {
  const registration = purpose === "registration";
  const subject = registration
    ? "Verify your WorkNest email address"
    : "Confirm your WorkNest email address";
  const text = [
    registration
      ? "Verify your email address to finish creating your WorkNest account."
      : "A request was made to change the email address on your WorkNest account.",
    "",
    `Use this link to ${registration ? "verify your email" : "confirm the change"}: ${verificationUrl}`,
    "",
    registration
      ? "This link expires in one hour. If you did not request this account, you can ignore this email."
      : "This link expires in one hour. If you did not request this change, you can ignore this email.",
  ].join("\n");

  await sendEmail(recipient, subject, text, "verification");
}

export async function sendPasswordResetEmail(
  recipient: string,
  resetUrl: string,
): Promise<void> {
  const text = [
    "A request was made to reset your WorkNest password.",
    "",
    `Use this link to choose a new password: ${resetUrl}`,
    "",
    "This link expires in one hour and can only be used once. If you did not request a reset, you can ignore this email.",
  ].join("\n");

  await sendEmail(
    recipient,
    "Reset your WorkNest password",
    text,
    "password reset",
  );
}

export async function sendEmailChangedNotice(
  previousEmail: string,
  newEmail: string,
): Promise<void> {
  const text = [
    `The email address on your WorkNest account was changed to ${newEmail}.`,
    "",
    "If you made this change, there's nothing else to do. If you didn't, reset your password straight away and contact your workspace admin.",
  ].join("\n");

  await sendEmail(
    previousEmail,
    "Your WorkNest email address was changed",
    text,
    "email change notice",
  );
}

export async function sendInviteEmail(
  recipient: string,
  organizationName: string,
  role: string,
  inviteUrl: string,
): Promise<void> {
  const text = [
    `You've been invited to join ${organizationName} on WorkNest as a ${role}.`,
    "",
    `Accept your invitation: ${inviteUrl}`,
    "",
    "This invitation expires in seven days. If you weren't expecting it, you can ignore this email.",
  ].join("\n");

  await sendEmail(
    recipient,
    `You're invited to join ${organizationName} on WorkNest`,
    text,
    "invitation",
  );
}

export async function sendPlanRenewalEmail(
  recipient: string,
  organizationName: string,
  planName: string,
  stage: "7d" | "1d" | "expired",
  endsOn: string,
  settingsUrl: string,
): Promise<void> {
  const expired = stage === "expired";
  const subject = expired
    ? `Your ${planName} plan for ${organizationName} has ended`
    : `Your ${planName} plan for ${organizationName} ends on ${endsOn}`;
  const text = [
    expired
      ? `The ${planName} plan for ${organizationName} on WorkNest ended on ${endsOn}, so the workspace is back on Free.`
      : `The ${planName} plan for ${organizationName} on WorkNest ends on ${endsOn}, after which the workspace goes back to Free.`,
    "",
    expired
      ? "If it now uses more than Free allows, it is paused until you renew or remove the extra projects, tasks or members."
      : "Renew before then to keep your limits and avoid any pause.",
    "",
    `Renew here: ${settingsUrl}`,
  ].join("\n");

  await sendEmail(recipient, subject, text, "plan reminder");
}

// Feedback typed into the app, sent to the address set in FEEDBACK_TO_EMAIL.
// Replying to the email answers the person who wrote it, when they left an
// address.
export async function sendFeedbackEmail(input: {
  to: string;
  message: string;
  senderName: string | null;
  senderEmail: string | null;
  page: string | null;
  attachment?: EmailAttachment;
}): Promise<void> {
  const who =
    input.senderName && input.senderEmail
      ? `${input.senderName} (${input.senderEmail})`
      : (input.senderName ??
        input.senderEmail ??
        "Someone who didn't leave a name");
  const text = [
    input.message,
    "",
    "---",
    `Sent by: ${who}`,
    ...(input.page ? [`Page: ${input.page}`] : []),
  ].join("\n");

  await sendEmail(
    input.to,
    "WorkNest feedback",
    text,
    "feedback",
    input.senderEmail ?? undefined,
    input.attachment,
  );
}
