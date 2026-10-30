import { apiRequest } from "@/lib/api";

function toQueryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== "") {
      query.set(key, String(val));
    }
  }
  const str = query.toString();
  return str ? `?${str}` : "";
}

export async function getNotifications(params = {}, options = {}) {
  const response = await apiRequest(`/notifications${toQueryString(params)}`, options);
  return response.data;
}

export async function getUnreadNotificationCount(options = {}) {
  const response = await apiRequest("/notifications/unread-count", options);
  return response.data;
}

export async function markNotificationRead(id, options = {}) {
  const response = await apiRequest(`/notifications/${id}/read`, {
    method: "PATCH",
    ...options,
  });
  return response.data;
}

export async function markAllNotificationsRead(options = {}) {
  const response = await apiRequest("/notifications/mark-all-read", {
    method: "POST",
    ...options,
  });
  return response.data;
}

export async function deleteNotification(id, options = {}) {
  const response = await apiRequest(`/notifications/${id}`, {
    method: "DELETE",
    ...options,
  });
  return response.data;
}

export async function clearReadNotifications(options = {}) {
  const response = await apiRequest("/notifications/read", {
    method: "DELETE",
    ...options,
  });
  return response.data;
}
