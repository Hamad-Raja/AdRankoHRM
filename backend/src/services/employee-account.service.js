"use strict";
const { actor, audit, transaction, fail } = require('./organization.service');
const { hashPassword, verifyPassword } = require('../utils/password');
async function linkAccount(actorId, employeeId, data) {
  // Hash outside the transaction; never copy credentials into metadata or responses.
  const passwordHash = data.mode === 'provision' ? await hashPassword(data.password) : null;
  return transaction(async tx => {
    const manager = await actor(tx, actorId);
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee) fail(404, 'Employee not found.', 'NOT_FOUND');
    if (employee.userId) fail(409, 'Employee already has a linked account.', 'ACCOUNT_LINK_CONFLICT');
    const latest=await tx.employmentEpisode.findFirst({where:{employeeId},orderBy:{startDate:'desc'}});const exited=latest?.status==='EXITED';
    if (employee.version >= 2147483647) fail(409, 'Profile version exhausted.', 'EMPLOYEE_VERSION_EXHAUSTED');
    let account;
    if (data.mode === 'link') {
      account = await tx.user.findUnique({ where: { email: data.email } });
      if (!account || (exited?account.status!=='DISABLED':account.status!=='ACTIVE') || ['ADMIN', 'HR'].includes(account.role)) fail(400, 'Eligible account not found. Elevated accounts cannot be linked here.');
    } else {
      if (!['EMPLOYEE','MANAGER'].includes(data.role)) fail(403,'Only Employee and Manager accounts can be provisioned here.','FORBIDDEN');
      if (manager.role === 'HR' && data.role !== 'EMPLOYEE') fail(403, 'HR can provision ordinary employee accounts only.', 'FORBIDDEN');
      account = await tx.user.create({ data: { email: data.email, displayName: employee.fullName, passwordHash, role: data.role, status:exited?'DISABLED':'ACTIVE',mustChangePassword: false } });
    }
    if (manager.role === 'HR' && account.role !== 'EMPLOYEE') fail(403, 'HR can link ordinary employee accounts only.', 'FORBIDDEN');
    const linked = await tx.employee.updateMany({ where: { id: employeeId, userId: null }, data: { userId: account.id, version: { increment: 1 } } });
    if (linked.count !== 1) fail(409, 'Account linkage changed. Reload.', 'ACCOUNT_LINK_CONFLICT');
    if(await require('./employment-access.service').ready(tx))await tx.employmentCase.updateMany({where:{employeeId,state:{in:['MANAGER_REVIEW','HR_PREPARATION','ADMIN_APPROVAL','APPROVED']}},data:{employeeUserId:account.id,version:{increment:1}}});
    await audit(tx, actorId, data.mode === 'link' ? 'EMPLOYEE_ACCOUNT_LINKED' : 'EMPLOYEE_ACCOUNT_PROVISIONED', employeeId, { userId: account.id, role: account.role });
    return { userId: account.id, email: account.email, role: account.role, mustChangePassword: account.mustChangePassword };
  });
}
async function resetAccountPassword(actorId,employeeId,input){
 const schema=require('../validation/auth.validation').managedResetSchema,parsed=schema.safeParse(input);
 if(!parsed.success)fail(400,'Confirm the password reset, matching passwords and its reason.','VALIDATION_ERROR');
 const passwordHash=await hashPassword(parsed.data.newPassword);
 return transaction(async tx=>{
  const administrator=await actor(tx,actorId);
  const employee=await tx.employee.findUnique({where:{id:employeeId},select:{userId:true}});
  if(!employee?.userId)fail(404,'Linked account not found.','NOT_FOUND');
  await tx.$queryRaw`SELECT id FROM users WHERE id=${employee.userId}::uuid FOR UPDATE`;
  const target=await tx.user.findUnique({where:{id:employee.userId}});
  if(!['EMPLOYEE','MANAGER'].includes(target.role)||target.id===administrator.id)fail(403,'Admin/HR may reset only Employee and Manager accounts. Privileged accounts use their existing recovery process.','FORBIDDEN');
  const previous=await tx.auditLog.findFirst({where:{actorUserId:actorId,action:'MANAGED_ACCOUNT_PASSWORD_RESET',targetId:employeeId,metadata:{path:['requestId'],equals:parsed.data.requestId}}});
  if(previous)return {reset:true,replayed:true,accountStatus:target.status};
  if(await verifyPassword(parsed.data.newPassword,target.passwordHash))fail(400,'The replacement must differ from the current password.','PASSWORD_REUSE');
  const now=new Date();
  await tx.user.update({where:{id:target.id},data:{passwordHash,passwordChangedAt:now,mustChangePassword:false,failedLoginAttempts:0,lockedUntil:null}});
  const revoked=await tx.userSession.updateMany({where:{userId:target.id,revokedAt:null},data:{revokedAt:now}});
  await audit(tx,actorId,'MANAGED_ACCOUNT_PASSWORD_RESET',employeeId,{revokedSessions:revoked.count,targetRole:target.role,requestId:parsed.data.requestId});
  return {reset:true,accountStatus:target.status};
 });
}

module.exports = { linkAccount, resetAccountPassword };
