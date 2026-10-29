"use strict";

const {
  parsePayrollPreviewInput,
} = require("../validation/payroll.validation");

const {
  invalid,
  moneyToMinor,
  moneyFromMinor,
  daysToUnits,
  payrollPeriod,
} = require("./payroll-values");

function calculatePayrollPreview(input) {
  const value = parsePayrollPreviewInput(input);

  const basic = moneyToMinor(value.monthlyBasic);
  const totalDays = daysToUnits(value.totalPayableDays);
  const workedDays = daysToUnits(value.workedDays);

  // Round the earned basic once to the nearest paisa.
  // Exactly half a paisa rounds upward.
  const earned =
    (2n * basic * workedDays + totalDays) /
    (2n * totalDays);

  const earnings = value.earnings.reduce(
    (sum, item) => sum + moneyToMinor(item.amount),
    0n
  );

  const deductions = value.deductions.reduce(
    (sum, item) => sum + moneyToMinor(item.amount),
    0n
  );

  const gross = earned + earnings;

  if (deductions > gross) {
    invalid(
      "deductions",
      "Total deductions cannot exceed gross pay."
    );
  }

  return {
    ...value,
    period: payrollPeriod(value.month),
    calculationVersion: "MANUAL_DAYS_V1",
    basis: "MANUAL_DAYS",
    rounding: "HALF_UP_TO_PAISA",

    earnedBasic: moneyFromMinor(
      earned,
      "earnedBasic"
    ),

    unearnedBasic: moneyFromMinor(
      basic - earned,
      "unearnedBasic"
    ),

    additionalEarnings: moneyFromMinor(
      earnings,
      "additionalEarnings"
    ),

    grossPay: moneyFromMinor(
      gross,
      "grossPay"
    ),

    totalDeductions: moneyFromMinor(
      deductions,
      "totalDeductions"
    ),

    netPay: moneyFromMinor(
      gross - deductions,
      "netPay"
    ),
  };
}

module.exports = {
  calculatePayrollPreview,
};