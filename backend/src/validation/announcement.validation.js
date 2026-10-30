"use strict";

const { z } = require("zod");

const id = z.string().uuid("Invalid ID format.");

const priorityEnum = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
const statusEnum = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
const roleEnum = z.enum(["ADMIN", "HR", "MANAGER", "EMPLOYEE"]);

const textClean = (str) => typeof str === "string" ? str.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, "") : str;

const createAnnouncement = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200, "Title cannot exceed 200 characters."),
  content: z.string().trim().min(1, "Content is required.").max(20000, "Content cannot exceed 20,000 characters."),
  priority: priorityEnum.default("NORMAL"),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("PUBLISHED"),
  targetRole: roleEnum.nullable().optional(),
  departmentId: z.string().uuid("Invalid department ID.").nullable().optional(),
  pinned: z.boolean().default(false),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();

const updateAnnouncement = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200, "Title cannot exceed 200 characters.").optional(),
  content: z.string().trim().min(1, "Content is required.").max(20000, "Content cannot exceed 20,000 characters.").optional(),
  priority: priorityEnum.optional(),
  status: statusEnum.optional(),
  targetRole: roleEnum.nullable().optional(),
  departmentId: z.string().uuid("Invalid department ID.").nullable().optional(),
  pinned: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();

const listAnnouncements = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  priority: priorityEnum.optional(),
  status: statusEnum.optional(),
  unreadOnly: z.preprocess((val) => val === "true" || val === true, z.boolean()).optional(),
}).strict();

module.exports = {
  id,
  createAnnouncement,
  updateAnnouncement,
  listAnnouncements,
  priorityEnum,
  statusEnum,
};
