import {fieldAppearance} from '@/components/ui/field-styles';
export const inputClass = fieldAppearance + ' h-11 w-full min-w-0 rounded-lg border border-input bg-background/70 px-3 text-sm font-normal text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60';
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
// Reorder date-only API strings directly, without applying a timezone offset.
export function calendarDate(value) {
  return typeof value === 'string' ? value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3-$2-$1') : value;
}
export function calendarMonth(value) {
  return typeof value === 'string' ? value.replace(/^(\d{4})-(\d{2})$/, '$2/$1') : value;
}
export function dateTime(value, {numericDate = false} = {}) {
  if (value && numericDate) {
    const date = new Date(value);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-PK', {timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(part=>[part.type,part.value]));
    const time = new Intl.DateTimeFormat('en-PK', {timeZone:'Asia/Karachi',timeStyle:'short'}).format(date);
    return `${parts.day}-${parts.month}-${parts.year}, ${time}`;
  }
  return value ? new Intl.DateTimeFormat('en-PK', {timeZone:'Asia/Karachi',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : 'Not recorded';
}

export function preparationMonth(value){
 if(!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value||''))return 'Payroll month not selected';
 return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(value+'-01T00:00:00Z'));
}
// Existing batch adjustment total, shared for display only; server previews own pay calculations.
export function adjustmentTotal(items){
 let sum=0n;
 for(const item of items){if(!/^(0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(item.amount)||item.amount.length>16)return 'Incomplete amounts';const [whole,fraction='']=item.amount.split('.');const amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));if(amount===0n)return 'Incomplete amounts';sum+=amount;}
 return pkr(`${sum/100n}.${String(sum%100n).padStart(2,'0')}`);
}
