const ApiError = require("../utils/ApiError");
const { verifyToken } = require("../utils/token");

const {
  ALLOWED_ORIGINS,
  CSRF_HEADER_NAME,
} = require("../config/auth");

const SAFE_METHODS = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
]);

function originError() {
  return new ApiError(
    403,
    "Request origin is not allowed.",
    "ORIGIN_NOT_ALLOWED"
  );
}

function checkOrigin(req) {
  let origin = req.get("origin");

  if (!origin) {
    const referer = req.get("referer");

    if (referer) {
      try {
        origin = new URL(referer).origin;
      } catch {
        return originError();
      }
    }
  }

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return originError();
  }

  // Reject browser cross-site requests with no verifiable origin.
  // Non-browser API clients may omit browser origin headers.
  if (
    !origin &&
    req.get("sec-fetch-site") === "cross-site"
  ) {
    return originError();
  }

  return null;
}

function requireTrustedOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const error = checkOrigin(req);

  return error ? next(error) : next();
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const error = checkOrigin(req);

  if (error) {
    return next(error);
  }

  if (!req.auth?.session) {
    return next(
      new ApiError(
        401,
        "Please log in to continue.",
        "UNAUTHENTICATED"
      )
    );
  }

  const csrfToken = req.get(CSRF_HEADER_NAME);

  if (
    !verifyToken(
      csrfToken,
      req.auth.session.csrfTokenHash
    )
  ) {
    return next(
      new ApiError(
        403,
        "CSRF verification failed. Refresh your session and try again.",
        "CSRF_INVALID"
      )
    );
  }

  return next();
}

module.exports = {
  requireTrustedOrigin,
  csrfProtection,
};