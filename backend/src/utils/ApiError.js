class ApiError extends Error {
  constructor(
    statusCode,
    message,
    code = "REQUEST_FAILED",
    details = null
  ) {
    super(message);

    if (
      !Number.isInteger(statusCode) ||
      statusCode < 400 ||
      statusCode > 599
    ) {
      throw new TypeError(
        "API error status code must be an integer between 400 and 599."
      );
    }

    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    Error.captureStackTrace(this, ApiError);
  }
}

module.exports = ApiError;