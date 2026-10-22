const REQUEST_TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  constructor(
    message,
    { status = 0, code = "API_ERROR", details = null } = {}
  ) {
    super(message);

    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getApiBaseUrl() {
  const configuredUrl = import.meta.env.VITE_API_URL?.trim();

  if (!configuredUrl) {
    throw new Error("VITE_API_URL is required in the frontend .env file.");
  }

  const url = new URL(configuredUrl);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("VITE_API_URL must be a valid HTTP or HTTPS base URL.");
  }

  return url.href.replace(/\/+$/, "");
}

const API_BASE_URL = getApiBaseUrl();

export async function apiRequest(
  path,
  { method = "GET", body, csrfToken, signal, mediaType, download = false } = {}
) {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//")
  ) {
    throw new TypeError("API request path must start with a single slash.");
  }

  const headers = new Headers({
    Accept: "application/json",
  });

  if (body !== undefined) {
    headers.set("Content-Type", mediaType || "application/json");
  }

  if (csrfToken) {
    headers.set("x-csrf-token", csrfToken);
  }

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: requestSignal,
      body: body === undefined ? undefined : mediaType ? body : JSON.stringify(body),
    });

    if (response.status === 204) {
      return null;
    }

    if (download && response.ok) return await response.blob();

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      throw new ApiError("The server returned an unexpected response.", {
        status: response.status,
        code: "INVALID_RESPONSE",
      });
    }

    let payload;

    try {
      payload = await response.json();
    } catch (error) {
      if (requestSignal.aborted) {
        throw error;
      }

      throw new ApiError("The server returned an unreadable response.", {
        status: response.status,
        code: "INVALID_RESPONSE",
      });
    }

    if (!response.ok || payload?.success === false) {
      throw new ApiError(
        typeof payload?.message === "string"
          ? payload.message
          : "The request could not be completed.",
        {
          status: response.status,
          code:
            typeof payload?.code === "string"
              ? payload.code
              : "REQUEST_FAILED",
          details: payload?.details ?? null,
        }
      );
    }

    if (payload?.success !== true) {
      throw new ApiError("The server response is missing expected data.", {
        status: response.status,
        code: "INVALID_RESPONSE",
      });
    }

    return payload;
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    if (timeoutSignal.aborted) {
      throw new ApiError("The request timed out. Please try again.", {
        code: "REQUEST_TIMEOUT",
      });
    }

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      "Unable to reach OfficeHR. Check your connection and try again.",
      {
        code: "NETWORK_ERROR",
      }
    );
  }
}
