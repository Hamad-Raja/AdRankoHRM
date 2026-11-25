"use strict";

const {
  invalid,
  moneyToMinor,
  moneyFromMinor,
  daysToUnits,
  daysFromUnits,
  payrollPeriod,
} = require("../utils/payroll-values");

const EARNING_TYPES = Object.freeze([
  "ALLOWANCE",
  "BONUS",
  "COMMISSION",
  "OVERTIME",
  "OTHER",
]);

const DEDUCTION_TYPES = Object.freeze([
  "TAX",
  "ADVANCE_RECOVERY",
  "LOAN_RECOVERY",
  "OTHER",
]);

function object(value, field, allowed) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(
      Object.getPrototypeOf(value)
    )
  ) {
    invalid(field, `${field} must be a plain object.`);
  }

  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalid(
        field,
        `${field} contains an unsupported field: ${key}.`
      );
    }
  }
}

function lineItems(value, field, types) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || value.length > 50) {
    invalid(
      field,
      `${field} must contain at most 50 line items.`
    );
  }

  const result = [];

  for (const [index,item] of value.entries()) {
    const itemField = `${field}.${index}`;
    object(item, itemField, ["type", "label", "amount"]);

    if (!types.includes(item.type)) {
      invalid(`${itemField}.type`, `Unsupported ${field} type.`);
    }

    if (
      (item.label !== undefined && typeof item.label !== "string") ||
      (item.label || '').trim().length > 120 ||
      [...(item.label || '')].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      })
    ) {
      invalid(
        `${itemField}.label`,
        `${field} descriptions must contain at most 120 characters without control characters.`
      );
    }

    const amount = moneyToMinor(
      item.amount,
      `${itemField}.amount`
    );

    if (amount === 0n) {
      invalid(
        `${itemField}.amount`,
        `Omit unused ${field} items instead of adding a zero amount.`
      );
    }

    result.push({
      type: item.type,
      label: item.label?.trim() || item.type.toLowerCase().split('_').map(word=>word[0].toUpperCase()+word.slice(1)).join(' '),
      amount: moneyFromMinor(amount),
    });
  }

  return result;
}

// Calculator input only. The future payroll write service must
// load saved salaries from the database and enforce authorization.
function parsePayrollPreviewInput(input) {
  object(input, "payroll", [
    "month",
    "currency",
    "monthlyBasic",
    "totalPayableDays",
    "workedDays",
    "earnings",
    "deductions",
  ]);

  payrollPeriod(input.month);

  if (
    input.currency !== undefined &&
    input.currency !== "PKR"
  ) {
    invalid("currency", "Payroll currency must be PKR.");
  }

  const basic = moneyToMinor(
    input.monthlyBasic,
    "monthlyBasic"
  );

  if (basic === 0n) {
    invalid(
      "monthlyBasic",
      "Monthly basic salary must be greater than zero."
    );
  }

  const total = daysToUnits(
    input.totalPayableDays,
    "totalPayableDays"
  );

  const worked = daysToUnits(
    input.workedDays,
    "workedDays"
  );

  if (total === 0n) {
    invalid(
      "totalPayableDays",
      "Total payable days must be greater than zero."
    );
  }

  if (worked > total) {
    invalid(
      "workedDays",
      "Worked days cannot exceed total payable days."
    );
  }

  return {
    month: input.month,
    currency: "PKR",
    monthlyBasic: moneyFromMinor(basic),
    totalPayableDays: daysFromUnits(total),
    workedDays: daysFromUnits(worked),
    earnings: lineItems(
      input.earnings,
      "earnings",
      EARNING_TYPES
    ),
    deductions: lineItems(
      input.deductions,
      "deductions",
      DEDUCTION_TYPES
    ),
  };
}

module.exports = {
  parsePayrollPreviewInput,
  EARNING_TYPES,
  DEDUCTION_TYPES,
};
