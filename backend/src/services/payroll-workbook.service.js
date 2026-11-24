'use strict';
const payroll=require('./payroll.service'),schema=require('../validation/payroll-api.validation');
const {makeWorkbook}=require('../utils/reports-xlsx'),{readWorkbook}=require('../utils/payroll-workbook');
const ApiError=require('../utils/ApiError'),{randomUUID}=require('crypto');
const VERSION='ADRANKO_PAYROLL_ADJUSTMENTS_V1';
const HEADERS={Payroll:['Employee ID','Employee name','Record ID','Month','Version','Salary version ID','Operation key','Payable days','Worked days','Audit note'],Adjustments:['Employee ID','Month','Operation key','Kind','Category','Title','Amount','Reason']};
const fail=message=>{throw new ApiError(400,message,'TEMPLATE_INVALID');};
async function template(userId,input){
 const records=[];for(const id of input.recordIds){const record=await payroll.detail(userId,id);if(record.status!=='DRAFT'||record.month!==input.month)fail('Select editable drafts from the selected month only.');records.push(record);}
 return makeWorkbook([{name:'Instructions',headers:['Setting','Value'],rows:[['Template version',VERSION],['Month',input.month],['Scope','HR editable existing drafts only; maximum 25 employees and 50 additions per employee.'],['Days','Blank day cells leave saved values unchanged. Zero is explicit and must satisfy existing rules.'],['Adjustments','Add named fixed items; do not delete or replace saved items. Kind: EARNING or DEDUCTION.'],['Categories','EARNING: ALLOWANCE, BONUS, COMMISSION, OVERTIME, OTHER. DEDUCTION: TAX, ADVANCE_RECOVERY, LOAN_RECOVERY, OTHER.'],['Identity','Keep employee/record/month/version/salary IDs and group operation keys unchanged. Names are informational.'],['Operation keys','Each new adjustment requires a unique UUID. Keep its key unchanged when retrying the same adjustment.'],['Audit','Audit note is required for changed employees. Each adjustment also requires a title, positive amount and reason.'],['Safety','No formulas, macros, external links or additional sheets. XLSX only, maximum 2 MB. Preview before applying.'],['Salary','Permanent monthly salary is not editable through this template.']]},{name:'Payroll',headers:HEADERS.Payroll,rows:records.map(record=>[record.employeeId,record.employeeName,record.id,record.month,String(record.version),record.salaryVersionId,randomUUID(),'','',''])},{name:'Adjustments',headers:HEADERS.Adjustments,rows:[]}],new Date());
}
async function report(userId,filters){
 const data=await payroll.monthlyWorkspace(userId,{...filters,page:1,pageSize:10001});if(data.total>10000)throw new ApiError(413,'Narrow the filters to at most 10,000 employees.','EXPORT_TOO_LARGE');
 return makeWorkbook([{name:'Metadata',headers:['Setting','Value'],rows:[['Report','Payroll report — not an import template'],['Month',filters.month],['Scope','All matching employees, including missing payroll and salary states; not restricted to the current page.'],['Currency','PKR']]},{name:'Payroll report',headers:['Employee ID','Code','Name','Month','Status','Monthly basic','Net payable'],rows:data.rows.map(row=>[row.employee.id,row.employee.employeeCode,row.employee.fullName,data.month,row.status,row.monthlyBasic??'Not configured',row.netPay??'Not prepared'])}],new Date());
}
async function importPreview(userId,buffer){
 // Check existing management scope before spending time parsing private workbooks.
 await payroll.list(userId,{page:1,pageSize:1});
 const workbook=await readWorkbook(buffer),errors=[],groups=new Map();
 const error=(sheet,row,message)=>errors.push({sheet,row,message});
 for(const name of ['Payroll','Adjustments'])if(JSON.stringify(workbook[name]?.find(row=>row.row===1)?.cells)!==JSON.stringify(HEADERS[name]))fail(name+' headers do not match the supported template.');
 const instructions=workbook.Instructions;
 if(!instructions.some(row=>row.cells[0]==='Template version'&&row.cells[1]===VERSION))fail('Unsupported template version.');
 const month=instructions.find(row=>row.cells[0]==='Month')?.cells[1];if(!schema.month.safeParse(month).success)fail('Invalid template month.');
 const payrollRows=workbook.Payroll.filter(row=>row.row!==1&&row.cells.some(Boolean));if(payrollRows.length>25)fail('Import at most 25 employees at a time.');
 for(const row of payrollRows){const [employeeId,,recordId,rowMonth,version,salaryVersionId,operationKey,payable,worked,reason]=row.cells;const previous=groups.get(employeeId);if(previous){previous.invalid=true;error('Payroll',row.row,'Duplicate employee.');continue;}const group={employeeId,row:row.row,invalid:false,item:{recordId,operationKey,expectedVersion:Number(version),expectedSalaryVersionId:salaryVersionId,kind:'IMPORT',reason:reason||'',additions:[],...(payable!==undefined&&payable!==''?{totalPayableDays:payable}:{}),...(worked!==undefined&&worked!==''?{workedDays:worked}:{})}};groups.set(employeeId,group);if(rowMonth!==month){group.invalid=true;error('Payroll',row.row,'Month differs from template month.');}}
 const allKeys=new Map();
 for(const group of groups.values()){const key=group.item.operationKey;if(allKeys.has(key)){group.invalid=true;allKeys.get(key).invalid=true;error('Payroll',group.row,'Duplicate group operation key.');}allKeys.set(key,group);}
 for(const row of workbook.Adjustments.filter(row=>row.row!==1&&row.cells.some(Boolean))){const [employeeId,rowMonth,operationKey,kind,type,label,amount,reason]=row.cells,group=groups.get(employeeId);if(!group){error('Adjustments',row.row,'Employee has no matching Payroll row.');continue;}if(rowMonth!==month){group.invalid=true;error('Adjustments',row.row,'Month differs from template month.');}if(allKeys.has(operationKey)){group.invalid=true;allKeys.get(operationKey).invalid=true;error('Adjustments',row.row,'Duplicate operation key.');}allKeys.set(operationKey,group);const line={operationKey,kind,type,label,amount,reason};group.item.additions.push(line);const valid=schema.changes.safeParse({month,items:[{...group.item,reason:group.item.reason||'Validate line'}]});if(!valid.success){group.invalid=true;error('Adjustments',row.row,valid.error.issues[0]?.message||'Invalid adjustment.');}}
 const items=[];
 for(const group of groups.values()){
  if(group.invalid)continue;
  const item=group.item;if(!item.additions.length&&item.totalPayableDays===undefined&&item.workedDays===undefined)continue;
  const valid=schema.changes.safeParse({month,items:[item]});if(!valid.success){error('Payroll',group.row,valid.error.issues[0]?.message||'Invalid employee group.');continue;}
  try{const record=await payroll.detail(userId,item.recordId);if(record.employeeId!==group.employeeId||record.month!==month)throw new Error('Employee identity or month does not match this draft.');items.push(valid.data.items[0]);}catch(e){error('Payroll',group.row,e instanceof ApiError?e.message:'Employee identity or month does not match this draft.');}
 }
 const preview=items.length?await payroll.batchChanges(userId,{month,items},false):{month,results:[],totals:{before:'0.00',after:'0.00',impact:'0.00'},failed:0};
 for(const result of preview.results.filter(row=>row.outcome==='FAILED')){const group=[...groups.values()].find(group=>group.item.recordId===result.recordId);error('Payroll',group?.row||0,result.reason);}
 return {month,errors,preview,locations:Object.fromEntries([...groups.values()].map(group=>[group.item.recordId,group.row])),input:{month,items:items.filter(item=>preview.results.some(row=>row.recordId===item.recordId&&row.outcome==='READY')).map(item=>({...item,previewHash:preview.results.find(row=>row.recordId===item.recordId).previewHash}))},unchanged:groups.size-items.length};
}
module.exports={template,report,importPreview,HEADERS,VERSION};
