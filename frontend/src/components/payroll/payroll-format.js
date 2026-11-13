export const inputClass = 'h-11 w-full min-w-0 rounded-lg border border-input bg-background/70 px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60';
export const earningTypes = ['ALLOWANCE', 'BONUS', 'COMMISSION', 'OVERTIME', 'OTHER'];
export const deductionTypes = ['TAX', 'ADVANCE_RECOVERY', 'LOAN_RECOVERY', 'OTHER'];
export function salaryForMonth(history,month){const boundary=history?.rehireBoundaries?.find(item=>item.month<=month);return history?.versions.find(version=>version.effectiveMonth<=month&&(!boundary||version.effectiveMonth>=boundary.month&&!boundary.excludedVersionIds.includes(version.id)))||null;}
export function readable(value = '') {
  return value === 'HR_APPROVED' ? 'HR Approved' : value === 'APPROVED' ? 'Finalized' : value.toLowerCase().split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
// Display canonical decimal strings without calculating or rounding money.
export function pkr(value) {
  if (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d{1,2})?$/.test(value)) return 'Unavailable';
  const sign = /^[+-]/.test(value) ? value[0] : '';
  const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  return `${sign}PKR ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0')}`;
}
export function currentMonth() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {timeZone:'Asia/Karachi',year:'numeric',month:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}`;
}
export function dateTime(value) {
  return value ? new Intl.DateTimeFormat('en-PK', {timeZone:'Asia/Karachi',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : 'Not recorded';
}
