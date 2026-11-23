export function resolveApiBaseUrl(value, origin) {
  const configured = value?.trim();
  if (!configured) throw new Error("VITE_API_URL is required in the frontend .env file.");
  const relative = configured.startsWith("/");
  if (relative && (configured.startsWith("//") || configured.includes("\\") || !origin)) {
    throw new Error("VITE_API_URL must use a single same-origin path or an HTTP(S) URL.");
  }
  const url = relative ? new URL(configured, origin) : new URL(configured);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || relative && url.origin !== new URL(origin).origin) {
    throw new Error("VITE_API_URL must be a valid HTTP or HTTPS base URL.");
  }
  return url.href.replace(/\/+$/, "");
}

