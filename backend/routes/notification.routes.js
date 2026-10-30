"use strict";

const router = require("express").Router();
const authenticate = require("../src/middleware/authenticate");
const { csrfProtection } = require("../src/middleware/csrf");
const ApiError = require("../src/utils/ApiError");
const schema = require("../src/validation/notification.validation");
const service = require("../src/services/notification.service");

function parse(validator, value) {
  const result = validator.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      result.error.issues[0]?.message || "Invalid notification input.",
      "VALIDATION_ERROR"
    );
  }
  return result.data;
}

const run = (work) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await work(req) });
  } catch (error) {
    next(error);
  }
};

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.use(authenticate());

router.get("/", run((req) => service.listNotifications(req.auth.user.id, parse(schema.listNotifications, req.query))));
router.get("/unread-count", run((req) => service.getUnreadCount(req.auth.user.id)));
router.patch("/:id/read", csrfProtection, run((req) => service.markAsRead(req.auth.user.id, parse(schema.id, req.params.id))));
router.post("/mark-all-read", csrfProtection, run((req) => service.markAllAsRead(req.auth.user.id)));
router.delete("/read", csrfProtection, run((req) => service.clearReadNotifications(req.auth.user.id)));
router.delete("/:id", csrfProtection, run((req) => service.deleteNotification(req.auth.user.id, parse(schema.id, req.params.id))));

module.exports = router;
