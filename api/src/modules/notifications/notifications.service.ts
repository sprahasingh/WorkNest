import { Notification } from "../../models/Notification.js";
import { getTenantContext, requireTenantId } from "../../tenancy/context.js";

export async function getUnreadNotifications() {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();

  return Notification.find({
    userId: context.userId,
    tenantId,
    readAt: null,
  })
    .sort({ _id: -1 })
    .limit(50)
    .lean();
}

export async function markNotificationsRead(ids?: string[]) {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();
  const now = new Date();

  const filter: Record<string, unknown> = {
    userId: context.userId,
    tenantId,
    readAt: null,
  };

  if (ids?.length) {
    filter._id = { $in: ids };
  }

  await Notification.updateMany(filter, { readAt: now });
}
