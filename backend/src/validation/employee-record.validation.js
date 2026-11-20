'use strict';
const {z}=require('zod');
const {createEmployeeSchema}=require('./employee.validation');
const page=z.coerce.number().int().min(1).max(100000).default(1);
const pageSize=z.coerce.number().int().min(1).max(50).default(10);
const pagination=z.strictObject({page,pageSize});
const directoryFilters={departmentId:z.union([z.uuid(),z.literal('')]).default(''),teamId:z.union([z.uuid(),z.literal('')]).default(''),query:z.string().trim().max(120).regex(/^[^\u0000-\u001f\u007f]*$/u).default(''),status:z.enum(['','ACTIVE','PROBATION','NOTICE_PERIOD','SUSPENDED','EXITED','FUTURE_START','NO_EMPLOYMENT','UNKNOWN']).default('')};
const search=z.strictObject({...directoryFilters,page,pageSize:z.coerce.number().int().min(1).max(100).default(20)});
const directoryExport=z.strictObject(directoryFilters);
const month=z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/);
const finances=z.strictObject({page,pageSize,salaryPage:page,month:month.optional()});
const period=z.strictObject({eventsPage:page,assignmentsPage:page,pageSize});
function normalizedCnic(value){const result=createEmployeeSchema.shape.cnic.safeParse(value);return result.success&&result.data?result.data:null;}
module.exports={search,directoryExport,pagination,finances,period,empty:z.strictObject({}),id:z.uuid(),normalizedCnic};
