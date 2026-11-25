'use strict';
const {z}=require('zod'),{organizationFields}=require('./organization.validation');
// Existing case-level limit: calendar days, including zero. No automatic notice pay/deduction.
const MAX_NOTICE_DAYS=365;
const text=z.string().trim().min(1).max(1000).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/u),date=z.iso.date().refine(v=>!v.startsWith('0000')),timestamp=z.iso.datetime({offset:true});
const notice=z.number().int().min(0).max(MAX_NOTICE_DAYS);
const terminationCategories=['PERFORMANCE','CONDUCT','ROLE_REDUNDANCY','CONTRACT_END','OTHER'];
const noticeArrangements=['WORKED','WAIVED','PAYMENT_IN_LIEU','OTHER'];
const version={expectedVersion:z.number().int().positive().max(2147483647),reason:text};
const review=z.strictObject({...version,recommendation:z.enum(['ACCEPTED','CONCERNS']),handoverStatus:z.enum(['NOT_STARTED','IN_PROGRESS','COMPLETE'])});
const fallback=z.strictObject({...version,confirmed:z.literal(true)});
const prepare=z.strictObject({...version,confirmedLastDate:date,noticeDays:notice,noticeStartDate:date.optional(),finalShiftStart:timestamp.optional(),finalShiftEnd:timestamp.optional(),employmentEndsAt:timestamp.optional(),accessMode:z.enum(['SCHEDULED','ON_APPROVAL']).default('SCHEDULED'),accessCutoff:timestamp.optional(),overrideReason:text.optional(),confirmed:z.literal(true),handoverStatus:z.enum(['NOT_STARTED','IN_PROGRESS','COMPLETE']),clearanceStatus:z.enum(['PENDING','COMPLETE']),terminationCategory:z.enum(terminationCategories).optional(),companyDecisionDate:date.nullable().optional(),employmentEndDate:date.optional(),noticeHandling:z.enum(noticeArrangements).optional(),hrRemarks:text.nullable().optional(),supportingDocumentId:z.uuid().nullable().optional(),supportingInfo:text.nullable().optional()});
const create=z.strictObject({kind:z.enum(['RESIGNATION','TERMINATION']),source:z.enum(['SELF','HR_RECORDED','COMPANY']),employeeId:z.uuid().optional(),reason:text,receivedDate:date.optional(),proposedLastDate:date.optional(),noticeDays:notice.optional(),hrRemarks:text.nullable().optional(),supportingDocumentId:z.uuid().optional(),supportingInfo:text.optional(),preparation:prepare.omit({expectedVersion:true}).extend({terminationCategory:z.enum(terminationCategories),companyDecisionDate:date,employmentEndDate:date,noticeHandling:z.enum(noticeArrangements),finalShiftStart:timestamp.optional(),accessCutoff:timestamp.optional()}).optional()}).superRefine((value,ctx)=>{
 if(value.preparation&&(value.kind!=='TERMINATION'||value.source!=='COMPANY'))ctx.addIssue({code:'custom',path:['preparation'],message:'Only company termination accepts an attached preparation.'});
 if(value.source==='HR_RECORDED'&&value.noticeDays===undefined)ctx.addIssue({code:'custom',path:['noticeDays'],message:'Enter the case notice period (0–365 whole days).'});
 if(value.source==='SELF'&&(value.hrRemarks!==undefined||value.noticeDays!==undefined))ctx.addIssue({code:'custom',path:['source'],message:'Self-service resignation does not accept HR-only fields.'});
 if(value.source==='SELF'&&value.receivedDate!==undefined)ctx.addIssue({code:'custom',path:['receivedDate'],message:'Self-submission uses the server submission timestamp.'});
});
const decision=z.strictObject({...version,confirmed:z.literal(true),assignmentsAcknowledged:z.boolean().optional(),clearManualDisable:z.boolean().optional()});
const rehire=z.strictObject({employeeId:z.uuid(),joiningDate:date,employmentType:z.enum(['FULL_TIME','PART_TIME','CONTRACT','INTERNSHIP','TEMPORARY']),organization:z.strictObject(organizationFields),salaryDecision:z.enum(['NEW','UNCONFIGURED']),salary:require('./payroll-api.validation').salary.pick({monthlyBasic:true,effectiveMonth:true}).optional(),accountDecision:z.enum(['REACTIVATE','KEEP_DISABLED']),accessAt:timestamp.optional(),reason:text,confirmed:z.literal(true)});
const disable=z.strictObject({reason:text,confirmed:z.literal(true)});
const clearance=z.strictObject({...version,handoverStatus:z.enum(['NOT_STARTED','IN_PROGRESS','COMPLETE']),clearanceStatus:z.enum(['PENDING','COMPLETE'])});
const list=z.strictObject({queue:z.enum(['awaiting-my-approval','all']).optional(),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20),employeeId:z.uuid().optional(),state:z.enum(['MANAGER_REVIEW','HR_PREPARATION','ADMIN_APPROVAL','APPROVED','COMPLETED','WITHDRAWN','CANCELLED','REJECTED']).optional()});
module.exports={create,review,fallback,prepare,decision,rehire,disable,clearance,list,MAX_NOTICE_DAYS,terminationCategories,noticeArrangements};
