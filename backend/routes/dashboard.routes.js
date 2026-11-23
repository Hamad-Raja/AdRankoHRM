'use strict';
const router=require('express').Router();
const {z}=require('zod');
const authenticate=require('../src/middleware/authenticate');
const ApiError=require('../src/utils/ApiError');
const service=require('../src/services/dashboard.service');
const empty=z.object({}).strict();
const month=z.object({month:z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/).optional()}).strict();
router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
router.use(authenticate());
const teamQuery=z.strictObject({dateFrom:z.iso.date().optional(),dateTo:z.iso.date().optional(),search:z.string().trim().min(1).max(120).optional(),status:z.enum(require('../src/validation/reports.validation').ATTENDANCE_FILTERS).optional(),page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(5)});
router.get('/team-attendance',async(req,res,next)=>{try{const query=teamQuery.safeParse(req.query);if(!query.success)throw new ApiError(400,'Invalid team attendance filters.','VALIDATION_ERROR');res.json({success:true,data:await service.teamAttendance(req.auth.user.id,query.data)});}catch(e){next(e);}});
router.get('/admin-queues',async(req,res,next)=>{try{const query=month.safeParse(req.query);if(!query.success)throw new ApiError(400,'Invalid dashboard filters.','VALIDATION_ERROR');res.json({success:true,data:await service.adminQueues(req.auth.user.id,query.data.month)});}catch(e){next(e);}});
for(const name of ['employees','attendance','queues','personal','payslip','announcements']) router.get('/'+name,async(req,res,next)=>{
  try{const query=(name==='queues'?month:empty).safeParse(req.query);if(!query.success)throw new ApiError(400,'Invalid dashboard filters. Role and ownership are determined by your session.','VALIDATION_ERROR');
    res.json({success:true,data:await service[name](req.auth.user.id,query.data.month)});
  }catch(e){next(e);}
});
module.exports=router;
