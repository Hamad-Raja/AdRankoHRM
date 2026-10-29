"use strict";

const MAX_MONEY_MINOR = 99999999999999n;

class PayrollInputError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "PayrollInputError";
    this.code = "PAYROLL_VALIDATION_ERROR";
    this.field = field;
  }
}

function invalid(field, message) {
  throw new PayrollInputError(message, field);
}

function scaledValue(value, field, maximum) {
  if (typeof value !== "string" || value.length > 16) {
    invalid(
      field,
      `${field} must be decimal text with at most two decimal places.`
    );
  }

  const match =
    /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(value);

  if (!match || match[0] !== value) {
    invalid(
      field,
      `${field} must be non-negative decimal text without commas or spaces.`
    );
  }

  const units =
    BigInt(match[1]) * 100n +
    BigInt((match[2] || "").padEnd(2, "0"));

  if (units > maximum) {
    invalid(field, `${field} exceeds its supported limit.`);
  }

  return units;
}

function formatScaled(units, field, maximum) {
  if (
    typeof units !== "bigint" ||
    units < 0n ||
    units > maximum
  ) {
    invalid(
      field,
      `${field} is outside its supported range.`
    );
  }

  return `${units / 100n}.${String(units % 100n).padStart(2, "0")}`;
}

function moneyToMinor(value, field = "amount") {
  return scaledValue(value, field, MAX_MONEY_MINOR);
}

function moneyFromMinor(value, field = "amount") {
  return formatScaled(value, field, MAX_MONEY_MINOR);
}

function daysToUnits(value, field = "days") {
  return scaledValue(value, field, 3100n);
}

function daysFromUnits(value, field = "days") {
  return formatScaled(value, field, 3100n);
}

function payrollPeriod(month) {
  if (
    typeof month !== "string" ||
    month.length !== 7 ||
    !/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)
  ) {
    invalid(
      "month",
      "month must be a valid YYYY-MM value."
    );
  }

  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5));

  const leap =
    year % 4 === 0 &&
    (year % 100 !== 0 || year % 400 === 0);

  const days = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return {
    month,
    dateFrom: `${month}-01`,
    dateTo: `${month}-${days[number - 1]}`,
  };
}

module.exports = {
  PayrollInputError,
  invalid,
  MAX_MONEY_MINOR,
  moneyToMinor,
  moneyFromMinor,
  daysToUnits,
  daysFromUnits,
  payrollPeriod,
};