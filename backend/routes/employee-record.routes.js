'use strict';
const router=require('express').Router();
const authenticate=require('../src/middleware/authenticate'),authorize=require('../src/middleware/authorize');
const {csrfProtection}=require('../src/middleware/csrf');
const controller=require('../src/controllers/employee-record.controller');
router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
// Archive reads still enforce access cutoffs, but must not process due exits.
router.use(authenticate({processEmployment:false}),authorize('ADMIN'));
// POST keeps sensitive search text out of URLs/referrers/history/logs.
router.post('/search',csrfProtection,controller.search);
router.get('/:employeeId',controller.summary);
router.get('/:employeeId/history',controller.history);
router.get('/:employeeId/periods/:episodeId',controller.period);
router.get('/:employeeId/finances',controller.finances);
router.get('/:employeeId/documents',controller.documents);
module.exports=router;
