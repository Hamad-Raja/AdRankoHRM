const prisma = require("../config/prisma");

async function logout(auth, context = {}) {
  await prisma.$transaction(async (tx) => {
    const result = await tx.userSession.updateMany({
      where: {
        id: auth.session.id,
        userId: auth.user.id,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    if (result.count > 0) {
      await tx.auditLog.create({
        data: {
          actorUserId: auth.user.id,
          action: "LOGOUT",
          success: true,
          targetType: "UserSession",
          targetId: auth.session.id,
          ipAddress: context.ipAddress || null,
          userAgent: context.userAgent || null,
        },
      });
    }
  });
}

module.exports = {
  logout,
};