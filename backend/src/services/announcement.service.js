"use strict";

const prisma = require("../config/prisma");
const { actor, fail } = require("./organization.service");
const { notifyUsers } = require("./notification.service");

async function transaction(work) {
  try {
    return await prisma.$transaction(work, { isolationLevel: "ReadCommitted", timeout: 15000 });
  } catch (error) {
    if (["P2002", "P2004", "P2034"].includes(error.code)) {
      fail(409, "Announcement changed or conflict occurred. Reload.", "CONFLICT");
    }
    throw error;
  }
}

async function audit(tx, userId, action, targetId, metadata = {}) {
  await tx.auditLog.create({
    data: {
      actorUserId: userId,
      action,
      success: true,
      targetType: "Announcement",
      targetId,
      metadata,
    },
  });
}

async function getUserDepartmentId(tx, userId) {
  const emp = await tx.employee.findUnique({
    where: { userId },
    include: {
      assignments: {
        where: {
          effectiveFrom: { lte: new Date() },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
        },
        include: { team: true },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
      },
    },
  });
  return emp?.assignments?.[0]?.team?.departmentId || null;
}

async function getTargetUserIds(tx, targetRole, departmentId) {
  const userWhere = { status: "ACTIVE" };
  if (targetRole) {
    userWhere.role = targetRole;
  }

  const activeUsers = await tx.user.findMany({
    where: userWhere,
    select: { id: true },
  });

  let candidateUserIds = activeUsers.map((u) => u.id);

  if (departmentId) {
    const deptAssignments = await tx.organizationAssignment.findMany({
      where: {
        team: { departmentId },
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
      include: {
        employee: { select: { userId: true } },
      },
    });

    const deptUserIds = new Set(deptAssignments.map((a) => a.employee?.userId).filter(Boolean));
    candidateUserIds = candidateUserIds.filter((id) => deptUserIds.has(id));
  }

  return candidateUserIds;
}

function view(a, currentUserId, isManagement = false) {
  const readInfo = a.reads?.[0];
  const isRead = Boolean(readInfo);
  const readAt = readInfo?.readAt ? readInfo.readAt.toISOString() : null;

  const data = {
    id: a.id,
    title: a.title,
    content: a.content,
    priority: a.priority,
    status: a.status,
    targetRole: a.targetRole,
    departmentId: a.departmentId,
    departmentName: a.department?.name || null,
    pinned: a.pinned,
    author: a.author
      ? { id: a.author.id, displayName: a.author.displayName }
      : null,
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    isRead,
    readAt,
  };

  if (isManagement) {
    data.readCount = a._count?.reads ?? (a.reads?.length || 0);
  }

  return data;
}

async function listAnnouncements(userId, filters = {}, isManagement = false) {
  return transaction(async (tx) => {
    const user = await actor(tx, userId, isManagement);

    const { page = 1, pageSize = 20, search, priority, status, unreadOnly = false } = filters;
    const now = new Date();

    const where = {};

    if (isManagement) {
      if (status) {
        where.status = status;
      }
    } else {
      where.status = "PUBLISHED";
      where.publishedAt = { lte: now };
      where.OR = [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ];

      const roleConditions = [
        { targetRole: null },
        { targetRole: user.role },
      ];

      const userDeptId = await getUserDepartmentId(tx, userId);
      const deptConditions = [
        { departmentId: null },
      ];
      if (userDeptId) {
        deptConditions.push({ departmentId: userDeptId });
      }

      where.AND = [
        { OR: roleConditions },
        { OR: deptConditions },
      ];
    }

    if (priority) {
      where.priority = priority;
    }

    if (search) {
      where.OR = [
        ...(where.OR || []),
        { title: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
      ];
    }

    if (!isManagement && unreadOnly) {
      where.reads = {
        none: { userId },
      };
    }

    const [announcements, total] = await Promise.all([
      tx.announcement.findMany({
        where,
        include: {
          author: { select: { id: true, displayName: true } },
          department: { select: { id: true, name: true } },
          reads: {
            where: { userId },
            select: { readAt: true },
          },
          ...(isManagement ? { _count: { select: { reads: true } } } : {}),
        },
        orderBy: [
          { pinned: "desc" },
          { publishedAt: "desc" },
          { createdAt: "desc" },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      tx.announcement.count({ where }),
    ]);

    return {
      announcements: announcements.map((a) => view(a, userId, isManagement)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  });
}

async function getAnnouncement(userId, id) {
  return transaction(async (tx) => {
    const user = await actor(tx, userId, false);
    const isMgmt = ["ADMIN", "HR"].includes(user.role);

    const announcement = await tx.announcement.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, displayName: true } },
        department: { select: { id: true, name: true } },
        reads: {
          where: { userId },
          select: { readAt: true },
        },
        ...(isMgmt ? { _count: { select: { reads: true } } } : {}),
      },
    });

    if (!announcement) {
      fail(404, "Announcement not found.", "NOT_FOUND");
    }

    if (!isMgmt) {
      if (announcement.status !== "PUBLISHED") {
        fail(404, "Announcement not found.", "NOT_FOUND");
      }
      if (announcement.publishedAt && announcement.publishedAt > new Date()) {
        fail(404, "Announcement not found.", "NOT_FOUND");
      }
      if (announcement.expiresAt && announcement.expiresAt <= new Date()) {
        fail(404, "Announcement expired.", "EXPIRED");
      }
      if (announcement.targetRole && announcement.targetRole !== user.role) {
        fail(403, "Access to announcement restricted.", "FORBIDDEN");
      }
      if (announcement.departmentId) {
        const userDeptId = await getUserDepartmentId(tx, userId);
        if (announcement.departmentId !== userDeptId) {
          fail(403, "Access to announcement restricted.", "FORBIDDEN");
        }
      }
    }

    return view(announcement, userId, isMgmt);
  });
}

async function markAnnouncementRead(userId, id) {
  return transaction(async (tx) => {
    await actor(tx, userId, false);

    const announcement = await tx.announcement.findUnique({ where: { id } });
    if (!announcement) {
      fail(404, "Announcement not found.", "NOT_FOUND");
    }

    const read = await tx.announcementRead.upsert({
      where: {
        announcementId_userId: {
          announcementId: id,
          userId,
        },
      },
      create: {
        announcementId: id,
        userId,
        readAt: new Date(),
      },
      update: {},
    });

    return {
      success: true,
      announcementId: id,
      readAt: read.readAt.toISOString(),
    };
  });
}

async function markAllAnnouncementsRead(userId) {
  return transaction(async (tx) => {
    const user = await actor(tx, userId, false);
    const now = new Date();

    const roleConditions = [{ targetRole: null }, { targetRole: user.role }];
    const userDeptId = await getUserDepartmentId(tx, userId);
    const deptConditions = [{ departmentId: null }];
    if (userDeptId) deptConditions.push({ departmentId: userDeptId });

    const visible = await tx.announcement.findMany({
      where: {
        status: "PUBLISHED",
        publishedAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        AND: [{ OR: roleConditions }, { OR: deptConditions }],
        reads: { none: { userId } },
      },
      select: { id: true },
    });

    if (visible.length > 0) {
      await tx.announcementRead.createMany({
        data: visible.map((v) => ({
          announcementId: v.id,
          userId,
          readAt: now,
        })),
        skipDuplicates: true,
      });
    }

    return { success: true, count: visible.length };
  });
}

async function createAnnouncement(userId, input) {
  return transaction(async (tx) => {
    const user = await actor(tx, userId, true);

    if (input.departmentId) {
      const dept = await tx.organizationUnit.findUnique({
        where: { id: input.departmentId },
      });
      if (!dept || dept.kind !== "DEPARTMENT" || dept.archivedAt) {
        fail(400, "Select an active department.", "INVALID_DEPARTMENT");
      }
    }

    const isPublished = input.status === "PUBLISHED";
    const publishedAt = isPublished ? new Date() : null;

    const record = await tx.announcement.create({
      data: {
        title: input.title,
        content: input.content,
        priority: input.priority || "NORMAL",
        status: input.status || "PUBLISHED",
        targetRole: input.targetRole || null,
        departmentId: input.departmentId || null,
        pinned: Boolean(input.pinned),
        authorUserId: user.id,
        publishedAt,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
      include: {
        author: { select: { id: true, displayName: true } },
        department: { select: { id: true, name: true } },
      },
    });

    await audit(tx, user.id, "ANNOUNCEMENT_CREATED", record.id, {
      title: record.title,
      status: record.status,
      priority: record.priority,
    });

    if (isPublished) {
      const recipientUserIds = await getTargetUserIds(
        tx,
        record.targetRole,
        record.departmentId
      );

      await notifyUsers(tx, recipientUserIds, {
        actorUserId: user.id,
        title: record.pinned ? `📌 Pinned: ${record.title}` : `New Announcement: ${record.title}`,
        message: record.title,
        type: "ANNOUNCEMENT",
        link: "/announcements",
      });
    }

    return view(record, userId, true);
  });
}

async function updateAnnouncement(userId, id, input) {
  return transaction(async (tx) => {
    const user = await actor(tx, userId, true);

    const existing = await tx.announcement.findUnique({ where: { id } });
    if (!existing) {
      fail(404, "Announcement not found.", "NOT_FOUND");
    }

    if (input.departmentId) {
      const dept = await tx.organizationUnit.findUnique({
        where: { id: input.departmentId },
      });
      if (!dept || dept.kind !== "DEPARTMENT" || dept.archivedAt) {
        fail(400, "Select an active department.", "INVALID_DEPARTMENT");
      }
    }

    const becomingPublished =
      existing.status !== "PUBLISHED" && input.status === "PUBLISHED";
    const publishedAt = becomingPublished
      ? new Date()
      : (input.status === "DRAFT" ? null : existing.publishedAt);

    const updated = await tx.announcement.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.targetRole !== undefined ? { targetRole: input.targetRole } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.expiresAt !== undefined
          ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }
          : {}),
        publishedAt,
      },
      include: {
        author: { select: { id: true, displayName: true } },
        department: { select: { id: true, name: true } },
        _count: { select: { reads: true } },
      },
    });

    await audit(tx, user.id, "ANNOUNCEMENT_UPDATED", updated.id, {
      title: updated.title,
      status: updated.status,
      priority: updated.priority,
    });

    if (becomingPublished) {
      const recipientUserIds = await getTargetUserIds(
        tx,
        updated.targetRole,
        updated.departmentId
      );

      await notifyUsers(tx, recipientUserIds, {
        actorUserId: user.id,
        title: updated.pinned ? `📌 Pinned: ${updated.title}` : `New Announcement: ${updated.title}`,
        message: updated.title,
        type: "ANNOUNCEMENT",
        link: "/announcements",
      });
    }

    return view(updated, userId, true);
  });
}

async function deleteAnnouncement(userId, id) {
  return transaction(async (tx) => {
    const user = await actor(tx, userId, true);

    const existing = await tx.announcement.findUnique({ where: { id } });
    if (!existing) {
      fail(404, "Announcement not found.", "NOT_FOUND");
    }

    await tx.announcement.delete({ where: { id } });

    await audit(tx, user.id, "ANNOUNCEMENT_DELETED", id, {
      title: existing.title,
    });

    return { success: true };
  });
}

async function getAcknowledgements(userId, id) {
  return transaction(async (tx) => {
    await actor(tx, userId, true);

    const announcement = await tx.announcement.findUnique({ where: { id } });
    if (!announcement) {
      fail(404, "Announcement not found.", "NOT_FOUND");
    }

    const reads = await tx.announcementRead.findMany({
      where: { announcementId: id },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
            role: true,
            employee: { select: { id: true, employeeCode: true, fullName: true } },
          },
        },
      },
      orderBy: { readAt: "desc" },
    });

    return {
      announcementId: id,
      title: announcement.title,
      totalReads: reads.length,
      acknowledgements: reads.map((r) => ({
        userId: r.user.id,
        displayName: r.user.displayName,
        email: r.user.email,
        role: r.user.role,
        employeeCode: r.user.employee?.employeeCode || null,
        fullName: r.user.employee?.fullName || null,
        readAt: r.readAt.toISOString(),
      })),
    };
  });
}

module.exports = {
  listAnnouncements,
  getAnnouncement,
  markAnnouncementRead,
  markAllAnnouncementsRead,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getAcknowledgements,
};
