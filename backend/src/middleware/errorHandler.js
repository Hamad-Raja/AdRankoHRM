const ApiError = require("../utils/ApiError");

function transactionDiagnostic(error) {
  // Prisma messages can include rendered source and query arguments. Retain
  // only its transaction diagnostic, never the invocation context.
  const marker = 'Transaction API error:';
  const message = String(error.message || '');
  const diagnostic = message.includes(marker) ? message.slice(message.lastIndexOf(marker)) : error.meta?.error;
  const sanitize = value => String(value || '')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[connection redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
    .replace(/\b[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/gi, '[id redacted]')
    .replace(/(["'`])[^\n]*?\1/g, '[quoted value redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[identifier redacted]');
  return {
    message: diagnostic ? sanitize(diagnostic) : '[unrecognized transaction message omitted]',
    meta: { ...(error.meta?.modelName ? { modelName: sanitize(error.meta.modelName) } : {}),
      ...(error.meta?.error ? { error: sanitize(error.meta.error) } : {}) },
    stack: String(error.stack || '').split('\n').filter(line => /^\s+at /.test(line)).map(sanitize),
  };
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  let statusCode = 500;
  let message = "Internal server error.";
  let code = "INTERNAL_SERVER_ERROR";
  let details = null;

  if (error instanceof ApiError) {
    // ApiError messages must be safe to show to the client.
    statusCode = error.statusCode;
    message = error.message;
    code = error.code;

    if (statusCode < 500) {
      details = error.details;
    }
  } else if (error?.type === "entity.parse.failed") {
    statusCode = 400;
    message = "Request body must contain valid JSON.";
    code = "INVALID_JSON";
  } else if (error?.type === "entity.too.large") {
    statusCode = 413;
    message = "Request body exceeds the allowed size.";
    code = "PAYLOAD_TOO_LARGE";
  } else if (
    error?.type === "encoding.unsupported" ||
    error?.type === "charset.unsupported"
  ) {
    statusCode = 415;
    message = "Request encoding or character set is not supported.";
    code = "UNSUPPORTED_ENCODING";
  }

  if (statusCode >= 500) {
    // Avoid logging request bodies, cookies, tokens, or database queries.
    console.error("API server error:", {
      method: req.method,
      path: req.path,
      errorName: error?.name || "UnknownError",
      errorCode: error?.code || code,
      statusCode,
      ...(error?.code === 'P2028' && Number.isFinite(req.attendanceReadStartedAt) ? {
        elapsedMs: Math.round(performance.now() - req.attendanceReadStartedAt),
        transaction: transactionDiagnostic(error),
      } : {}),
    });
  }

  const response = {
    success: false,
    message,
    code,
  };

  if (details !== null) {
    response.details = details;
  }

  res.setHeader("Cache-Control", "no-store");

  return res.status(statusCode).json(response);
}

module.exports = errorHandler;
