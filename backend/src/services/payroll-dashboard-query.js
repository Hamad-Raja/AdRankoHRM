'use strict';
// Same month/version/salary rules as payroll.service.applicable + final approval.
// Count and bounded preview share one query and one read snapshot.
async function payrollQueue(tx,userId,date){
 const rows=await tx.$queryRaw`
 WITH candidates AS (
 SELECT p.id,p."employeeNameSnapshot" AS name,p."employeeCodeSnapshot" AS code,
 p."hrApprovedByUserId"=${userId}::uuid AS same_approver,
 s.id IS DISTINCT FROM p."salaryVersionId" AS stale_salary,
 p.version>=2147483647 AS revision_limit
 FROM payroll_records p
 LEFT JOIN LATERAL (
   SELECT c."rehirePlan" AS plan FROM employment_cases c
   WHERE c."employeeId"=p."employeeId" AND c.kind='REHIRE' AND c.state IN ('APPROVED','COMPLETED')
   AND substring(c."rehirePlan"->>'joiningDate',1,7)<=to_char(p."payrollMonth",'YYYY-MM')
   ORDER BY c."accessCutoff" DESC LIMIT 1
 ) boundary ON true
 LEFT JOIN LATERAL (
   SELECT v.id FROM employee_salary_versions v WHERE v."employeeId"=p."employeeId"
   AND v."effectiveMonth"<=p."payrollMonth"
   AND (boundary.plan IS NULL OR v."effectiveMonth">=to_date(substring(boundary.plan->>'joiningDate',1,7)||'-01','YYYY-MM-DD'))
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(boundary.plan->'priorSalaryVersionIds','[]'::jsonb)) old WHERE old.value=v.id::text)
   ORDER BY v."effectiveMonth" DESC,v.revision DESC LIMIT 1
 ) s ON true WHERE p.status='HR_APPROVED' AND p."payrollMonth"=${date}::date
 ), totals AS (
 SELECT count(*)::int total,count(*) FILTER(WHERE NOT same_approver AND NOT stale_salary AND NOT revision_limit)::int eligible,
 count(*) FILTER(WHERE same_approver)::int same_approver,count(*) FILTER(WHERE stale_salary)::int stale_salary,
 count(*) FILTER(WHERE revision_limit)::int revision_limit FROM candidates
 ) SELECT totals.*,coalesce((SELECT jsonb_agg(preview ORDER BY preview.code,preview.id) FROM
 (SELECT id,name,code,same_approver,stale_salary,revision_limit FROM candidates ORDER BY code,id LIMIT 5) preview),'[]'::jsonb) items FROM totals`;
 const q=rows[0];return {total:q.total,eligible:q.eligible,blockedSameApprover:q.same_approver,blockedStaleSalary:q.stale_salary,blockedRevisionLimit:q.revision_limit,
 items:q.items.map(r=>({id:r.id,employee:{name:r.name,code:r.code},status:'HR_APPROVED',eligible:!r.same_approver&&!r.stale_salary&&!r.revision_limit,blockers:[r.same_approver?'Same approver':null,r.stale_salary?'Salary changed or unavailable':null,r.revision_limit?'Revision limit':null].filter(Boolean)}))};
}
module.exports={payrollQueue};
