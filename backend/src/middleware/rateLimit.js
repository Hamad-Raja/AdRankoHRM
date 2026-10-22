const { rateLimit } = require("express-rate-limit");
const ApiError = require("../utils/ApiError");

const WINDOW_MS = 15 * 60 * 1000;

const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,

  handler(req, res, next) {
    next(
      new ApiError(
        429,
        "Too many login attempts. Please try again later.",
        "TOO_MANY_REQUESTS"
      )
    );
  },
});

const passwordChangeLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,

  keyGenerator(req) {
    return req.auth.user.id;
  },

  handler(req, res, next) {
    next(
      new ApiError(
        429,
        "Too many password change requests. Please try again later.",
        "TOO_MANY_REQUESTS"
      )
    );
  },
});

module.exports = {
  loginLimiter,
  passwordChangeLimiter,
};