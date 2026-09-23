import mongoose from "mongoose";
import { AuditLog } from "../../models/AuditLog.js";
import { getTenantContext } from "../../tenancy/context.js";

export interface RecordAuditInput {
  action: string;
  entityType: string;
  entityId: string | mongoose.Types.ObjectId;
  metadata?: Record<string, unknown>;
  tenantId?: string | mongoose.Types.ObjectId;
  actorId?: string | mongoose.Types.ObjectId;
}

export async function recordAudit(
  input: RecordAuditInput,
  dbSession: mongoose.ClientSession,
): Promise<void> {
  const context = getTenantContext();
  const tenantId = input.tenantId ?? context?.tenantId;
  const actorId = input.actorId ?? context?.userId;

  if (!tenantId || !actorId) {
    throw new Error(
      "recordAudit requires a tenant context or an explicit tenantId/actorId override",
    );
  }

  const entry = new AuditLog({
    tenantId,
    actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? {},
  });

  entry.$locals.skipTenant = true;
  await entry.save({ session: dbSession });
}
