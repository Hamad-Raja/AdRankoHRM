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

export async function getAnnouncements(params = {}, options = {}) {
  const response = await apiRequest(`/announcements${toQueryString(params)}`, options);
  return response.data;
}

export async function getManagementAnnouncements(params = {}, options = {}) {
  const response = await apiRequest(`/announcements/management/list${toQueryString(params)}`, options);
  return response.data;
}

export async function getAnnouncement(id, options = {}) {
  const response = await apiRequest(`/announcements/${id}`, options);
  return response.data;
}

export async function markAnnouncementRead(id, options = {}) {
  const response = await apiRequest(`/announcements/${id}/read`, {
    method: "POST",
    ...options,
  });
  return response.data;
}

export async function markAllAnnouncementsRead(options = {}) {
  const response = await apiRequest("/announcements/read-all", {
    method: "POST",
    ...options,
  });
  return response.data;
}

export async function createAnnouncement(data, options = {}) {
  const response = await apiRequest("/announcements", {
    method: "POST",
    body: data,
    ...options,
  });
  return response.data;
}

export async function updateAnnouncement(id, data, options = {}) {
  const response = await apiRequest(`/announcements/${id}`, {
    method: "PATCH",
    body: data,
    ...options,
  });
  return response.data;
}

export async function deleteAnnouncement(id, options = {}) {
  const response = await apiRequest(`/announcements/${id}`, {
    method: "DELETE",
    ...options,
  });
  return response.data;
}

export async function getAcknowledgements(id, options = {}) {
  const response = await apiRequest(`/announcements/${id}/acknowledgements`, options);
  return response.data;
}
