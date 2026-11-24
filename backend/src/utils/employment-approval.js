'use strict';
function canApproveCase(user,row){return user.role==='ADMIN'&&row.state==='ADMIN_APPROVAL'&&![row.employeeUserId,row.recordedById,row.preparedById].includes(user.id);}
function approvalWhere(userId){return {state:'ADMIN_APPROVAL',AND:['employeeUserId','recordedById','preparedById'].map(field=>field==='recordedById'?{[field]:{not:userId}}:{OR:[{[field]:null},{[field]:{not:userId}}]})};}
module.exports={canApproveCase,approvalWhere};
