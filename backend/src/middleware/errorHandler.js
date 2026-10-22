const ApiError = require("../utils/ApiError");

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