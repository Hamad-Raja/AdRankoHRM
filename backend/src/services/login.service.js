const { isIP } = require("node:net");

const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const {
  hashPassword,
  verifyPassword,
} = require("../utils/password");
const {
  generateToken,
  hashToken,
} = require("../utils/token");

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const MAX_TRANSACTION_ATTEMPTS = 3;

let dummyHashPromise;

function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(generateToken());
  }

  return dummyHashPromise;
}

function sanitizeContext(context) {
  const ipAddress =
    typeof context.ipAddress === "string" &&
    isIP(context.ipAddress) !== 0
      ? context.ipAddress
      : null;

  const userAgent =
    typeof context.userAgent === "string"
      ? Array.from(
          context.userAgent.replace(/[\u0000-\u001f\u007f]/g, "")
        )
          .slice(0, 512)
          .join("")
      : null;

  return { ipAddress, userAgent };
}

function getPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
  };
}

async function runLoginTransaction(callback) {
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
          "Login is temporarily unavailable. Please try again.",
          "LOGIN_UNAVAILABLE"
        );
      }
    }
  }
}

// Credentials must come from the login validation middleware.
async function login({ email, password }, context = {}) {
  const requestContext = sanitizeContext(context);

  const user = await prisma.user.findUnique({
    where: { email },
  });

  // Both known and unknown accounts perform password verification.
  const dummyHash = await getDummyHash();

  const passwordMatches = await verifyPassword(
    password,
    user ? user.passwordHash : dummyHash
  );

  const result = await runLoginTransaction(async (tx) => {
    // Re-read account state after password verification.
    const currentUser = user
      ? await tx.user.findUnique({
          where: { id: user.id },
        })
      : null;

    const now = new Date();
    let failureReason = null;

    if (!currentUser) {
      failureReason = "INVALID_CREDENTIALS";
    } else if (currentUser.status !== "ACTIVE") {
      failureReason = "ACCOUNT_DISABLED";
    } else if (
      currentUser.lockedUntil &&
      currentUser.lockedUntil > now
    ) {
      failureReason = "ACCOUNT_LOCKED";
    } else if (currentUser.passwordHash !== user.passwordHash) {
      // Reject a password that was changed during this login attempt.
      failureReason = "CREDENTIALS_CHANGED";
    } else if (!passwordMatches) {
      const previousAttempts = currentUser.lockedUntil
        ? 0
        : currentUser.failedLoginAttempts;

      const failedLoginAttempts = previousAttempts + 1;

      await tx.user.update({
        where: { id: currentUser.id },
        data: {
          failedLoginAttempts,
          lockedUntil:
            failedLoginAttempts >= MAX_FAILED_ATTEMPTS
              ? new Date(now.getTime() + LOCK_DURATION_MS)
              : null,
        },
      });

      failureReason = "INVALID_CREDENTIALS";
    }

    if (failureReason) {
      await tx.auditLog.create({
        data: {
          actorUserId: currentUser ? currentUser.id : null,
          action: "LOGIN_FAILED",
          success: false,
          targetType: "User",
          targetId: currentUser ? currentUser.id : null,
          ...requestContext,
          metadata: {
            reason: failureReason,
          },
        },
      });

      // Commit attempt counters and audit records before returning 401.
      return { authenticated: false };
    }

    const sessionToken = generateToken();
    const csrfToken = generateToken();

    const expiresAt = new Date(
      now.getTime() + SESSION_DURATION_MS
    );

    await tx.userSession.create({
      data: {
        userId: currentUser.id,
        tokenHash: hashToken(sessionToken),
        csrfTokenHash: hashToken(csrfToken),
        expiresAt,
        ...requestContext,
      },
    });

    await tx.user.update({
      where: { id: currentUser.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: now,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: currentUser.id,
        action: "LOGIN_SUCCESS",
        success: true,
        targetType: "User",
        targetId: currentUser.id,
        ...requestContext,
      },
    });

    return {
      authenticated: true,
      data: {
        user: getPublicUser(currentUser),
        sessionToken,
        csrfToken,
        expiresAt,
      },
    };
  });

  if (!result.authenticated) {
    throw new ApiError(
      401,
      "Email or password is incorrect.",
      "INVALID_CREDENTIALS"
    );
  }

  // The controller will place sessionToken in an HttpOnly cookie.
  // Never send this entire result directly as a JSON response.
  return result.data;
}

module.exports = {
  login,
};