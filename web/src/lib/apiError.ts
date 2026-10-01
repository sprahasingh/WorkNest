import { isAxiosError } from "axios";
import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";

export interface ApiErrorDetail {
  path?: (string | number)[];
  message: string;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    // Polymorphic depending on `code` -- Zod issues for VALIDATION_ERROR,
    // but a completely different custom payload for codes like
    // PLAN_DOWNGRADE_BLOCKED or CONFLICT. Kept loose here on purpose;
    // narrowed by callers that know a specific code's real shape.
    details?: unknown[];
  };
}

export interface ParsedApiError {
  code: string | undefined;
  message: string;
  fieldErrors: Record<string, string>;
  details: unknown[];
}

const DEFAULT_ERROR_MESSAGE =
  "Something went wrong. Please refresh the page and try again.";

export function parseApiError(error: unknown): ParsedApiError {
  if (!isAxiosError<ApiErrorBody>(error)) {
    return {
      code: undefined,
      message: DEFAULT_ERROR_MESSAGE,
      fieldErrors: {},
      details: [],
    };
  }

  const body = error.response?.data?.error;
  const fieldErrors: Record<string, string> = {};

  if (body?.code === "VALIDATION_ERROR" && body.details) {
    for (const issue of body.details as ApiErrorDetail[]) {
      const field = issue.path?.join(".");
      if (field) {
        fieldErrors[field] = issue.message;
      }
    }
  }

  return {
    code: body?.code,
    message: body?.message ?? DEFAULT_ERROR_MESSAGE,
    fieldErrors,
    details: body?.details ?? [],
  };
}

export function applyFieldErrors<T extends FieldValues>(
  fieldErrors: Record<string, string>,
  knownFields: readonly FieldPath<T>[],
  setError: UseFormSetError<T>,
): string[] {
  const unmatched: string[] = [];

  for (const [field, message] of Object.entries(fieldErrors)) {
    if ((knownFields as readonly string[]).includes(field)) {
      setError(field as FieldPath<T>, { type: "server", message });
    } else {
      unmatched.push(message);
    }
  }

  return unmatched;
}
