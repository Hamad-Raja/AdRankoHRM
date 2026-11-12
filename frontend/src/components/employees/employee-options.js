export const employmentStatuses=[['PROBATION','Probation'],['ACTIVE','Active'],['NOTICE_PERIOD','Notice period'],['SUSPENDED','Suspended'],['EXITED','Exited']];
export const employmentTypes=[['FULL_TIME','Full-time'],['PART_TIME','Part-time'],['CONTRACT','Contract'],['INTERNSHIP','Internship'],['TEMPORARY','Temporary']];
const dateFormatter=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
export function employeeDate(value){return value?dateFormatter.format(new Date(value+'T00:00:00Z')):'—';}
