'use strict';
const prisma=require('../config/prisma'),{actor,fail}=require('./organization.service');
const {instantFor,addDays}=require('../utils/office-schedule');
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const safeFields=new Set(['fullName','personalEmail','phone','address','cnic','location','emergencyContactName','emergencyContactPhone','emergencyContactRelationship','employmentDates','employmentType']);
function serialize(row){
 const metadata={};
 for(const key of ['version','previousVersion','revokedSessions','revision'])if(Number.isSafeInteger(row.metadata?.[key]))metadata[key]=row.metadata[key];
 const enums={status:['ACTIVE','DISABLED','DRAFT','PENDING','APPROVED','HR_APPROVED','PAID','REJECTED','CANCELLED','COMPLETED','PROBATION','NOTICE_PERIOD','SUSPENDED','EXITED'],decision:['APPROVE','REJECT','ACCEPTED','CONCERNS'],source:['SELF','HR_RECORDED','COMPANY','AUTOMATIC','AUTHORIZED_ACTION'],targetRole:['ADMIN','HR','MANAGER','EMPLOYEE']};
 for(const [key,allowed] of Object.entries(enums))if(allowed.includes(row.metadata?.[key]))metadata[key]=row.metadata[key];
 if(Array.isArray(row.metadata?.changedFields))metadata.changedFields=row.metadata.changedFields.filter(field=>safeFields.has(field));
 const action=/^[A-Z][A-Z0-9_]{0,99}$/.test(row.action)?row.action:'RECORDED_EVENT';
 return {id:row.id,at:row.createdAt.toISOString(),actor:row.actor?.displayName||'System / unavailable account',action,resourceType:/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(row.targetType||'')?row.targetType:'Other',resourceId:uuid.test(row.targetId||'')?row.targetId:null,success:row.success,details:metadata};
}
async function read(userId,work){return prisma.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;const user=await actor(tx,userId,false);if(user.role!=='ADMIN')fail(403,'Global audit access is restricted to Admin.','FORBIDDEN');return work(tx);},{isolationLevel:'RepeatableRead',timeout:15000});}
const include={actor:{select:{displayName:true}}};
async function list(userId,input){return read(userId,async tx=>{
 const where={};
 if(input.dateFrom||input.dateTo)where.createdAt={...(input.dateFrom?{gte:instantFor(input.dateFrom,'00:00','Asia/Karachi')}:{}),...(input.dateTo?{lt:instantFor(addDays(input.dateTo,1),'00:00','Asia/Karachi')}:{})};
 if(input.actorId)where.actorUserId=input.actorId;
 if(input.actor)where.actor={is:{displayName:{contains:input.actor,mode:'insensitive'}}};
 if(input.resourceType)where.targetType=input.resourceType;
 if(input.action)where.action=input.action;
 if(input.result)where.success=input.result==='SUCCESS';
 if(input.resourceId)where.targetId=input.resourceId;
 const total=await tx.auditLog.count({where}),events=await tx.auditLog.findMany({where,include,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize});
 return {events:events.map(serialize),page:input.page,pageSize:input.pageSize,total,totalPages:Math.ceil(total/input.pageSize),timeZone:'Asia/Karachi'};
 });}
async function detail(userId,id){return read(userId,async tx=>{const row=await tx.auditLog.findUnique({where:{id},include});if(!row)fail(404,'Audit event not found.','NOT_FOUND');return serialize(row);});}
module.exports={list,detail};
