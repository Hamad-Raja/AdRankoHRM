import { ApiError, apiRequest } from "@/lib/api";

const EMPLOYMENT_STATUSES = new Set([
  "PROBATION",
  "ACTIVE",
  "NOTICE_PERIOD",
  "SUSPENDED",
  "EXITED",
]);

const OPTIONAL_PROFILE_FIELDS = [
  "personalEmail",
  "phone",
  "address",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelationship",
];

function isCalendarDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function isEmployeeSummary(employee) {
  if (
    !employee ||
    typeof employee.id !== "string" ||
    typeof employee.employeeCode !== "string" ||
    typeof employee.fullName !== "string"
  ) {
    return false;
  }

  if (employee.employment === null) {
    return true;
  }

  return (
    typeof employee.employment?.id === "string" &&
    EMPLOYMENT_STATUSES.has(employee.employment.status) &&
    isCalendarDate(employee.employment.startDate)
  );
}

function hasProfileVersion(employee) {
  return (
    Number.isSafeInteger(employee?.version) &&
    employee.version > 0 &&
    employee.version <= 2147483647
  );
}

function isEmployeeDetail(employee) {
  return (
    isEmployeeSummary(employee) &&
    hasProfileVersion(employee) &&
    OPTIONAL_PROFILE_FIELDS.every(
      (field) =>
        employee[field] === null ||
        typeof employee[field] === "string"
    )
  );
}

function invalidResponse() {
  return new ApiError(
    "The server returned an unexpected employee response.",
    { code: "INVALID_RESPONSE" }
  );
}

function validateEmployeeId(employeeId) {
  if (
    typeof employeeId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      employeeId
    )
  ) {
    throw new ApiError("Employee ID is invalid.", {
      status: 400,
      code: "INVALID_EMPLOYEE_ID",
    });
  }

  return encodeURIComponent(employeeId);
}

function validateCsrfToken(csrfToken) {
  if (
    typeof csrfToken !== "string" ||
    !/^[0-9a-f]{64}$/i.test(csrfToken)
  ) {
    throw new ApiError(
      "Your security token is unavailable. Please sign in again.",
      {
        status: 401,
        code: "CSRF_UNAVAILABLE",
      }
    );
  }
}

export async function listEmployees(
  { page = 1, pageSize = 20, q = "", status = "", departmentId = "" } = {},
  { signal } = {}
) {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (q.trim()) {
    query.set("q", q.trim());
  }

  if (status) {
    query.set("status", status);
  }
  if(departmentId)query.set('departmentId',departmentId);

  const payload = await apiRequest(
    `/employees?${query.toString()}`,
    { signal }
  );

  const data = payload?.data;
  const pagination = data?.pagination;

  if (
    !Array.isArray(data?.employees) ||
    !data.employees.every(isEmployeeSummary) ||
    !pagination ||
    !Number.isSafeInteger(pagination.page) ||
    pagination.page < 1 ||
    !Number.isSafeInteger(pagination.pageSize) ||
    pagination.pageSize < 1 ||
    pagination.pageSize > 100 ||
    !Number.isSafeInteger(pagination.total) ||
    pagination.total < 0 ||
    !Number.isSafeInteger(pagination.totalPages) ||
    pagination.totalPages !==
      Math.ceil(pagination.total / pagination.pageSize) ||
    pagination.page !== Number(page) ||
    pagination.pageSize !== Number(pageSize) ||
    data.employees.length > pagination.pageSize
  ) {
    throw invalidResponse();
  }

  return {
    employees: data.employees,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: pagination.total,
      totalPages: pagination.totalPages,
    },
  };
}

export async function getEmployeeById(
  employeeId,
  { signal } = {}
) {
  const id = validateEmployeeId(employeeId);

  const payload = await apiRequest(`/employees/${id}`, {
    signal,
  });

  const employee = payload?.data?.employee;

  if (!isEmployeeDetail(employee)) {
    throw invalidResponse();
  }

  return employee;
}

export async function createEmployee(
  data,
  { csrfToken, signal } = {}
) {
  validateCsrfToken(csrfToken);

  const payload = await apiRequest("/employees", {
    method: "POST",
    body: data,
    csrfToken,
    signal,
  });

  const employee = payload?.data?.employee;

  if (
    !isEmployeeSummary(employee) ||
    !hasProfileVersion(employee) ||
    employee.employment === null
  ) {
    throw invalidResponse();
  }

  return employee;
}

export async function updateEmployee(
  employeeId,
  data,
  { csrfToken, signal } = {}
) {
  const id = validateEmployeeId(employeeId);

  validateCsrfToken(csrfToken);

  const payload = await apiRequest(`/employees/${id}`, {
    method: "PATCH",
    body: data,
    csrfToken,
    signal,
  });

  const employee = payload?.data?.employee;

  if (!isEmployeeDetail(employee)) {
    throw invalidResponse();
  }

  return employee;
}
