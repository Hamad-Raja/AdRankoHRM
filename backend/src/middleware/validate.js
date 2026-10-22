const ApiError = require("../utils/ApiError");

function validateBody(schema) {
  if (!schema || typeof schema.safeParseAsync !== "function") {
    throw new TypeError("validateBody requires a valid Zod schema.");
  }

  return async function validateRequestBody(req, res, next) {
    try {
      const result = await schema.safeParseAsync(req.body);

      if (!result.success) {
        // Return field names and messages, never submitted values.
        const details = result.error.issues.map((issue) => ({
          field: issue.path.map(String).join(".") || "body",
          message: issue.message,
        }));

        return next(
          new ApiError(
            400,
            "Request validation failed.",
            "VALIDATION_ERROR",
            details
          )
        );
      }

      // Controllers will read this validated and normalized data.
      req.validatedBody = result.data;

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = validateBody;