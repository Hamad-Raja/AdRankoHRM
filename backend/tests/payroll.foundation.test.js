"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PayrollInputError,
  MAX_MONEY_MINOR,
  moneyToMinor,
  moneyFromMinor,
  daysToUnits,
  payrollPeriod,
} = require("../src/utils/payroll-values");

const {
  parsePayrollPreviewInput,
} = require("../src/validation/payroll.validation");

const {
  calculatePayrollPreview,
} = require("../src/utils/payroll-calculator");

const base = () => ({
  month: "2026-10",
  monthlyBasic: "44000",
  totalPayableDays: "22",
  workedDays: "20",
});

const item = (type, amount, label = type) => ({
  type,
  amount,
  label,
});

const rejects = (input) =>
  assert.throws(
    () => calculatePayrollPreview(input),
    PayrollInputError
  );

test("PKR money calculates exactly without floating-point arithmetic", () => {
  assert.equal(
    moneyToMinor("0.10") + moneyToMinor("0.20"),
    30n
  );

  assert.equal(moneyFromMinor(30n), "0.30");
  assert.equal(
    moneyFromMinor(moneyToMinor("123.4")),
    "123.40"
  );
});

test("money rejects invalid formats and excess precision", () => {
  for (const value of [
    1,
    NaN,
    Infinity,
    null,
    undefined,
    "",
    " 10",
    "10 ",
    "10\n",
    "01",
    "-1",
    "+1",
    "1e3",
    "1,000",
    "1.001",
    "١٠",
  ]) {
    assert.throws(
      () => moneyToMinor(value),
      PayrollInputError
    );
  }
});

test("money boundaries reject overflow without truncation", () => {
  assert.equal(
    moneyToMinor("999999999999.99"),
    MAX_MONEY_MINOR
  );

  assert.equal(
    moneyFromMinor(MAX_MONEY_MINOR),
    "999999999999.99"
  );

  assert.throws(
    () => moneyToMinor("1000000000000"),
    PayrollInputError
  );

  assert.throws(
    () => moneyFromMinor(-1n),
    PayrollInputError
  );
});

test("periods cover the first through last calendar date", () => {
  assert.equal(
    payrollPeriod("2024-02").dateTo,
    "2024-02-29"
  );

  assert.equal(
    payrollPeriod("2100-02").dateTo,
    "2100-02-28"
  );

  assert.equal(
    payrollPeriod("2026-10").dateFrom,
    "2026-10-01"
  );

  assert.equal(
    payrollPeriod("9999-12").dateTo,
    "9999-12-31"
  );
});

test("invalid and year-zero months are rejected", () => {
  for (const month of [
    "0000-01",
    "2026-13",
    "2026-1",
    "2026-10\n",
    202610,
    undefined,
  ]) {
    rejects({ ...base(), month });
  }
});

test("manual days prorate basic salary using the entered denominator", () => {
  const value = calculatePayrollPreview(base());

  assert.equal(value.earnedBasic, "40000.00");
  assert.equal(value.unearnedBasic, "4000.00");
  assert.equal(value.netPay, "40000.00");
  assert.equal(value.basis, "MANUAL_DAYS");
});

test("calendar days do not replace the manually entered denominator", () => {
  const value = calculatePayrollPreview({
    ...base(),
    month: "2026-02",
    monthlyBasic: "30000",
    totalPayableDays: "30",
    workedDays: "20",
  });

  assert.equal(value.earnedBasic, "20000.00");
  assert.equal(value.period.dateTo, "2026-02-28");
});

test("zero worked days produce zero basic pay", () => {
  const value = calculatePayrollPreview({
    ...base(),
    workedDays: "0",
  });

  assert.equal(value.earnedBasic, "0.00");
  assert.equal(value.netPay, "0.00");
  assert.equal(value.unearnedBasic, "44000.00");
});

test("all payable days worked preserve full salary", () => {
  const value = calculatePayrollPreview({
    ...base(),
    workedDays: "22",
  });

  assert.equal(value.netPay, "44000.00");
});

test("fractional days retain exact precision", () => {
  assert.equal(daysToUnits("0.5"), 50n);

  const value = calculatePayrollPreview({
    ...base(),
    totalPayableDays: "22",
    workedDays: "10.5",
  });

  assert.equal(value.earnedBasic, "21000.00");
});

test("missing, zero, negative and oversized day inputs fail", () => {
  for (const changes of [
    { totalPayableDays: "0" },
    { totalPayableDays: undefined },
    { workedDays: undefined },
    { workedDays: "23" },
    { workedDays: "-1" },
    { workedDays: "1.001" },
    { totalPayableDays: "32" },
    { workedDays: 20 },
  ]) {
    rejects({ ...base(), ...changes });
  }
});

test("basic salary is positive and currency is PKR only", () => {
  for (const changes of [
    { monthlyBasic: undefined },
    { monthlyBasic: "0" },
    { currency: "USD" },
    { currency: null },
  ]) {
    rejects({ ...base(), ...changes });
  }

  assert.equal(
    calculatePayrollPreview(base()).currency,
    "PKR"
  );
});

test("earnings and deductions are optional", () => {
  const value = parsePayrollPreviewInput(base());

  assert.deepEqual(value.earnings, []);
  assert.deepEqual(value.deductions, []);
});

test("all earning categories add their entered amounts", () => {
  const earnings = [
    "ALLOWANCE",
    "BONUS",
    "COMMISSION",
    "OVERTIME",
    "OTHER",
  ].map((type) => item(type, "100"));

  const value = calculatePayrollPreview({
    ...base(),
    earnings,
  });

  assert.equal(value.additionalEarnings, "500.00");
  assert.equal(value.grossPay, "40500.00");
});

test("manual tax, advance, loan and other deductions sum independently", () => {
  const deductions = [
    "TAX",
    "ADVANCE_RECOVERY",
    "LOAN_RECOVERY",
    "OTHER",
  ].map((type) => item(type, "100"));

  const value = calculatePayrollPreview({
    ...base(),
    deductions,
  });

  assert.equal(value.totalDeductions, "400.00");
  assert.equal(value.netPay, "39600.00");
});

test("entered period adjustments are not automatically prorated", () => {
  const value = calculatePayrollPreview({
    ...base(),
    earnings: [
      item("ALLOWANCE", "2000"),
    ],
    deductions: [
      item("OTHER", "500", "Approved adjustment"),
    ],
  });

  assert.equal(value.earnedBasic, "40000.00");
  assert.equal(value.grossPay, "42000.00");
  assert.equal(value.netPay, "41500.00");
});

test("half-paisa ties round upward once", () => {
  const value = calculatePayrollPreview({
    ...base(),
    monthlyBasic: "0.01",
    totalPayableDays: "2",
    workedDays: "1",
  });

  assert.equal(value.earnedBasic, "0.01");
  assert.equal(value.unearnedBasic, "0.00");
});

test("rounding applies to earned basic rather than the daily rate", () => {
  const value = calculatePayrollPreview({
    ...base(),
    monthlyBasic: "100",
    totalPayableDays: "3",
    workedDays: "2",
  });

  assert.equal(value.earnedBasic, "66.67");
  assert.equal(value.unearnedBasic, "33.33");
});

test("deductions may reduce net to zero but cannot make it negative", () => {
  rejects({
    ...base(),
    deductions: [
      item("OTHER", "40000.01"),
    ],
  });

  assert.equal(
    calculatePayrollPreview({
      ...base(),
      deductions: [
        item("OTHER", "40000"),
      ],
    }).netPay,
    "0.00"
  );
});

test("calculated totals reject monetary overflow", () => {
  rejects({
    ...base(),
    monthlyBasic: "999999999999.99",
    workedDays: "22",
    earnings: [
      item("BONUS", "0.01"),
    ],
  });
});

test("invalid objects and injected calculated or approval fields fail", () => {
  for (const input of [
    null,
    [],
    Object.create({ role: "ADMIN" }),
    { ...base(), netPay: "1" },
    { ...base(), status: "APPROVED" },
    { ...base(), employeeId: "forged" },
    { ...base(), attendanceDays: 20 },
  ]) {
    rejects(input);
  }
});

test("adjustments require a valid type, label and positive amount", () => {
  for (const row of [
    item("TAX", "1"),
    item("BONUS", "0"),
    item("BONUS", "1", ""),
    item("BONUS", "1", "a\nb"),
    {
      ...item("BONUS", "1"),
      approvedBy: "fake",
    },
  ]) {
    rejects({
      ...base(),
      earnings: [row],
    });
  }

  rejects({
    ...base(),
    deductions: [
      item("BONUS", "1"),
    ],
  });
});

test("adjustment lists are bounded and reject null", () => {
  rejects({ ...base(), earnings: null });
  rejects({ ...base(), deductions: {} });

  rejects({
    ...base(),
    earnings: Array.from(
      { length: 51 },
      () => item("BONUS", "1")
    ),
  });
});

test("results preserve input and contain JSON-safe decimal strings", () => {
  const input = {
    ...base(),
    earnings: [
      item("BONUS", "0.1", "  Performance  "),
    ],
  };

  const before = JSON.stringify(input);
  const value = calculatePayrollPreview(input);

  assert.equal(JSON.stringify(input), before);
  assert.equal(value.earnings[0].label, "Performance");
  assert.equal(value.earnings[0].amount, "0.10");

  assert.equal(
    JSON.parse(JSON.stringify(value)).netPay,
    "40000.10"
  );
});