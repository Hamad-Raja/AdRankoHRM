const ApiError = require("../utils/ApiError");
const { ROLES } = require("../config/auth");

function authorize(...allowedRoles) {
  if (
    allowedRoles.length === 0 ||
    allowedRoles.some((role) => !ROLES.includes(role))
  ) {
    throw new TypeError(
      "authorize requires at least one valid OfficeHR role."
    );
  }

  const permittedRoles = new Set(allowedRoles);

  return function authorizeRequest(req, res, next) {
    if (!req.auth?.user) {
      return next(
        new ApiError(
          401,
          "Please log in to continue.",
          "UNAUTHENTICATED"
        )
      );
    }

    if (!permittedRoles.has(req.auth.user.role)) {
      return next(
        new ApiError(
          403,
          "You do not have permission to perform this action.",
          "FORBIDDEN"
        )
      );
    }

    return next();
  };
}

module.exports = authorize;