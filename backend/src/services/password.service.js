const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

const {
  hashPassword,
  verifyPassword,
} = require("../utils/password");

const {
  SESSION_IDLE_TIMEOUT_MS,
} = require("../config/auth");

const MAX_TRANSACTION_ATTEMPTS = 3;

function sessionError() {
  return new ApiError(
    401,
    "Please log in again to continue.",
    "UNAUTHENTICATED"
  );
}

async function runPasswordTransaction(callback) {
  for (
    let attempt = 1;
    attempt <= MAX_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if (error.code !== "P2034") {
        throw error;
      }

      if (attempt === MAX_TRANSACTION_ATTEMPTS) {
        throw new ApiError(
          503,
          "Password change is temporarily unavailable. Please try again.",
          "PASSWORD_CHANGE_UNAVAILABLE"
        );
      }
    }
  }
}

// Credentials must come from the password-change validation middleware.
async function changePassword(auth, credentials, context = {}) {
  const { currentPassword, newPassword } = credentials;

  const user = await prisma.user.findUnique({
    where: {
      id: auth.user.id,
    },
  });

  if (!user || user.status !== "ACTIVE") {
    throw sessionError();
  }
  if(user.role==='EMPLOYEE')throw new ApiError(403,'Contact an administrator to update your password.','ADMIN_PASSWORD_RESET_REQUIRED');

  const passwordMatches = await verifyPassword(
    currentPassword,
    user.passwordHash
  );

  if (!passwordMatches) {
    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "PASSWORD_CHANGE_FAILED",
        success: false,
        targetType: "User",
        targetId: user.id,
        ipAddress: context.ipAddress || null,
        userAgent: context.userAgent || null,
        metadata: {
          reason: "INVALID_CURRENT_PASSWORD",
        },
      },
    });

    throw new ApiError(
      400,
      "Current password is incorrect.",
      "INVALID_CURRENT_PASSWORD"
    );
  }

  // Perform expensive hashing before opening the transaction.
  const newPasswordHash = await hashPassword(newPassword);

  await runPasswordTransaction(async (tx) => {
    const currentUser = await tx.user.findUnique({
      where: {
        id: user.id,
      },
    });

    const currentSession = await tx.userSession.findUnique({
      where: {
        id: auth.session.id,
      },
    });

    const now = new Date();

    if (
      !currentUser ||
      currentUser.status !== "ACTIVE" ||
      !currentSession ||
      currentSession.userId !== user.id ||
      currentSession.revokedAt ||
      currentSession.expiresAt <= now ||
      now.getTime() - currentSession.lastSeenAt.getTime() >=
        SESSION_IDLE_TIMEOUT_MS
    ) {
      throw sessionError();
    }

    if (currentUser.passwordHash !== user.passwordHash) {
      throw new ApiError(
        409,
        "Account credentials changed. Please log in again.",
        "CREDENTIALS_CHANGED"
      );
    }
    if(currentUser.role==='EMPLOYEE')throw new ApiError(403,'Contact an administrator to update your password.','ADMIN_PASSWORD_RESET_REQUIRED');

    await tx.user.update({
      where: {
        id: user.id,
      },
      data: {
        passwordHash: newPasswordHash,
        passwordChangedAt: now,
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    const revoked = await tx.userSession.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "PASSWORD_CHANGED",
        success: true,
        targetType: "User",
        targetId: user.id,
        ipAddress: context.ipAddress || null,
        userAgent: context.userAgent || null,
        metadata: {
          revokedSessions: revoked.count,
        },
      },
    });
  });
}

module.exports = {
  changePassword,
};
