"use strict";

const employeeService = require("../services/employee.service");
const ApiError = require("../utils/ApiError");
const {
  listEmployeesQuerySchema,
  employeeIdParamsSchema,
} = require("../validation/employee.validation");

// Query/params are read-only Express inputs. Keep parsed data local rather
// than replacing req.query, and use the established validation error contract.
function parseRequest(schema, input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "Request validation failed.",
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => ({
        field: issue.path.map(String).join(".") || "request",
        message: issue.message,
      }))
    );
  }
  return parsed.data;
}

async function create(req, res, next) {
  try {
    const employee = await employeeService.createEmployee({
      data: req.validatedBody,
      actorUserId: req.auth.user.id,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(201).json({
      success: true,
      message: "Employee created successfully.",
      data: {
        employee,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function list(req, res, next) {
  try {
    const filters = parseRequest(listEmployeesQuerySchema, req.query);
    const data = await employeeService.listEmployees({
      actorUserId: req.auth.user.id,
      filters,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function detail(req, res, next) {
  try {
    const { employeeId } = parseRequest(employeeIdParamsSchema, req.params);
    const employee = await employeeService.getEmployeeById({
      actorUserId: req.auth.user.id,
      employeeId,
    });
    res.status(200).json({ success: true, data: { employee } });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const { employeeId } = parseRequest(employeeIdParamsSchema, req.params);
    const employee = await employeeService.updateEmployee({
      actorUserId: req.auth.user.id,
      employeeId,
      data: req.validatedBody,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    res.status(200).json({
      success: true,
      message: "Employee profile updated successfully.",
      data: { employee },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  create,
  list,
  detail,
  update,
};
