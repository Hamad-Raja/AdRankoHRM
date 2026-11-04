"use strict";
const {z}=require('zod');
const listNotifications=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20),unreadOnly:z.enum(['true','false']).transform(v=>v==='true').optional(),readState:z.enum(['ALL','READ','UNREAD']).optional(),type:z.enum(['ANNOUNCEMENT','ATTENDANCE','PAYROLL','LEAVE','SYSTEM','INFO','WARNING','SUCCESS']).optional()}).strict();
module.exports={id:z.uuid(),listNotifications,empty:z.object({}).strict()};
