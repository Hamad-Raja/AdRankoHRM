"use strict";

const router = require("express").Router();
const authenticate = require("../src/middleware/authenticate");
const authorize = require("../src/middleware/authorize");
const validate = require("../src/middleware/validate");
const { csrfProtection } = require("../src/middleware/csrf");
const ApiError = require("../src/utils/ApiError");
const schemas = require("../src/validation/shift.validation");
const service = require("../src/services/shift.service");

function params(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) return next(new ApiError(400, "Invalid shift or employee ID.", "VALIDATION_ERROR"));
    next();
  };
}
function endpoint(work, status = 200) {
  return async (req, res, next) => {
    try { res.status(status).json({ success: true, data: await work(req) }); }
    catch (error) { next(error); }
  };
}

router.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.use(authenticate());
// First batch exposes management endpoints only. Owner/team schedule reads will
// be added explicitly with the dashboard; no management fields leak to them.
router.use(authorize("ADMIN", "HR"));
// Retain historical reads. All normal configuration now belongs to the common office policy.
router.use((req, res, next) => req.method === 'GET' || req.method === 'HEAD' ? next() : next(new ApiError(410, 'Individual shift management is retired. Use Attendance Settings for the common office schedule.', 'COMMON_SCHEDULE_REQUIRED')));
router.get("/", endpoint(req => service.listShifts(req.auth.user.id)));
router.post("/", csrfProtection, validate(schemas.createShiftSchema),
  endpoint(req => service.createShift(req.auth.user.id, req.validatedBody), 201));
router.post("/:shiftId/archive", csrfProtection, params(schemas.idParamsSchema),
  validate(schemas.archiveShiftSchema),
  endpoint(req => service.archiveShift(req.auth.user.id, req.params.shiftId, req.validatedBody.reason)));
router.get("/employees/:employeeId/assignments", params(schemas.employeeParamsSchema),
  endpoint(req => service.listAssignments(req.auth.user.id, req.params.employeeId)));
router.post("/employees/:employeeId/assignments", csrfProtection, params(schemas.employeeParamsSchema),
  validate(schemas.assignShiftSchema),
  endpoint(req => service.assignShift(req.auth.user.id, req.params.employeeId, req.validatedBody), 201));

module.exports = router;
