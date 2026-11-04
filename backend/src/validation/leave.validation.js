'use strict';
const { z } = require('zod');
const { isCalendarDate } = require('../utils/shift-rules');
const date = z.string().refine(v => isCalendarDate(v) && v >= '1900-01-01' && v <= '9998-12-31');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(v => v >= '1900-01' && v <= '9998-12');
const reason = z.string().trim().min(1).max(1000).refine(v => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v));
const action = { expectedVersion: z.number().int().min(1).max(2147483646), reason };
const pagination = { page:z.coerce.number().int().min(1).max(100000).default(1), pageSize:z.coerce.number().int().min(1).max(100).default(20) };
module.exports = {
 id:z.uuid(), empty:z.object({}).strict(), monthQuery:z.object({month}).strict(),
 request:z.object({shiftDate:date,reason}).strict(), preview:z.object({shiftDate:date}).strict(),
 review:z.object({...action,decision:z.enum(['APPROVED','REJECTED'])}).strict(),
 cancel:z.object(action).strict(),
 list:z.object({...pagination,month:month.optional(),status:z.enum(['PENDING','APPROVED','REJECTED','CANCELLED']).optional()}).strict(),
 management:z.object({...pagination,month:month.optional(),status:z.enum(['PENDING','APPROVED','REJECTED','CANCELLED']).optional(),employeeId:z.uuid().optional(),search:z.string().trim().max(120).optional(),reviewableOnly:z.enum(['true','false']).transform(v=>v==='true').optional()}).strict(),
};
