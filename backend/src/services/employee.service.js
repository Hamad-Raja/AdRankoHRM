"use strict";

const { isIP } = require("node:net");

const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const { hashPassword } = require("../utils/password");

const MAX_TRANSACTION_ATTEMPTS = 3;
const EMPLOYEE_ROLES = new Set(["ADMIN", "HR"]);

const EMPLOYEE_SELECT = {
  id: true,
  employeeCode: true,
  userId: true,
  fullName: true,
  personalEmail: true,
  phone: true,
  address: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelationship: true,
  version: true,
  createdAt: true,
  updatedAt: true,
};

const EMPLOYMENT_SELECT = {
  id: true,
  startDate: true,
  endDate: true,
  status: true,
  statusEffectiveDate: true,
  probationEndDate: true,
  confirmedOn: true,
  version: true,
  createdAt: true,
  updatedAt: true,
};

const LATEST_EMPLOYMENT = {
  orderBy: [
    { startDate: "desc" },
    { id: "desc" },
  ],
  take: 1,
  select: EMPLOYMENT_SELECT,
};

const LIST_SELECT = {
  id: true,
  employeeCode: true,
  fullName: true,
  employmentEpisodes: LATEST_EMPLOYMENT,
};

const DETAIL_SELECT = {
  ...EMPLOYEE_SELECT,
  employmentEpisodes: LATEST_EMPLOYMENT,
};

function toDatabaseDate(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return new Date(`${value}T00:00:00.000Z`);
}

function toDateString(value) {
  return value === null ? null : value.toISOString().slice(0, 10);
}

function sanitizeIpAddress(value) {
  if (typeof value !== "string") {
    return null;
  }

  const address = value.trim();
  return isIP(address) ? address : null;
}

function sanitizeUserAgent(value) {
  if (typeof value !== "string") {
    return null;
  }

  const userAgent = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim();

  return userAgent ? userAgent.slice(0, 512) : null;
}

function serializeEmployment(employment) {
  if (!employment) {
    return null;
  }

  return {
    id: employment.id,
    startDate: toDateString(employment.startDate),
    endDate: toDateString(employment.endDate),
    status: employment.status,
    statusEffectiveDate: toDateString(employment.statusEffectiveDate),
    probationEndDate: toDateString(employment.probationEndDate),
    confirmedOn: toDateString(employment.confirmedOn),
    version: employment.version,
    createdAt: employment.createdAt.toISOString(),
    updatedAt: employment.updatedAt.toISOString(),
  };
}

function serializeEmployee(employee, employment) {
  return {
    ...employee,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
    employment: serializeEmployment(employment),
  };
}

async function assertEmployeePermission(
  tx,
  actorUserId,
  creating = false
) {
  if (!actorUserId) {
    throw new ApiError(
      401,
      "Authentication is required.",
      "UNAUTHENTICATED"
    );
  }

  const actor = await tx.user.findUnique({
    where: { id: actorUserId },
    select: {
      status: true,
      role: true,
      mustChangePassword: true,
    },
  });

  if (!actor || actor.status !== "ACTIVE") {
    throw new ApiError(
      401,
      "Your account is unavailable. Please sign in again.",
      "ACCOUNT_UNAVAILABLE"
    );
  }

  if (actor.mustChangePassword) {
    throw new ApiError(
      403,
      creating
        ? "Change your password before creating employees."
        : "Change your password before accessing employees.",
      "PASSWORD_CHANGE_REQUIRED"
    );
  }

  if (!EMPLOYEE_ROLES.has(actor.role)) {
    throw new ApiError(
      403,
      creating
        ? "You do not have permission to create employees."
        : "You do not have permission to access these employee records.",
      "FORBIDDEN"
    );
  }
}

// data must be the output of createEmployeeSchema validation.
async function createEmployee({
  data,
  actorUserId,
  ipAddress,
  userAgent,
}) {
  if (!actorUserId) {
    throw new ApiError(
      401,
      "Authentication is required.",
      "UNAUTHENTICATED"
    );
  }

  // Hash once outside the transaction.
  // Passwords and hashes never enter response or audit metadata.
  const passwordHash = data.portalLogin
    ? await hashPassword(data.portalLogin.password)
    : null;

  const auditIpAddress = sanitizeIpAddress(ipAddress);
  const auditUserAgent = sanitizeUserAgent(userAgent);

  for (
    let attempt = 0;
    attempt < MAX_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await assertEmployeePermission(tx, actorUserId, true);

          const existingEmployee = await tx.employee.findUnique({
            where: { employeeCode: data.employeeCode },
            select: { id: true },
          });

          if (existingEmployee) {
            throw new ApiError(
              409,
              "Employee code is already in use.",
              "EMPLOYEE_CODE_IN_USE",
              [
                {
                  field: "employeeCode",
                  message: "Choose an unused employee code.",
                },
              ]
            );
          }

          let loginAccount = null;

          if (data.portalLogin) {
            const actor = await tx.user.findUnique({
              where: { id: actorUserId },
              select: { role: true },
            });

            if (
              actor.role === "HR" &&
              data.portalLogin.role !== "EMPLOYEE"
            ) {
              throw new ApiError(
                403,
                "HR can create Employee accounts only.",
                "FORBIDDEN"
              );
            }

            const existingAccount = await tx.user.findUnique({
              where: { email: data.portalLogin.email },
              select: { id: true },
            });

            if (existingAccount) {
              throw new ApiError(
                409,
                "Login email is already in use.",
                "LOGIN_EMAIL_IN_USE",
                [
                  {
                    field: "portalLogin.email",
                    message:
                      "Choose an unused login email, or link the existing account from the employee profile.",
                  },
                ]
              );
            }

            loginAccount = await tx.user.create({
              data: {
                email: data.portalLogin.email,
                displayName: data.fullName,
                passwordHash,
                role: data.portalLogin.role,
                status: "ACTIVE",
                mustChangePassword: true,
              },
              select: {
                id: true,
                email: true,
                role: true,
                mustChangePassword: true,
              },
            });
          }

          const employee = await tx.employee.create({
            data: {
              employeeCode: data.employeeCode,
              ...(loginAccount ? { userId: loginAccount.id } : {}),
              fullName: data.fullName,
              personalEmail: data.personalEmail,
              phone: data.phone,
              address: data.address,
              emergencyContactName: data.emergencyContactName,
              emergencyContactPhone: data.emergencyContactPhone,
              emergencyContactRelationship:
                data.emergencyContactRelationship,
            },
            select: EMPLOYEE_SELECT,
          });

          const employment = await tx.employmentEpisode.create({
            data: {
              employee: {
                connect: { id: employee.id },
              },
              startDate: toDatabaseDate(data.employment.startDate),
              status: data.employment.status,
              statusEffectiveDate: toDatabaseDate(
                data.employment.startDate
              ),
              probationEndDate: toDatabaseDate(
                data.employment.probationEndDate
              ),
              confirmedOn: toDatabaseDate(
                data.employment.confirmedOn
              ),
              statusEvents: {
                create: {
                  fromStatus: null,
                  toStatus: data.employment.status,
                  effectiveDate: toDatabaseDate(
                    data.employment.startDate
                  ),
                  reason: data.employment.reason,
                  actor: {
                    connect: { id: actorUserId },
                  },
                },
              },
            },
            select: EMPLOYMENT_SELECT,
          });

          await tx.auditLog.create({
            data: {
              actorUserId,
              action: "EMPLOYEE_CREATED",
              success: true,
              targetType: "Employee",
              targetId: employee.id,
              metadata: {
                employeeCode: employee.employeeCode,
                employmentEpisodeId: employment.id,
                initialStatus: employment.status,
                startDate: data.employment.startDate,
              },
              ipAddress: auditIpAddress,
              userAgent: auditUserAgent,
            },
          });

          if (loginAccount) {
            await tx.auditLog.create({
              data: {
                actorUserId,
                action: "EMPLOYEE_ACCOUNT_PROVISIONED",
                success: true,
                targetType: "EmployeeManagement",
                targetId: employee.id,
                metadata: {
                  userId: loginAccount.id,
                  role: loginAccount.role,
                },
                ipAddress: auditIpAddress,
                userAgent: auditUserAgent,
              },
            });
          }

          return {
            ...serializeEmployee(employee, employment),
            ...(loginAccount ? { loginAccount } : {}),
          };
        },
        {
          isolationLevel: "Serializable",
          maxWait: 5000,
          timeout: 10000,
        }
      );
    } catch (error) {
      if (error.code === "P2034") {
        continue;
      }

      if (error.code === "P2002") {
        throw new ApiError(
          409,
          "Employee code or login email is already in use.",
          "EMPLOYEE_CONFLICT"
        );
      }

      throw error;
    }
  }

  throw new ApiError(
    503,
    "Employee creation is temporarily busy. Please try again.",
    "EMPLOYEE_CREATION_BUSY"
  );
}

function serializeSummary(employee) {
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    employment: serializeEmployment(employee.employmentEpisodes[0]),
  };
}

function serializeDetail(employee) {
  const { employmentEpisodes, ...profile } = employee;
  return serializeEmployee(profile, employmentEpisodes[0]);
}

function escapeSearch(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function buildEmployeeFilter({ q, status }) {
  const conditions = [];

  if (q) {
    const search = escapeSearch(q);

    conditions.push({
      OR: [
        {
          employeeCode: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          fullName: {
            contains: search,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  if (status === "EXITED") {
    conditions.push({
      employmentEpisodes: {
        some: { status: "EXITED" },
        none: { endDate: null },
      },
    });
  } else if (status) {
    conditions.push({
      employmentEpisodes: {
        some: {
          status,
          endDate: null,
        },
      },
    });
  }

  return conditions.length > 0 ? { AND: conditions } : {};
}

async function readTransaction(actorUserId, operation) {
  return prisma.$transaction(
    async (tx) => {
      await assertEmployeePermission(tx, actorUserId);
      return operation(tx);
    },
    {
      isolationLevel: "RepeatableRead",
      maxWait: 5000,
      timeout: 10000,
    }
  );
}

async function listEmployees({ actorUserId, filters }) {
  const { page, pageSize } = filters;
  const where = buildEmployeeFilter(filters);

  return readTransaction(actorUserId, async (tx) => {
    const total = await tx.employee.count({ where });

    const employees = await tx.employee.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [
        { fullName: "asc" },
        { id: "asc" },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      employees: employees.map(serializeSummary),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  });
}

async function getEmployeeById({ actorUserId, employeeId }) {
  return readTransaction(actorUserId, async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      select: DETAIL_SELECT,
    });

    if (!employee) {
      throw new ApiError(
        404,
        "Employee not found.",
        "EMPLOYEE_NOT_FOUND"
      );
    }

    return serializeDetail(employee);
  });
}

async function updateEmployee({
  actorUserId,
  employeeId,
  data,
  ipAddress,
  userAgent,
}) {
  const editableFields = [
    "fullName",
    "personalEmail",
    "phone",
    "address",
    "emergencyContactName",
    "emergencyContactPhone",
    "emergencyContactRelationship",
  ];

  const patch = {};

  for (const field of editableFields) {
    if (Object.hasOwn(data, field) && data[field] !== undefined) {
      patch[field] = data[field];
    }
  }

  for (
    let attempt = 0;
    attempt < MAX_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await assertEmployeePermission(tx, actorUserId);

          const current = await tx.employee.findUnique({
            where: { id: employeeId },
            select: EMPLOYEE_SELECT,
          });

          if (!current) {
            throw new ApiError(
              404,
              "Employee not found.",
              "EMPLOYEE_NOT_FOUND"
            );
          }

          if (current.version !== data.version) {
            throw new ApiError(
              409,
              "Employee profile changed. Reload it before updating.",
              "EMPLOYEE_VERSION_CONFLICT"
            );
          }

          if (current.version === 2147483647) {
            throw new ApiError(
              409,
              "Employee profile version limit reached.",
              "EMPLOYEE_VERSION_EXHAUSTED"
            );
          }

          const changedFields = editableFields.filter(
            (field) =>
              Object.hasOwn(patch, field) &&
              patch[field] !== current[field]
          );

          const updated = await tx.employee.updateMany({
            where: {
              id: employeeId,
              version: data.version,
            },
            data: {
              ...patch,
              version: { increment: 1 },
            },
          });

          if (updated.count !== 1) {
            throw new ApiError(
              409,
              "Employee profile changed. Reload it before updating.",
              "EMPLOYEE_VERSION_CONFLICT"
            );
          }

          await tx.auditLog.create({
            data: {
              actorUserId,
              action: "EMPLOYEE_PROFILE_UPDATED",
              success: true,
              targetType: "Employee",
              targetId: employeeId,
              metadata: {
                changedFields,
                previousVersion: current.version,
                version: current.version + 1,
              },
              ipAddress: sanitizeIpAddress(ipAddress),
              userAgent: sanitizeUserAgent(userAgent),
            },
          });

          const employee = await tx.employee.findUnique({
            where: { id: employeeId },
            select: DETAIL_SELECT,
          });

          return serializeDetail(employee);
        },
        {
          isolationLevel: "Serializable",
          maxWait: 5000,
          timeout: 10000,
        }
      );
    } catch (error) {
      if (error.code === "P2034") {
        continue;
      }

      throw error;
    }
  }

  throw new ApiError(
    503,
    "Employee update is temporarily busy. Please try again.",
    "EMPLOYEE_UPDATE_BUSY"
  );
}

module.exports = {
  listEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
};