"use strict";

const router = require("express").Router();
const authenticate = require("../src/middleware/authenticate");
const authorize = require("../src/middleware/authorize");
const { csrfProtection } = require("../src/middleware/csrf");
const ApiError = require("../src/utils/ApiError");
const schema = require("../src/validation/announcement.validation");
const service = require("../src/services/announcement.service");

function parse(validator, value) {
  const result = validator.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      result.error.issues[0]?.message || "Invalid announcement input.",
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

// User announcement actions
router.get("/", run((req) => service.listAnnouncements(req.auth.user.id, parse(schema.listAnnouncements, req.query), false)));
router.post("/read-all", csrfProtection, run((req) => service.markAllAnnouncementsRead(req.auth.user.id)));
router.get("/:id", run((req) => service.getAnnouncement(req.auth.user.id, parse(schema.id, req.params.id))));
router.post("/:id/read", csrfProtection, run((req) => service.markAnnouncementRead(req.auth.user.id, parse(schema.id, req.params.id))));

// Management announcement actions (Admin & HR only)
router.use(authorize("ADMIN", "HR"));

router.get("/management/list", run((req) => service.listAnnouncements(req.auth.user.id, parse(schema.listAnnouncements, req.query), true)));
router.post("/", csrfProtection, run((req) => service.createAnnouncement(req.auth.user.id, parse(schema.createAnnouncement, req.body))));
router.patch("/:id", csrfProtection, run((req) => service.updateAnnouncement(req.auth.user.id, parse(schema.id, req.params.id), parse(schema.updateAnnouncement, req.body))));
router.delete("/:id", csrfProtection, run((req) => service.deleteAnnouncement(req.auth.user.id, parse(schema.id, req.params.id))));
router.get("/:id/acknowledgements", run((req) => service.getAcknowledgements(req.auth.user.id, parse(schema.id, req.params.id))));

module.exports = router;
