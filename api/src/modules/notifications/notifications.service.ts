import { Notification } from "../../models/Notification.js";
import { Project } from "../../models/Project.js";
import { getTenantContext, requireTenantId } from "../../tenancy/context.js";

const PAGE_SIZE = 50;

export async function listNotifications(status: "unread" | "all") {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();
  const mine = { userId: context.userId, tenantId };

  const [notifications, unreadCount] = await Promise.all([
    Notification.find(status === "unread" ? { ...mine, readAt: null } : mine)
      .sort({ _id: -1 })
      .limit(PAGE_SIZE)
      .lean(),
    Notification.countDocuments({ ...mine, readAt: null }),
  ]);

  const projectIds = [
    ...new Set(
      notifications
        .map((n) => n.projectId?.toString())
        .filter((id): id is string => !!id),
    ),
  ];
  const projects = await Project.find({ _id: { $in: projectIds } })
    .select("name")
    .lean();
  const projectNames = new Map(projects.map((p) => [String(p._id), p.name]));

  return {
    notifications: notifications.map((n) => ({
      ...n,
      projectName: n.projectId
        ? (projectNames.get(String(n.projectId)) ?? null)
        : null,
    })),
    unreadCount,
  };
}

export async function markNotificationsRead(ids?: string[]) {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();

  const filter: Record<string, unknown> = {
    userId: context.userId,
    tenantId,
    readAt: null,
  };

  if (ids?.length) {
    filter._id = { $in: ids };
  }

  await Notification.updateMany(filter, { readAt: new Date() });
}
