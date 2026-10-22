require("dotenv/config");

const isProduction = process.env.NODE_ENV === "production";

const frontendUrl = new URL(
  process.env.FRONTEND_ORIGIN || "http://localhost:5173"
);

if (
  !["http:", "https:"].includes(frontendUrl.protocol) ||
  frontendUrl.username ||
  frontendUrl.password
) {
  throw new Error("FRONTEND_ORIGIN must be a valid HTTP or HTTPS origin.");
}

const ALLOWED_ORIGINS = Object.freeze([
  frontendUrl.origin,
]);

const ROLES = Object.freeze([
  "ADMIN",
  "HR",
  "MANAGER",
  "EMPLOYEE",
]);

const SESSION_COOKIE_NAME = isProduction
  ? "__Host-officehr_session"
  : "officehr_session";

const CSRF_COOKIE_NAME = isProduction
  ? "__Host-officehr_csrf"
  : "officehr_csrf";

const SESSION_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax",
  path: "/",
});

const CSRF_HEADER_NAME = "x-csrf-token";

const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

module.exports = {
  ALLOWED_ORIGINS,
  ROLES,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  CSRF_HEADER_NAME,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_TOUCH_INTERVAL_MS,
};