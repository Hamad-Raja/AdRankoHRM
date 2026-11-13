"use strict";

const { isIP } = require("node:net");

const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const { hashPassword } = require("../utils/password");

const MAX_TRANSACTION_ATTEMPTS = 3;
const CREATE_TRANSACTION_ATTEMPTS = 8;
function transactionConflict(error){return error.code==='P2034'||['40001','40P01'].includes(error.cause?.originalCode)||error.cause?.kind==='TransactionWriteConflict';}
const EMPLOYEE_ROLES = new Set(["ADMIN", "HR"]);

const EMPLOYEE_SELECT = {
  id: true,
  employeeCode: true,
  userId: true,
  fullName: true,
  personalEmail: true,
  phone: true,
  address: true,
  cnic: true,
  location: true,
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
  employmentType: true,
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
const CURRENT_ORGANIZATION = {
 orderBy:[{effectiveFrom:'desc'},{id:'desc'}],
 select:{id:true,departmentId:true,campaignId:true,teamId:true,designationId:true,reportingManagerId:true,effectiveFrom:true,effectiveTo:true,
 department:{select:{name:true}},campaign:{select:{name:true}},team:{select:{name:true,department:{select:{id:true,name:true}}}},designation:{select:{name:true}},reportingManager:{select:{displayName:true,employee:{select:{fullName:true,employeeCode:true}}}}}
};

const LIST_SELECT = {
  id: true,
  employeeCode: true,
  fullName: true,
  location: true,
  employmentEpisodes: LATEST_EMPLOYMENT,
  _count: {select:{salaryVersions:true}},
};

const DETAIL_SELECT = {
  ...EMPLOYEE_SELECT,
  employmentEpisodes: LATEST_EMPLOYMENT,
  user:{select:{email:true,role:true,mustChangePassword:true}},
  assignments:CURRENT_ORGANIZATION,
  _count: {select:{salaryVersions:true}},
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
    employmentType: employment.employmentType||null,
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
      id: true,
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

  await require('./employment-access.service').assertAllowed(tx,actor);
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
    attempt < CREATE_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await assertEmployeePermission(tx, actorUserId, true);

          let employeeCode=data.employeeCode;
          if(!employeeCode){
            do{const [allocated]=await tx.$queryRaw`SELECT nextval('employee_code_sequence')::text AS value`;employeeCode='EMP-'+allocated.value.padStart(4,'0');}while(await tx.employee.findUnique({where:{employeeCode},select:{id:true}}));
          }
          const existingEmployee = await tx.employee.findUnique({
            where: { employeeCode },
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
                mustChangePassword: false,
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
              employeeCode,
              ...(loginAccount ? { userId: loginAccount.id } : {}),
              fullName: data.fullName,
              personalEmail: data.personalEmail,
              phone: data.phone,
              address: data.address,
              cnic: data.cnic,
              location: data.location,
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
              employmentType: data.employment.employmentType,
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

          if(data.organization){
            const placement=await require('./organization.service').validatePlacement(tx,data.organization,loginAccount?.id);
            await tx.organizationAssignment.create({data:{...placement,employeeId:employee.id,effectiveFrom:toDatabaseDate(data.employment.startDate),actorUserId,reason:'Initial organization assignment created with employee.'}});
            await require('./organization.service').audit(tx,actorUserId,'EMPLOYEE_ORGANIZATION_ASSIGNED',employee.id);
          }
          const startingSalary=data.startingSalary?await require('./payroll.service').saveSalaryInTransaction(tx,actorUserId,employee.id,{
            ...data.startingSalary,expectedPreviousId:null,reason:'Starting monthly basic salary set when creating the employee.'
          }):null;
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
            salaryConfigured:Boolean(startingSalary),
            ...(startingSalary?{startingSalary}:{}),
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
      if (transactionConflict(error)) {
        await new Promise(resolve=>setTimeout(resolve,10+Math.random()*20*(attempt+1)));
        continue;
      }

      if (error.code === "P2002") {
        if(JSON.stringify(error.meta||{}).includes('cnic'))throw new ApiError(409,'CNIC is already linked to an employee.','EMPLOYEE_CNIC_IN_USE',[{field:'cnic',message:'Use the employee’s own unique CNIC.'}]);
        if(!data.employeeCode&&JSON.stringify(error.meta||{}).includes('employeeCode')&&attempt<CREATE_TRANSACTION_ATTEMPTS-1)continue;
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

// A rehire keeps salary history, but prior-contract versions do not configure the new episode.
async function salaryConfiguration(tx, employees) {
  const configured = new Map(employees.map(e => [e.id, (e._count?.salaryVersions || 0) > 0]));
  if (!employees.length || !await require('./employment-access.service').ready(tx)) return configured;
  const cases = await tx.employmentCase.findMany({where:{employeeId:{in:employees.map(e=>e.id)},kind:'REHIRE',state:'COMPLETED'},orderBy:{accessCutoff:'desc'},select:{employeeId:true,rehirePlan:true}});
  const latest = new Map();
  for (const c of cases) if (!latest.has(c.employeeId)) latest.set(c.employeeId,c.rehirePlan);
  if (!latest.size) return configured;
  const versions = await tx.employeeSalaryVersion.findMany({where:{employeeId:{in:[...latest.keys()]}},select:{id:true,employeeId:true,effectiveMonth:true}});
  for (const [id, plan] of latest) configured.set(id, versions.some(v=>v.employeeId===id && v.effectiveMonth.toISOString().slice(0,7)>=plan.joiningDate.slice(0,7) && !(plan.priorSalaryVersionIds||[]).includes(v.id)));
  return configured;
}

function serializeSummary(employee) {
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    location: employee.location||null,
    organization: employee.assignments?.[0]||null,
    salaryConfigured:(employee._count?.salaryVersions||0)>0,
    employment: serializeEmployment(employee.employmentEpisodes[0]),
  };
}

function serializeDetail(employee) {
  const { employmentEpisodes,assignments,_count,...profile } = employee;
  const today=require('../utils/office-schedule').localParts(new Date(),'Asia/Karachi').date;
  const organization=assignments?.find(a=>a.effectiveFrom.toISOString().slice(0,10)<=today&&(!a.effectiveTo||a.effectiveTo.toISOString().slice(0,10)>=today))||null;
  const plannedOrganization=assignments?.find(a=>a.effectiveFrom.toISOString().slice(0,10)>today)||null;
  return {...serializeEmployee(profile, employmentEpisodes[0]),organization,plannedOrganization,salaryConfigured:(_count?.salaryVersions||0)>0};
}

function escapeSearch(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function currentPlacement(asOf){return {effectiveFrom:{lte:asOf},OR:[{effectiveTo:null},{effectiveTo:{gte:asOf}}]};}
function buildEmployeeFilter({ q, status, departmentId },asOf) {
  const conditions = [];
  if(departmentId)conditions.push({assignments:{some:{...currentPlacement(asOf),AND:[{OR:[{departmentId},{team:{departmentId}}]}]}}});

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
  const asOf=toDatabaseDate(require('../utils/office-schedule').localParts(new Date(),'Asia/Karachi').date);
  const where = buildEmployeeFilter(filters,asOf);

  return readTransaction(actorUserId, async (tx) => {
    const total = await tx.employee.count({ where });

    const employees = await tx.employee.findMany({
      where,
      select: {...LIST_SELECT,assignments:{...CURRENT_ORGANIZATION,take:1,where:currentPlacement(asOf)}},
      orderBy: [
        { fullName: "asc" },
        { id: "asc" },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const configured=await salaryConfiguration(tx,employees);
    return {
      employees: employees.map(e=>({...serializeSummary(e),salaryConfigured:configured.get(e.id)})),
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

    return {...serializeDetail(employee),salaryConfigured:(await salaryConfiguration(tx,[employee])).get(employee.id)};
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
    "cnic",
    "location",
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
          if(Object.hasOwn(data,'probationEndDate')||Object.hasOwn(data,'confirmedOn')||Object.hasOwn(data,'employmentType')){
            const episode=await tx.employmentEpisode.findFirst({where:{employeeId},orderBy:[{startDate:'desc'},{id:'desc'}]});
            if(Object.hasOwn(data,'employmentType')&&(episode?.id!==data.employmentEpisodeId||episode?.version!==data.expectedEmploymentVersion))throw new ApiError(409,'Employment episode changed. Reload before editing its type.','EMPLOYMENT_VERSION_CONFLICT');
            if(!episode)throw new ApiError(409,'No employment record exists.','EMPLOYMENT_NOT_FOUND');
            const probationEndDate=Object.hasOwn(data,'probationEndDate')?toDatabaseDate(data.probationEndDate):episode.probationEndDate;
            const confirmedOn=Object.hasOwn(data,'confirmedOn')?toDatabaseDate(data.confirmedOn):episode.confirmedOn;
            if((probationEndDate&&probationEndDate<episode.startDate)||(confirmedOn&&confirmedOn<episode.startDate)||(episode.status==='PROBATION'&&confirmedOn))throw new ApiError(400,'Employment dates conflict with joining date or probation status.','INVALID_EMPLOYMENT_DATES');
            await tx.employmentEpisode.update({where:{id:episode.id},data:{probationEndDate,confirmedOn,...(Object.hasOwn(data,'employmentType')?{employmentType:data.employmentType}:{}),version:{increment:1}}});
            changedFields.push('employmentDates');
          }

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

          return {...serializeDetail(employee),salaryConfigured:(await salaryConfiguration(tx,[employee])).get(employee.id)};
        },
        {
          isolationLevel: "Serializable",
          maxWait: 5000,
          timeout: 10000,
        }
      );
    } catch (error) {
      if (transactionConflict(error)) {
        continue;
      }

      if(error.code==='P2002'&&JSON.stringify(error.meta||{}).includes('cnic'))throw new ApiError(409,'CNIC is already linked to an employee.','EMPLOYEE_CNIC_IN_USE',[{field:'cnic',message:'Use a unique CNIC.'}]);
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
