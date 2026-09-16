import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "../lib/errors.js";

export interface TenantContext {
  tenantId: string;
  userId: string;
  role?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(
  context: TenantContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return storage.run(context, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function requireTenantId(): string {
  const context = storage.getStore();
  if (!context) {
    throw new AppError(
      500,
      "TENANT_CONTEXT_MISSING",
      "No tenant context available for this operation",
    );
  }
  return context.tenantId;
}
