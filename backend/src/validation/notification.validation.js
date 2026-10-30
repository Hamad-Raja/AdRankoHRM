"use strict";

const { z } = require("zod");

const id = z.string().uuid("Invalid notification ID.");

const typeEnum = z.enum([
  "ANNOUNCEMENT",
  "ATTENDANCE",
  "PAYROLL",
  "SYSTEM",
  "INFO",
  "WARNING",
  "SUCCESS",
]);

const listNotifications = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z.preprocess((val) => val === "true" || val === true, z.boolean()).optional(),
  type: typeEnum.optional(),
}).strict();

module.exports = {
  id,
  typeEnum,
  listNotifications,
};
