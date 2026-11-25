import { apiRequest, ApiError } from '@/lib/api';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const invalid = () => { throw new ApiError('The server returned an unexpected scheduling response.', {code:'INVALID_RESPONSE'}); };
const data = payload => payload?.success === true && payload.data && typeof payload.data === 'object' ? payload.data : invalid();
const draftValid = value => value && uuid(value.id) && Number.isInteger(value.revision) && value.revision > 0 && typeof value.policy?.timeZone === 'string' && Array.isArray(value.policy.workDays) && value.policy.breakTrackingEnabled === false && value.policy.automaticBreakDeduction === false;
export async function getAttendanceSettings(options) {
 const value=data(await apiRequest('/attendance-settings',options));
 if(!Array.isArray(value.versions)||!Array.isArray(value.holidayEvents)||!Array.isArray(value.confirmedPolicy?.workDays)||(value.draft!==null&&!draftValid(value.draft)))invalid();
 return value;
}
export async function getMyShift(options) {
 const value=data(await apiRequest('/attendance-settings/my-shift',options));
 if(!['PENDING_ACTIVATION','SCHEDULED_ACTIVATION','PROFILE_LINK_REQUIRED','SETUP_REQUIRED','NOT_ELIGIBLE','SCHEDULED','WEEKLY_OFF','HOLIDAY','LEGACY_ASSIGNMENT_REVIEW'].includes(value.state)||!('current' in value)||!('next' in value))invalid();
 return value;
}
export async function saveScheduleDraft(body,options) { const value=data(await apiRequest('/attendance-settings/draft',{...options,method:'POST',body}));if(!draftValid(value))invalid();return value; }
export async function activateSchedule(body,options) {const value=data(await apiRequest('/attendance-settings/activate',{...options,method:'POST',body}));if(!uuid(value.id)||value.draftId!==body.draftId||value.startTime!=='19:00'||value.endTime!=='05:00'||value.endsNextDay!==true||value.effectiveFrom!==body.effectiveFrom)invalid();return value;}
function eventData(payload,action) {const value=data(payload);if(!uuid(value.id)||typeof value.holidayDate!=='string'||value.action!==action||!Number.isInteger(value.revision))invalid();return value;}
export const announceHoliday = async (body,options) => eventData(await apiRequest('/attendance-settings/holidays',{...options,method:'POST',body}),'ANNOUNCE');
export const cancelHoliday = async (id,body,options) => eventData(await apiRequest(`/attendance-settings/holidays/${encodeURIComponent(id)}/cancel`,{...options,method:'POST',body}),'CANCEL');

export async function discardScheduleDraft(body,options) {const value=data(await apiRequest('/attendance-settings/draft/discard',{...options,method:'POST',body}));if(value.draftId!==body.draftId||!uuid(value.actorUserId)||!Number.isFinite(Date.parse(value.discardedAt)))invalid();return value;}
