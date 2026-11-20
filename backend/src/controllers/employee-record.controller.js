'use strict';
const service=require('../services/employee-record.service');
const v=require('../validation/employee-record.validation');
const ApiError=require('../utils/ApiError');
function parse(schema,input){const result=schema.safeParse(input);if(!result.success)throw new ApiError(400,'Check the Employee Records filters and identifiers.','VALIDATION_ERROR',result.error.issues.map(e=>({field:e.path.map(String).join('.')||'request',message:'Invalid value.'})));return result.data;}
const run=work=>async(req,res,next)=>{try{res.json({success:true,data:await work(req)});}catch(error){next(error);}};
const id=req=>parse(v.id,req.params.employeeId);
module.exports={
 search:run(req=>{parse(v.empty,req.query);return service.search(req.auth.user.id,parse(v.search,req.body));}),
 summary:run(req=>{parse(v.empty,req.query);return service.summary(req.auth.user.id,id(req));}),
 history:run(req=>service.history(req.auth.user.id,id(req),parse(v.pagination,req.query))),
 period:run(req=>service.period(req.auth.user.id,id(req),parse(v.id,req.params.episodeId),parse(v.period,req.query))),
 finances:run(req=>service.finances(req.auth.user.id,id(req),parse(v.finances,req.query))),
 documents:run(req=>service.documents(req.auth.user.id,id(req),parse(v.pagination,req.query))),
};
