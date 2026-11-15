// Presentation options only. The authenticated backend actor enforces assignment.
export function employeeCreationRoles(actorRole){
  if(!['ADMIN','HR'].includes(actorRole))return [];
  return [['EMPLOYEE','Employee'],['MANAGER','Manager'],...(actorRole==='ADMIN'?[['HR','HR - Human Resources']]:[])];
}
