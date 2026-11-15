"use strict";

const { z } = require("zod");
const {
  emailSchema,
  newPasswordSchema,
} = require("./auth.validation");

const DISALLOWED_CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function textField(label, maxLength) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(maxLength, `${label} must not exceed ${maxLength} characters.`)
    .refine(
      (value) => !DISALLOWED_CONTROL_CHARACTERS.test(value),
      `${label} contains unsupported control characters.`
    );
}

function optionalField(schema) {
  return z.preprocess((value) => {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    }

    return value;
  }, schema.nullable());
}

const calendarDateSchema = z.iso.date().refine(
  (value) => !value.startsWith("0000-"),
  "Year must be between 0001 and 9999."
);

const employeeCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, "Employee code is required.")
  .max(30, "Employee code must not exceed 30 characters.")
  .regex(
    /^[A-Z0-9][A-Z0-9_-]*$/,
    "Employee code must start with a letter or number and contain only letters, numbers, hyphens, or underscores."
  );

const personalEmailSchema = optionalField(
  z
    .email({ error: "Enter a valid personal email address." })
    .max(254, "Personal email must not exceed 254 characters.")
    .transform((value) => value.toLowerCase())
);

const phoneSchema = optionalField(
  textField("Phone number", 32)
    .regex(
      /^\+?[0-9(). -]+$/,
      "Phone number contains unsupported characters."
    )
    .refine(
      (value) => /[0-9]/.test(value),
      "Phone number must contain digits."
    )
);

const employmentSchema = z
  .strictObject({
    startDate: calendarDateSchema,

    status: z.enum(["PROBATION", "ACTIVE"], {
      error: "Initial employment status must be PROBATION or ACTIVE.",
    }),

    probationEndDate: optionalField(calendarDateSchema),
    confirmedOn: optionalField(calendarDateSchema),
    employmentType: optionalField(z.enum(['FULL_TIME','PART_TIME','CONTRACT','INTERNSHIP','TEMPORARY'])),
    reason: textField("Employment creation reason", 1000),
  })
  .refine(
    (data) =>
      data.probationEndDate === null ||
      data.probationEndDate >= data.startDate,
    {
      message: "Probation end date cannot be before joining date.",
      path: ["probationEndDate"],
    }
  )
  .refine(
    (data) =>
      data.confirmedOn === null ||
      data.confirmedOn >= data.startDate,
    {
      message: "Confirmation date cannot be before joining date.",
      path: ["confirmedOn"],
    }
  )
  .refine(
    (data) =>
      data.status !== "PROBATION" ||
      data.confirmedOn === null,
    {
      message: "An employee on probation cannot already be confirmed.",
      path: ["confirmedOn"],
    }
  );

const createEmployeeSchema = z.strictObject({
  employeeCode: employeeCodeSchema.optional(),
  fullName: textField("Full name", 120),
  personalEmail: personalEmailSchema,
  phone: phoneSchema,
  address: optionalField(textField("Address", 1000)),
  cnic: optionalField(z.string().transform(value=>/^\d{13}$/.test(value)?value.slice(0,5)+'-'+value.slice(5,12)+'-'+value.slice(12):value).pipe(z.string().regex(/^\d{5}-\d{7}-\d$/, 'Use 13 CNIC digits, for example 12345-1234567-1.'))),
  location: optionalField(textField('Location',160).refine(value=>!/[\r\n\t]/.test(value),'Use a single-line location.')),

  emergencyContactName: optionalField(
    textField("Emergency contact name", 120)
  ),

  emergencyContactPhone: phoneSchema,

  emergencyContactRelationship: optionalField(
    textField("Emergency contact relationship", 60)
  ),

  employment: employmentSchema,
  organization: z.strictObject(require('./organization.validation').organizationFields).optional(),
  startingSalary: require('./payroll-api.validation').salary.pick({monthlyBasic:true,effectiveMonth:true}).optional(),

  // Optional for existing profile-only API clients.
  // The updated Add Employee form requires these credentials.
  portalLogin: z
    .strictObject({
      email: emailSchema,
      password: newPasswordSchema,
      role: z.enum(["EMPLOYEE", "MANAGER", "HR"]).default("EMPLOYEE"),
    })
    .optional(),
});

const updateEmployeeSchema = z
  .strictObject({
    version: z.number().int().positive().max(2147483647),
    fullName: createEmployeeSchema.shape.fullName.optional(),
    personalEmail: personalEmailSchema.optional(),
    phone: phoneSchema.optional(),
    address: createEmployeeSchema.shape.address.optional(),
    cnic: createEmployeeSchema.shape.cnic.optional(),
    location: createEmployeeSchema.shape.location.optional(),
    employmentType: optionalField(z.enum(['FULL_TIME','PART_TIME','CONTRACT','INTERNSHIP','TEMPORARY'])).optional(),
    employmentEpisodeId: z.uuid().optional(),
    expectedEmploymentVersion: z.number().int().positive().max(2147483647).optional(),

    emergencyContactName:
      createEmployeeSchema.shape.emergencyContactName.optional(),

    emergencyContactPhone: phoneSchema.optional(),

    emergencyContactRelationship:
      createEmployeeSchema.shape.emergencyContactRelationship.optional(),
    probationEndDate: optionalField(calendarDateSchema).optional(),
    confirmedOn: optionalField(calendarDateSchema).optional(),
  })
  .refine(
    (data) =>
      ['fullName','personalEmail','phone','address','cnic','location','emergencyContactName','emergencyContactPhone','emergencyContactRelationship','probationEndDate','confirmedOn','employmentType'].some(field=>Object.hasOwn(data,field)&&data[field]!==undefined),
    "Provide at least one editable profile field."
  ).refine(data=>!Object.hasOwn(data,'employmentType')||(!!data.employmentEpisodeId&&!!data.expectedEmploymentVersion),'Employment type changes require the episode ID and current version.');

function positiveIntegerParameter(label, maximum, fallback) {
  return z
    .string()
    .regex(
      /^[1-9]\d{0,5}$/,
      `${label} must be a positive whole number.`
    )
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(1)
        .max(maximum, `${label} must not exceed ${maximum}.`)
    )
    .default(fallback);
}

const listEmployeesQuerySchema = z.strictObject({
  page: positiveIntegerParameter("Page", 10000, 1),
  pageSize: positiveIntegerParameter("Page size", 100, 20),
  departmentId: z.uuid().optional(),

  q: z
    .string()
    .trim()
    .max(120, "Search must not exceed 120 characters.")
    .regex(
      /^[^\u0000-\u001F\u007F]*$/,
      "Search contains unsupported control characters."
    )
    .default(""),

  status: z
    .enum([
      "PROBATION",
      "ACTIVE",
      "NOTICE_PERIOD",
      "SUSPENDED",
      "EXITED",
    ])
    .optional(),
});

const employeeIdParamsSchema = z.strictObject({
  employeeId: z.uuid({
    error: "Employee ID must be a valid UUID.",
  }),
});

module.exports = {
  listEmployeesQuerySchema,
  employeeIdParamsSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
};
