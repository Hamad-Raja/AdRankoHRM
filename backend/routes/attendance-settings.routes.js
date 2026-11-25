"use strict";
const router = require("express").Router();
const authenticate = require("../src/middleware/authenticate");
const authorize = require("../src/middleware/authorize");
const validate = require("../src/middleware/validate");
const { csrfProtection } = require("../src/middleware/csrf");
const readiness = require("../src/validation/schedule-readiness.validation");
const { z } = require("zod");
const service = require("../src/services/attendance-settings.service");
const ApiError = require("../src/utils/ApiError");
const endpoint = (work) => async (req, res, next) => {
  try {
    if (Object.keys(req.query).length)
      throw new ApiError(
        400,
        "This endpoint does not accept employee IDs or other query parameters.",
        "VALIDATION_ERROR",
      );
    res.json({ success: true, data: await work(req) });
  } catch (e) {
    next(e);
  }
};
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.use(authenticate());
router.get(
  "/my-shift",
  endpoint((req) => service.myShift(req.auth.user.id)),
);
router.use(authorize("ADMIN", "HR"));
router.get(
  "/",
  endpoint((req) => service.settings(req.auth.user.id)),
);
router.post("/", csrfProtection, (req, res, next) =>
  next(
    new ApiError(
      410,
      "Save a draft and explicitly approve its effective date through activation.",
      "DRAFT_ACTIVATION_REQUIRED",
    ),
  ),
);
router.post(
  "/draft",
  csrfProtection,
  validate(readiness.draftSchema),
  endpoint((req) => service.saveDraft(req.auth.user.id, req.validatedBody)),
);
router.post(
  "/draft/discard", csrfProtection, validate(readiness.discardSchema),
  endpoint((req) => service.discardDraft(req.auth.user.id, req.validatedBody)),
);
router.post(
  "/activate",
  csrfProtection,
  validate(readiness.activationSchema),
  endpoint((req) => service.activate(req.auth.user.id, req.validatedBody)),
);
router.post(
  "/holidays",
  csrfProtection,
  validate(readiness.holidaySchema),
  endpoint((req) =>
    service.announceHoliday(req.auth.user.id, req.validatedBody),
  ),
);
router.post(
  "/holidays/:eventId/cancel",
  csrfProtection,
  (req, res, next) =>
    next(
      z.uuid().safeParse(req.params.eventId).success
        ? undefined
        : new ApiError(400, "Invalid announcement ID.", "VALIDATION_ERROR"),
    ),
  validate(readiness.cancellationSchema),
  endpoint((req) =>
    service.cancelHoliday(
      req.auth.user.id,
      req.params.eventId,
      req.validatedBody,
    ),
  ),
);
module.exports = router;
