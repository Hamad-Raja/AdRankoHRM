import { apiRequest, ApiError } from "@/lib/api";

import {
  REPORT_TYPES,
  exportQuery,
  validateReport,
  reportFilename,
  validateReportBlob,
} from "@/lib/reports";

function checkType(report) {
  if (!REPORT_TYPES.includes(report)) {
    throw new ApiError("Invalid report type.", {
      code: "VALIDATION_ERROR",
    });
  }
}

export async function getReport(
  report,
  queryString,
  options = {}
) {
  checkType(report);

  const payload = await apiRequest(
    `/reports/${report}?${queryString}`,
    options
  );

  try {
    return validateReport(payload, report);
  } catch (error) {
    throw new ApiError(error.message, {
      code: "INVALID_RESPONSE",
    });
  }
}

export async function downloadReport(
  report,
  queryString,
  meta,
  format,
  options = {}
) {
  checkType(report);

  const query = exportQuery(queryString, format);
  const filename = reportFilename(report, meta, format);

  const blob = await apiRequest(
    `/reports/${report}/export?${query}`,
    {
      ...options,
      download: true,
    }
  );

  try {
    await validateReportBlob(blob, format);
  } catch (error) {
    throw new ApiError(error.message, {
      code: "INVALID_RESPONSE",
    });
  }

  return { blob, filename };
}