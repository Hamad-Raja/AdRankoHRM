"use strict";

const prisma = require("../config/prisma");
const { actor, fail } = require("./organization.service");

async function transaction(work) {
  try {
    return await prisma.$transaction(work, { isolationLevel: "ReadCommitted", timeout: 15000 });
  } catch (error) {
    if (["P2002", "P2004", "P2034"].includes(error.code)) {
      fail(409, "Notification conflict. Please try again.", "CONFLICT");
    }
    throw error;
  }
}

/**
 * Low-level notification helper to be called inside or outside transactions.
 */
async function createNotification(client, { userId, actorUserId, title, message, type = "INFO", link }) {
  return client.notification.create({
    data: {
      userId,
      actorUserId: actorUserId || null,
      title,
      message,
      type,
      link: link || null,
    },
  });
}

/**
 * Bulk create notifications for multiple users.
 */
async function notifyUsers(client, userIds, { actorUserId, title, message, type = "INFO", link }) {
  const uniqueIds = Array.from(new Set(userIds)).filter(Boolean);
  if (uniqueIds.length === 0) return { count: 0 };

  const data = uniqueIds.map((userId) => ({
    userId,
    actorUserId: actorUserId || null,
    title,
    message,
    type,
    link: link || null,
  }));

  return client.notification.createMany({ data });
}

/**
 * Notify all active users matching given roles.
 */
async function notifyRole(client, roles, payload) {
  const targetRoles = Array.isArray(roles) ? roles : [roles];
  const users = await client.user.findMany({
    where: {
      role: { in: targetRoles },
      status: "ACTIVE",
    },
    select: { id: true },
  });

  return notifyUsers(client, users.map((u) => u.id), payload);
}

function view(n) {
  return {
    id: n.id,
    title: n.title,
    message: n.message,
    type: n.type,
    link: n.link,
    isRead: n.isRead,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    actor: n.actor ? { id: n.actor.id, displayName: n.actor.displayName } : null,
  };
}

async function listNotifications(userId, filters = {}) {
  return transaction(async (tx) => {
    await actor(tx, userId, false);

    const { page = 1, pageSize = 20, unreadOnly = false, type } = filters;
    const where = { userId };

    if (unreadOnly) {
      where.isRead = false;
    }

    if (type) {
      where.type = type;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      tx.notification.findMany({
        where,
        include: { actor: { select: { id: true, displayName: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      tx.notification.count({ where }),
      tx.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      notifications: notifications.map(view),
      total,
      unreadCount,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  });
}

async function getUnreadCount(userId) {
  return transaction(async (tx) => {
    await actor(tx, userId, false);
    const unreadCount = await tx.notification.count({
      where: { userId, isRead: false },
    });
    return { unreadCount };
  });
}

async function markAsRead(userId, id) {
  return transaction(async (tx) => {
    await actor(tx, userId, false);

    const existing = await tx.notification.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      fail(404, "Notification not found.", "NOT_FOUND");
    }

    if (!existing.isRead) {
      const updated = await tx.notification.update({
        where: { id },
        data: { isRead: true, readAt: new Date() },
      });
      return view(updated);
    }

    return view(existing);
  });
}

async function markAllAsRead(userId) {
  return transaction(async (tx) => {
    await actor(tx, userId, false);

    const now = new Date();
    const result = await tx.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: now },
    });

    return { success: true, updatedCount: result.count };
  });
}

async function deleteNotification(userId, id) {
  return transaction(async (tx) => {
    await actor(tx, userId, false);

    const existing = await tx.notification.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      fail(404, "Notification not found.", "NOT_FOUND");
    }

    await tx.notification.delete({ where: { id } });
    return { success: true };
  });
}

async function clearReadNotifications(userId) {
  return transaction(async (tx) => {
    await actor(tx, userId, false);

    const result = await tx.notification.deleteMany({
      where: { userId, isRead: true },
    });

    return { success: true, deletedCount: result.count };
  });
}

module.exports = {
  createNotification,
  notifyUsers,
  notifyRole,
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
};
