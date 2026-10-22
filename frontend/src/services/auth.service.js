import { ApiError, apiRequest } from "@/lib/api";

const VALID_ROLES = new Set(["ADMIN", "HR", "MANAGER", "EMPLOYEE"]);
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function readSessionData(response) {
  const data = response?.data;
  const user = data?.user;

  const isValid =
    user &&
    typeof user.id === "string" &&
    typeof user.email === "string" &&
    typeof user.displayName === "string" &&
    VALID_ROLES.has(user.role) &&
    user.status === "ACTIVE" &&
    typeof user.mustChangePassword === "boolean" &&
    typeof data.csrfToken === "string" &&
    TOKEN_PATTERN.test(data.csrfToken) &&
    typeof data.expiresAt === "string" &&
    Number.isFinite(Date.parse(data.expiresAt));

  if (!isValid) {
    throw new ApiError("Unable to verify the authentication response.", {
      code: "INVALID_AUTH_RESPONSE",
    });
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
    },
    csrfToken: data.csrfToken,
    expiresAt: data.expiresAt,
  };
}

function requireCsrfToken(csrfToken) {
  if (
    typeof csrfToken !== "string" ||
    !TOKEN_PATTERN.test(csrfToken)
  ) {
    throw new ApiError(
      "Session verification is unavailable. Please log in again.",
      {
        status: 403,
        code: "CSRF_UNAVAILABLE",
      }
    );
  }
}

export async function login({ email, password }, { signal } = {}) {
  const response = await apiRequest("/auth/login", {
    method: "POST",
    body: {
      email,
      password,
    },
    signal,
  });

  return readSessionData(response);
}

export async function getCurrentUser({ signal } = {}) {
  const response = await apiRequest("/auth/me", {
    signal,
  });

  return readSessionData(response);
}

export async function logout({ csrfToken, signal } = {}) {
  requireCsrfToken(csrfToken);

  return apiRequest("/auth/logout", {
    method: "POST",
    csrfToken,
    signal,
  });
}

export async function changePassword(
  { currentPassword, newPassword },
  { csrfToken, signal } = {}
) {
  requireCsrfToken(csrfToken);

  return apiRequest("/auth/change-password", {
    method: "POST",
    body: {
      currentPassword,
      newPassword,
    },
    csrfToken,
    signal,
  });
}