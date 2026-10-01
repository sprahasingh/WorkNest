import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(env.SMTP_URL && env.SMTP_FROM);
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

  try {
    const registration = purpose === "registration";
    await nodemailer.createTransport(env.SMTP_URL!).sendMail({
      from: env.SMTP_FROM!,
      to: recipient,
      subject: registration
        ? "Verify your WorkNest email address"
        : "Confirm your WorkNest email address",
      text: [
        registration
          ? "Verify your email address to finish creating your WorkNest account."
          : "A request was made to change the email address on your WorkNest account.",
        "",
        `Use this link to ${registration ? "verify your email" : "confirm the change"}: ${verificationUrl}`,
        "",
        registration
          ? "This link expires in one hour. If you did not request this account, you can ignore this email."
          : "This link expires in one hour. If you did not request this change, you can ignore this email.",
      ].join("\n"),
    });
  } catch {
    throw new AppError(
      503,
      "EMAIL_DELIVERY_FAILED",
      "The verification email could not be sent. Please try again later.",
    );
  }
}
