import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email();

export const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: emailSchema,
    password: z.string().min(8).max(72),
    orgName: z.string().trim().min(2).max(80),
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
    currentPassword: z.string().min(1).max(72),
    newPassword: z.string().min(8).max(72).optional(),
  })
  .strict();

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

export const verifyRegistrationSchema = z
  .object({ token: z.string().min(1) })
  .strict();

export type VerifyRegistrationInput = z.infer<typeof verifyRegistrationSchema>;

export const requestPasswordResetSchema = z
  .object({ email: emailSchema })
  .strict();

export type RequestPasswordResetInput = z.infer<
  typeof requestPasswordResetSchema
>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8).max(72),
  })
  .strict();

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
