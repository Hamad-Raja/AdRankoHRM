import { apiRequest } from '@/lib/api';
export const organization = async (options) => (await apiRequest('/organization', options)).data;
export const history = async (id, options) => (await apiRequest(`/organization/employees/${encodeURIComponent(id)}/history`, options)).data;
export const scopeEmployees = async (options) => (await apiRequest('/organization/scope/employees', options)).data;
export const createUnit = async (data, options) => (await apiRequest('/organization', { ...options, method: 'POST', body: data })).data;
export const updateUnit = async (id,data,options)=>(await apiRequest(`/organization/${encodeURIComponent(id)}`,{...options,method:'PATCH',body:data})).data;
export const resetAccountPassword=async(id,input,options)=>(await apiRequest(`/organization/employees/${encodeURIComponent(id)}/reset-password`,{...options,method:'POST',body:input})).data;
export const archiveUnit = async (id, data, options) => (await apiRequest(`/organization/${encodeURIComponent(id)}/archive`, { ...options, method: 'POST', body: data })).data;
export const assignManager = async (id, data, options) => (await apiRequest(`/organization/teams/${encodeURIComponent(id)}/managers`, { ...options, method: 'POST', body: data })).data;
export const assignEmployee = async (id, data, options) => (await apiRequest(`/organization/employees/${encodeURIComponent(id)}/assignments`, { ...options, method: 'POST', body: data })).data;
export const linkAccount = async (id, data, options) => (await apiRequest(`/organization/employees/${encodeURIComponent(id)}/account`, { ...options, method: 'POST', body: data })).data;
export const listDocuments = async (id, options) => (await apiRequest(`/employee-files/${encodeURIComponent(id)}/documents`, options)).data;
export const uploadDocument = async (id, metadata, file, options) => (await apiRequest(`/employee-files/${encodeURIComponent(id)}/documents?${new URLSearchParams(metadata)}`, { ...options, method: 'POST', body: file, mediaType: file.type || 'application/octet-stream' })).data;
export async function downloadDocument(id, document) {
  const blob = await apiRequest(`/employee-files/${encodeURIComponent(id)}/documents/${encodeURIComponent(document.id)}/download`, { download: true });
  const url = URL.createObjectURL(blob), anchor = window.document.createElement('a');
  anchor.href = url; anchor.download = `document-${document.id}.${document.mediaType === 'image/png' ? 'png' : 'txt'}`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
