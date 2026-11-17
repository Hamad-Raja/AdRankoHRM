import { apiRequest } from "@/lib/api";
import { inboxChanged } from "@/lib/module-events";

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
  const response = await apiRequest(
    `/announcements${toQueryString(params)}`,
    options,
  );
  return response.data;
}

export async function getManagementAnnouncements(params = {}, options = {}) {
  const response = await apiRequest(
    `/announcements/management/list${toQueryString(params)}`,
    options,
  );
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
  inboxChanged();
  return response.data;
}

export async function markAllAnnouncementsRead(options = {}) {
  const response = await apiRequest("/announcements/read-all", {
    method: "POST",
    ...options,
  });
  inboxChanged();
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
  const response = await apiRequest(
    `/announcements/${id}/acknowledgements`,
    options,
  );
  return response.data;
}

export async function getManagementAnnouncement(id, options = {}) {
  return (await apiRequest(`/announcements/management/${id}`, options)).data;
}
export async function previewAudience(body, options = {}) {
  return (
    await apiRequest("/announcements/audience-preview", {
      method: "POST",
      body,
      ...options,
    })
  ).data;
}
export async function publishAnnouncement(id, body, options = {}) {
  const r = await apiRequest(`/announcements/${id}/publish`, {
    method: "POST",
    body,
    ...options,
  });
  inboxChanged();
  return r.data;
}
export async function archiveAnnouncement(id, body, options = {}) {
  const r = await apiRequest(`/announcements/${id}/archive`, {
    method: "POST",
    body,
    ...options,
  });
  inboxChanged();
  return r.data;
}
