'use strict';
const router=require('express').Router(),{z}=require('zod'),authenticate=require('../src/middleware/authenticate'),authorize=require('../src/middleware/authorize'),service=require('../src/services/audit-viewer.service'),ApiError=require('../src/utils/ApiError');
const date=z.iso.date().refine(value=>!value.startsWith('0000')&&value<'9999-12-31');
const query=z.strictObject({page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20),dateFrom:date.optional(),dateTo:date.optional(),actorId:z.uuid().optional(),actor:z.string().trim().max(120).optional(),resourceType:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/).optional(),action:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).optional(),result:z.enum(['SUCCESS','FAILURE']).optional(),resourceId:z.uuid().optional()}).refine(v=>!v.dateFrom||!v.dateTo||v.dateFrom<=v.dateTo,'End date must follow start date.');
const parse=(schema,value)=>{const result=schema.safeParse(value);if(!result.success)throw new ApiError(400,'Check the audit filters, dates and identifiers.','VALIDATION_ERROR');return result.data;};
router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});router.use(authenticate(),authorize('ADMIN'));
router.get('/',async(req,res,next)=>{try{res.json({success:true,data:await service.list(req.auth.user.id,parse(query,req.query))});}catch(error){next(error);}});
router.get('/:id',async(req,res,next)=>{try{res.json({success:true,data:await service.detail(req.auth.user.id,parse(z.uuid(),req.params.id))});}catch(error){next(error);}});
module.exports=router;
