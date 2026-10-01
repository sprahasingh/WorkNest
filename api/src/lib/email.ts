import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(
    (env.BREVO_API_KEY && env.BREVO_FROM) || (env.SMTP_URL && env.SMTP_FROM),
  );
}

export async function sendVerificationEmail(
  recipient: string,
  verificationUrl: string,
  purpose: "registration" | "email-change",
): Promise<void> {
  if (!isEmailDeliveryConfigured()) {
    throw new AppError(
      503,
      "EMAIL_DELIVERY_UNAVAILABLE",
      "Email verification is not configured. Contact your administrator.",
    );
  }

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
          subject,
          textContent: text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      logger.error({ err: error }, "Brevo email request failed");
      throw new AppError(
        503,
        "EMAIL_DELIVERY_FAILED",
        "The verification email could not be sent. Please try again later.",
      );
    }

    if (!response.ok) {
      logger.error(
        { status: response.status },
        "Brevo rejected the verification email",
      );
      throw new AppError(
        503,
        "EMAIL_DELIVERY_FAILED",
        "The verification email could not be sent. Please try again later.",
      );
    }
    return;
  }

  try {
    await nodemailer.createTransport(env.SMTP_URL!).sendMail({
      from: env.SMTP_FROM!,
      to: recipient,
      subject,
      text,
    });
  } catch {
    throw new AppError(
      503,
      "EMAIL_DELIVERY_FAILED",
      "The verification email could not be sent. Please try again later.",
    );
  }
}
