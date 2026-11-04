"use strict";
const prisma=require('../config/prisma');
const {actor,fail}=require('./organization.service');
const clock=require('../utils/notification-clock');
async function transaction(work,isolationLevel='RepeatableRead'){
 try{return await prisma.$transaction(work,{isolationLevel,timeout:15000});}
 catch(e){if(['P2002','P2004','P2025','P2034'].includes(e.code)||JSON.stringify(e.meta||{}).includes('23514'))fail(409,'Notification state changed. Reload and reconcile.','NOTIFICATION_CONFLICT');throw e;}
}
function activeAnnouncement(userId,now=clock.now()){return {status:'PUBLISHED',audienceFrozen:true,legacyReview:false,publishedAt:{lte:now},OR:[{expiresAt:null},{expiresAt:{gt:now}}],recipients:{some:{userId}}};}
function activeInbox(userId,now=clock.now()){return {userId,dismissedAt:null,OR:[{announcementId:null,type:{not:'ANNOUNCEMENT'}},{announcement:{is:activeAnnouncement(userId,now)}}]};}
function safeLink(link){return typeof link==='string'&&/^(\/(dashboard|attendance|my-payslips|payroll|announcements|notifications|leaves))(\?(id|payrollId)=[0-9a-f-]{36})?$/.test(link)?link:null;}
function view(n){return {id:n.id,title:n.title,message:n.message,type:n.type,link:safeLink(n.link),isRead:n.isRead,readAt:n.readAt?.toISOString()||null,createdAt:n.createdAt.toISOString(),expiresAt:n.announcement?.expiresAt?.toISOString()||null};}
async function emitEvent(tx,{eventKey,kind,resourceId,announcementId=null,recipientIds,actorUserId,title,message,type,link}){
 if(!safeLink(link))throw new Error('Untrusted notification destination.');
 const previous=await tx.notificationEvent.findUnique({where:{eventKey}});if(previous)return {eventId:previous.id,count:0};
 const event=await tx.notificationEvent.create({data:{eventKey,kind,resourceId,announcementId}});
 const users=await tx.user.findMany({where:{id:{in:[...new Set(recipientIds)]},status:'ACTIVE'},select:{id:true}});
 if(users.length)await tx.notification.createMany({data:users.map(u=>({userId:u.id,eventId:event.id,announcementId,actorUserId,title,message,type,link})),skipDuplicates:true});
 return {eventId:event.id,count:users.length};
}
async function reviewers(tx,roles,exclude=[]){return (await tx.user.findMany({where:{status:'ACTIVE',mustChangePassword:false,role:{in:roles},id:{notIn:exclude}},select:{id:true}})).map(u=>u.id);}
async function listNotifications(userId,{page=1,pageSize=20,unreadOnly=false,readState,type}={}){return transaction(async tx=>{
 await actor(tx,userId,false);const base=activeInbox(userId);const where={...base,...(unreadOnly||readState==='UNREAD'?{isRead:false}:readState==='READ'?{isRead:true}:{}),...(type?{type}:{})};
 const rows=await tx.notification.findMany({where,include:{announcement:{select:{expiresAt:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize});
 const total=await tx.notification.count({where}),unreadCount=await tx.notification.count({where:{...base,isRead:false}});
 return {asOf:clock.now().toISOString(),notifications:rows.map(view),total,unreadCount,page,pageSize,totalPages:Math.max(1,Math.ceil(total/pageSize))};
});}
async function getUnreadCount(userId){return transaction(async tx=>{await actor(tx,userId,false);return {unreadCount:await tx.notification.count({where:{...activeInbox(userId),isRead:false}})};});}
async function ownedActive(tx,userId,id){
 await tx.$queryRaw`SELECT id FROM notifications WHERE id=${id}::uuid AND "userId"=${userId}::uuid FOR UPDATE`;
 const n=await tx.notification.findFirst({where:{id,...activeInbox(userId)}});if(!n)fail(404,'Notification unavailable.','NOT_FOUND');return n;
}
async function readTx(tx,n){if(n.isRead)return n;return tx.notification.update({where:{id:n.id},data:{isRead:true,readAt:clock.now()}});}
async function markAsRead(userId,id){return transaction(async tx=>{await actor(tx,userId,false);return view(await readTx(tx,await ownedActive(tx,userId,id)));},'ReadCommitted');}
async function cutoff(tx,userId){const result=await tx.notification.aggregate({where:{userId},_max:{sequence:true}});return {time:clock.now(),sequence:result._max.sequence??0n};}
async function markAllAsRead(userId){return transaction(async tx=>{
 await actor(tx,userId,false);const before=await cutoff(tx,userId);
 const rows=await tx.notification.findMany({where:{...activeInbox(userId,before.time),isRead:false,sequence:{lte:before.sequence},createdAt:{lte:before.time}},select:{id:true}});
 const result=await tx.notification.updateMany({where:{id:{in:rows.map(n=>n.id)},isRead:false},data:{isRead:true,readAt:before.time}});
 return {success:true,updatedCount:result.count,cutoff:before.time.toISOString()};
},'RepeatableRead');}
async function deleteNotification(userId,id){return transaction(async tx=>{await actor(tx,userId,false);const n=await tx.notification.findFirst({where:{id,userId}});if(!n)fail(404,'Notification not found.','NOT_FOUND');if(!n.dismissedAt)await tx.notification.update({where:{id},data:{dismissedAt:clock.now()}});return {success:true};},'ReadCommitted');}
async function clearReadNotifications(userId){return transaction(async tx=>{await actor(tx,userId,false);const before=await cutoff(tx,userId);const r=await tx.notification.updateMany({where:{userId,isRead:true,dismissedAt:null,sequence:{lte:before.sequence}},data:{dismissedAt:before.time}});return {success:true,deletedCount:r.count};});}
async function openNotification(userId,id){return transaction(async tx=>{
 const user=await actor(tx,userId,false),n=await ownedActive(tx,userId,id);
 const event=n.eventId?await tx.notificationEvent.findUnique({where:{id:n.eventId}}):null;
 if(event?.kind.startsWith('LEAVE_')){
  const request=await tx.leaveRequest.findUnique({where:{id:event.resourceId},include:{employee:{select:{userId:true}}}});
  const own=request?.requestedByUserId===userId&&request?.employee.userId===userId;
  const review=['LEAVE_SUBMITTED','LEAVE_WITHDRAWN'].includes(event.kind)&&user.role==='HR'&&request?.requestedByUserId!==userId&&request?.employee.userId!==userId;
  if(!request||!own&&!review)fail(404,'Leave request unavailable.','NOT_FOUND');
 }else if(event?.kind.startsWith('CORRECTION_')){
  const c=await tx.attendanceCorrectionRequest.findUnique({where:{id:event.resourceId}});
  if(!c||(event.kind==='CORRECTION_SUBMITTED'?!['ADMIN','HR'].includes(user.role):c.requestedByUserId!==userId))fail(404,'Target unavailable.','NOT_FOUND');
 }else if(event?.kind.startsWith('PAYROLL_')){
  const p=await tx.payrollRecord.findUnique({where:{id:event.resourceId},include:{employee:{select:{userId:true}}}});
  const valid=event.kind==='PAYROLL_HR_APPROVED'?user.role==='ADMIN'&&userId!==p?.hrApprovedByUserId:event.kind==='PAYROLL_RETURNED'?['ADMIN','HR'].includes(user.role):p?.employee.userId===userId&&['APPROVED','PAID'].includes(p.status);
  if(!p||!valid)fail(404,'Target unavailable.','NOT_FOUND');
 }
 const link=safeLink(n.link);if(!link||link.startsWith('/payroll')&&!['ADMIN','HR'].includes(user.role))fail(404,'Target unavailable.','NOT_FOUND');
 await readTx(tx,n);return {link};
},'ReadCommitted');}
module.exports={emitEvent,reviewers,activeAnnouncement,activeInbox,safeLink,transaction,cutoff,listNotifications,getUnreadCount,markAsRead,markAllAsRead,deleteNotification,clearReadNotifications,openNotification};
