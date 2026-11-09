"use strict";
const { actor, audit, transaction, fail } = require('./organization.service');
const { hashPassword } = require('../utils/password');
async function linkAccount(actorId, employeeId, data) {
  // Hash outside the transaction; never copy credentials into metadata or responses.
  const passwordHash = data.mode === 'provision' ? await hashPassword(data.password) : null;
  return transaction(async tx => {
    const manager = await actor(tx, actorId);
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee) fail(404, 'Employee not found.', 'NOT_FOUND');
    if (employee.userId) fail(409, 'Employee already has a linked account.', 'ACCOUNT_LINK_CONFLICT');
    if (employee.version >= 2147483647) fail(409, 'Profile version exhausted.', 'EMPLOYEE_VERSION_EXHAUSTED');
    let account;
    if (data.mode === 'link') {
      account = await tx.user.findUnique({ where: { email: data.email } });
      if (!account || account.status !== 'ACTIVE' || ['ADMIN', 'HR'].includes(account.role)) fail(400, 'Eligible account not found. Elevated accounts cannot be linked here.');
    } else {
      if (manager.role === 'HR' && data.role !== 'EMPLOYEE') fail(403, 'HR can provision ordinary employee accounts only.', 'FORBIDDEN');
      account = await tx.user.create({ data: { email: data.email, displayName: employee.fullName, passwordHash, role: data.role, mustChangePassword: data.role !== 'EMPLOYEE' } });
    }
    if (manager.role === 'HR' && account.role !== 'EMPLOYEE') fail(403, 'HR can link ordinary employee accounts only.', 'FORBIDDEN');
    const linked = await tx.employee.updateMany({ where: { id: employeeId, userId: null }, data: { userId: account.id, version: { increment: 1 } } });
    if (linked.count !== 1) fail(409, 'Account linkage changed. Reload.', 'ACCOUNT_LINK_CONFLICT');
    await audit(tx, actorId, data.mode === 'link' ? 'EMPLOYEE_ACCOUNT_LINKED' : 'EMPLOYEE_ACCOUNT_PROVISIONED', employeeId, { userId: account.id, role: account.role });
    return { userId: account.id, email: account.email, role: account.role, mustChangePassword: account.mustChangePassword };
  });
}
async function resetAccountPassword(actorId,employeeId,newPassword){
 const passwordHash=await hashPassword(newPassword);
 return transaction(async tx=>{
  const administrator=await actor(tx,actorId);
  if(administrator.role!=='ADMIN')fail(403,'Only Admin can reset existing account passwords.','FORBIDDEN');
  const employee=await tx.employee.findUnique({where:{id:employeeId},select:{userId:true}});
  if(!employee?.userId)fail(404,'Linked account not found.','NOT_FOUND');
  const now=new Date();
  await tx.user.update({where:{id:employee.userId},data:{passwordHash,passwordChangedAt:now,mustChangePassword:false,failedLoginAttempts:0,lockedUntil:null}});
  const revoked=await tx.userSession.updateMany({where:{userId:employee.userId,revokedAt:null},data:{revokedAt:now}});
  await audit(tx,actorId,'ADMIN_EMPLOYEE_PASSWORD_RESET',employeeId,{revokedSessions:revoked.count});
  return {reset:true};
 });
}
module.exports = { linkAccount, resetAccountPassword };
