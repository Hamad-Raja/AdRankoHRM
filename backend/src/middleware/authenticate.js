const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const {
  isValidToken,
  hashToken,
} = require("../utils/token");

const {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_TOUCH_INTERVAL_MS,
} = require("../config/auth");

function rejectSession(res, next) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    ...SESSION_COOKIE_OPTIONS,
  });
  res.clearCookie(CSRF_COOKIE_NAME, {
    ...SESSION_COOKIE_OPTIONS,
  });

  return next(
    new ApiError(
      401,
      "Please log in to continue.",
      "UNAUTHENTICATED"
    )
  );
}

function authenticate({ allowPasswordChange = false, processEmployment = true } = {}) {
  return async function authenticateRequest(req, res, next) {
    res.setHeader("Cache-Control", "no-store");

    try {
      const token = req.cookies?.[SESSION_COOKIE_NAME];

      if (!isValidToken(token)) {
        return rejectSession(res, next);
      }

      const session = await prisma.userSession.findUnique({
        where: {
          tokenHash: hashToken(token),
        },
        select: {
          id: true,
          expiresAt: true,
          revokedAt: true,
          lastSeenAt: true,
          csrfTokenHash: true,
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
              role: true,
              status: true,
              mustChangePassword: true,
            },
          },
        },
      });

      if (!session || session.revokedAt) {
        return rejectSession(res, next);
      }

      if(processEmployment && await require('../services/employment-access.service').processForUser(session.user.id)) {
        return rejectSession(res,next);
      }
      await require('../services/employment-access.service').assertAllowed(prisma,session.user);

      const now = new Date();

      const isExpired = session.expiresAt <= now;

      const isIdle =
        now.getTime() - session.lastSeenAt.getTime() >=
        SESSION_IDLE_TIMEOUT_MS;

      if (isExpired || isIdle || session.user.status !== "ACTIVE") {
        await prisma.userSession.updateMany({
          where: {
            id: session.id,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
          },
        });

        return rejectSession(res, next);
      }

      if (
        session.user.mustChangePassword && !['EMPLOYEE','MANAGER'].includes(session.user.role) &&
        !allowPasswordChange
      ) {
        return next(
          new ApiError(
            403,
            "Change your password before continuing.",
            "PASSWORD_CHANGE_REQUIRED"
          )
        );
      }

      const shouldUpdateActivity =
        now.getTime() - session.lastSeenAt.getTime() >=
        SESSION_TOUCH_INTERVAL_MS;

      if (shouldUpdateActivity) {
        const updated = await prisma.userSession.updateMany({
          where: {
            id: session.id,
            revokedAt: null,
            expiresAt: {
              gt: now,
            },
            user: {
              is: {
                status: "ACTIVE",
              },
            },
          },
          data: {
            lastSeenAt: now,
          },
        });

        if (updated.count === 0) {
          return rejectSession(res, next);
        }
      }

      req.auth = {
        user: {...session.user,mustChangePassword:['EMPLOYEE','MANAGER'].includes(session.user.role)?false:session.user.mustChangePassword},
        session: {
          id: session.id,
          expiresAt: session.expiresAt,
          csrfTokenHash: session.csrfTokenHash,
        },
      };

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = authenticate;
