"use strict";

const express = require("express");

const employeeController = require("../src/controllers/employee.controller");
const authenticate = require("../src/middleware/authenticate");
const authorize = require("../src/middleware/authorize");
const validateBody = require("../src/middleware/validate");

const {
  csrfProtection,
} = require("../src/middleware/csrf");

const {
  createEmployeeSchema,
  updateEmployeeSchema,
} = require("../src/validation/employee.validation");

const router = express.Router();

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.post(
  "/",
  authenticate(),
  authorize("ADMIN", "HR"),
  csrfProtection,
  validateBody(createEmployeeSchema),
  employeeController.create
);

router.get("/", authenticate(), authorize("ADMIN", "HR"), employeeController.list);
router.get("/:employeeId", authenticate(), authorize("ADMIN", "HR"), employeeController.detail);
router.patch(
  "/:employeeId",
  authenticate(),
  authorize("ADMIN", "HR"),
  csrfProtection,
  validateBody(updateEmployeeSchema),
  employeeController.update
);

module.exports = router;
