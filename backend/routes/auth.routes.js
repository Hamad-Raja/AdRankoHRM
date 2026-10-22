const express = require("express");

const authController = require("../src/controllers/auth.controller");
const authenticate = require("../src/middleware/authenticate");
const validateBody = require("../src/middleware/validate");

const {
  requireTrustedOrigin,
  csrfProtection,
} = require("../src/middleware/csrf");

const {
  loginLimiter,
  passwordChangeLimiter,
} = require("../src/middleware/rateLimit");

const {
  loginSchema,
  changePasswordSchema,
} = require("../src/validation/auth.validation");

const router = express.Router();

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.post(
  "/login",
  requireTrustedOrigin,
  loginLimiter,
  validateBody(loginSchema),
  authController.login
);

router.get(
  "/me",
  authenticate({ allowPasswordChange: true }),
  authController.me
);

router.post(
  "/logout",
  authenticate({ allowPasswordChange: true }),
  csrfProtection,
  authController.logout
);

router.post(
  "/change-password",
  authenticate({ allowPasswordChange: true }),
  csrfProtection,
  passwordChangeLimiter,
  validateBody(changePasswordSchema),
  authController.changePassword
);

module.exports = router;
