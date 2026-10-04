import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email();

// For passwords being chosen (not the ones being typed to sign in). The
// finer rules (common, patterns, own name or email) live in passwordPolicy
// and run in the service, where the email and name are known.
export const newPasswordSchema = z.string().min(8).max(72);

export const registerSchema = z
  .object({
    accountType: z.enum(["admin", "user"]).default("admin"),
    name: z.string().trim().min(1).max(100),
    email: emailSchema,
    password: newPasswordSchema,
    orgName: z.string().trim().max(80).optional(),
  })
  .superRefine((input, context) => {
    if (
      input.accountType === "admin" &&
      (!input.orgName || input.orgName.length < 2)
    ) {
      context.addIssue({
        code: "custom",
        path: ["orgName"],
        message: "Organization name must be at least 2 characters",
      });
    }
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.union([
  z
    .object({
      identifier: emailSchema,
      password: z.string().min(1),
    })
    .strict(),
  z
    .object({
      email: emailSchema,
      password: z.string().min(1),
    })
    .strict()
    .transform(({ email, password }) => ({ identifier: email, password })),
]);

export type LoginInput = z.infer<typeof loginSchema>;

export const updatePersonalInformationSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    currentPassword: z.string().min(1).max(72).optional(),
    newPassword: newPasswordSchema.optional(),
  })
  .strict()
  .refine((input) => !input.newPassword || !!input.currentPassword, {
    path: ["currentPassword"],
    message: "Enter your current password to set a new one",
  });

export type UpdatePersonalInformationInput = z.infer<
  typeof updatePersonalInformationSchema
>;

export const requestEmailChangeSchema = z
  .object({
    email: emailSchema,
    currentPassword: z.string().min(1).max(72),
  })
  .strict();

export type RequestEmailChangeInput = z.infer<typeof requestEmailChangeSchema>;

export const verifyEmailChangeSchema = z
  .object({ token: z.string().min(1) })
  .strict();

export type VerifyEmailChangeInput = z.infer<typeof verifyEmailChangeSchema>;

// The password chosen at sign-up proves the person clicking the link is the
// one who started the sign-up, not someone who signed up with their email.
export const verifyRegistrationSchema = z
  .object({ token: z.string().min(1), password: z.string().min(1).max(72) })
  .strict();

export type VerifyRegistrationInput = z.infer<typeof verifyRegistrationSchema>;

export const resendVerificationSchema = z
  .object({ email: emailSchema })
  .strict();

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

export const registrationStatusSchema = z
  .object({ signupToken: z.string().min(16).max(200) })
  .strict();

export type RegistrationStatusInput = z.infer<typeof registrationStatusSchema>;

export const requestPasswordResetSchema = z
  .object({ email: emailSchema })
  .strict();

export type RequestPasswordResetInput = z.infer<
  typeof requestPasswordResetSchema
>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: newPasswordSchema,
  })
  .strict();

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
