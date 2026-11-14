// Presentation adapters only: classifications and authorization stay in the existing APIs.
export const number = value => Number.isSafeInteger(value) && value >= 0;
export const percentage = (value,total) => total > 0 ? Math.round(value/total*100) : null;
export function dateLabel(date,short=false){return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:short?'short':'long',...(!short?{year:'numeric'}:{})}).format(new Date(date+'T12:00:00Z'));}
export function greeting(instant){const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Karachi',hour:'numeric',hourCycle:'h23'}).format(new Date(instant)));return hour<12?'Good Morning':hour<17?'Good Afternoon':'Good Evening';}
export function periodDates(anchor,period){
 const end=new Date(anchor+'T12:00:00Z'),start=new Date(end);
 if(period==='week')start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
 if(period==='month')start.setUTCDate(1);
 const dates=[];for(let cursor=new Date(start);cursor<=end;cursor.setUTCDate(cursor.getUTCDate()+1))dates.push(cursor.toISOString().slice(0,10));return dates;
}
export function publishedPolicyAvailable(versions,date){
 const version=versions?.filter(v=>v.effectiveFrom<=date).at(-1);
 return !!version&&Array.isArray(version.missing)&&version.missing.length===0&&(version.policy.holidayPolicy!=='DATES'||date>=version.policy.holidayFrom&&date<=version.policy.holidayTo);
}
export function attendanceDay(report,policyConfirmed=true){
 const t=report?.totals,c=t?.classifications;
 if(!t||!c||!['eligibleDuties','actualRecords','noClockIn','paidLeaveDays','leaveConflicts'].every(key=>number(t[key]))||!Object.values(c).every(number))return {state:'UNAVAILABLE'};
 if(!policyConfirmed||report.meta.currentPolicyState!=='EFFECTIVE_POLICY_PRESENT'||c.SETUP_REQUIRED||c.LEGACY_ASSIGNMENT_REVIEW)return {state:'SETUP_REQUIRED',approvedLeave:t.paidLeaveDays};
 // A single server classification per duty prevents leave/attendance double counts.
 const present=['OPEN','COMPLETED','CORRECTED','MISSING_CHECKOUT'].reduce((sum,key)=>sum+(c[key]||0),0),absent=c.NO_CLOCK_IN||0,leave=c.PAID_LEAVE||0;
 const pending=c.NOT_YET_ENDED||0,exceptions=c.APPROVED_EXCEPTION||0,total=t.eligibleDuties;
 if(t.leaveConflicts||present!==t.actualRecords||present+absent+leave+pending+exceptions!==total)return {state:'REVIEW_REQUIRED',approvedLeave:t.paidLeaveDays};
 return {state:total?'READY':'EMPTY',present,absent,leave,pending,exceptions,total,approvedLeave:t.paidLeaveDays,excluded:(c.WEEKLY_OFF||0)+(c.HOLIDAY||0)+(c.NOT_ELIGIBLE||0),rate:percentage(present,total)};
}
export function attendancePeriod(days){
 const states=days.map(day=>attendanceDay(day.report,day.policyConfirmed));
 if(states.some(x=>!['READY','EMPTY'].includes(x.state)))return {state:states.some(x=>x.state==='SETUP_REQUIRED')?'SETUP_REQUIRED':'REVIEW_REQUIRED'};
 const total={state:'READY',present:0,absent:0,leave:0,pending:0,exceptions:0,total:0,excluded:0};for(const row of states)for(const key of Object.keys(total).filter(k=>k!=='state'))total[key]+=row[key];
 return {...total,state:total.total?'READY':'EMPTY',rate:percentage(total.present,total.total)};
}
export const departmentPalette=['#3B82F6','#14B8A6','#A78BFA','#F59E0B','#F472B6','#22D3EE'];
// Allocate across the full catalog, including empty departments, independent of chart order/counts.
export function departmentColors(units){
 const colors=new Map(),used=new Set();
 for(const id of [...new Set(units.filter(unit=>unit.kind==='DEPARTMENT').map(unit=>unit.id))].sort()){
  let hash=2166136261;for(const char of id)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  let index=hash%departmentPalette.length;
  if(used.size<departmentPalette.length)while(used.has(index))index=(index+1)%departmentPalette.length;
  used.add(index);colors.set(id,departmentPalette[index]);
 }
 return colors;
}
export function departments(profiles,total,units){
 if(!Array.isArray(profiles)||!number(total)||profiles.length!==total||new Set(profiles.map(e=>e.id)).size!==total)return null;
 const groups=new Map();for(const employee of profiles){const assignment=employee.assignments?.[0],department=assignment?.department||assignment?.team?.department,label=department?.name||'Unassigned',matches=department&&units?.filter(unit=>unit.kind==='DEPARTMENT'&&unit.name===department.name),key=department?(department.id||assignment.departmentId||assignment.team?.departmentId||(matches?.length===1?matches[0].id:null)):'unassigned';if(!key)return null;const old=groups.get(key)||{id:key,label,count:0};old.count++;groups.set(key,old);}
 return [...groups.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
}
