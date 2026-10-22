const { isIP } = require("node:net");

const ApiError = require("../utils/ApiError");
const { verifyToken } = require("../utils/token");

const {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} = require("../config/auth");

const {
  login: loginUser,
} = require("../services/login.service");

const {
  logout: logoutSession,
} = require("../services/logout.service");

const {
  changePassword: changeUserPassword,
} = require("../services/password.service");

function getRequestContext(req) {
  const ipAddress =
    typeof req.ip === "string" && isIP(req.ip) !== 0
      ? req.ip
      : null;

  const rawUserAgent = req.get("user-agent");

  const userAgent =
    typeof rawUserAgent === "string"
      ? Array.from(
          rawUserAgent.replace(/[\u0000-\u001f\u007f]/g, "")
        )
          .slice(0, 512)
          .join("")
      : null;

  return {
    ipAddress,
    userAgent,
  };
}

function clearAuthCookies(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    ...SESSION_COOKIE_OPTIONS,
  });

  res.clearCookie(CSRF_COOKIE_NAME, {
    ...SESSION_COOKIE_OPTIONS,
  });
}

async function login(req, res, next) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const result = await loginUser(
      req.validatedBody,
      getRequestContext(req)
    );

    const cookieOptions = {
      ...SESSION_COOKIE_OPTIONS,
      expires: result.expiresAt,
    };

    res.cookie(
      SESSION_COOKIE_NAME,
      result.sessionToken,
      cookieOptions
    );

    res.cookie(
      CSRF_COOKIE_NAME,
      result.csrfToken,
      cookieOptions
    );

    return res.status(200).json({
      success: true,
      message: "Logged in successfully.",
      data: {
        user: result.user,
        csrfToken: result.csrfToken,
        expiresAt: result.expiresAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

function me(req, res, next) {
  const csrfToken = req.cookies?.[CSRF_COOKIE_NAME];

  if (
    !verifyToken(
      csrfToken,
      req.auth.session.csrfTokenHash
    )
  ) {
    return next(
      new ApiError(
        403,
        "Session verification failed. Please log in again.",
        "CSRF_UNAVAILABLE"
      )
    );
  }

  return res.status(200).json({
    success: true,
    data: {
      user: req.auth.user,
      csrfToken,
      expiresAt: req.auth.session.expiresAt,
    },
  });
}

async function logout(req, res, next) {
  try {
    await logoutSession(
      req.auth,
      getRequestContext(req)
    );

    clearAuthCookies(res);

    return res.status(200).json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch (error) {
    return next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    await changeUserPassword(
      req.auth,
      req.validatedBody,
      getRequestContext(req)
    );

    clearAuthCookies(res);

    return res.status(200).json({
      success: true,
      message: "Password changed. Please log in again.",
      data: {
        requiresLogin: true,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  login,
  me,
  logout,
  changePassword,
};