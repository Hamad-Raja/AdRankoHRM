import {PersonalEmploymentOverview,PersonalEmploymentDetails} from '@/components/employees/employment-personal-view';
import {canWithdrawPersonal} from '@/lib/employment-personal';
import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "@/context/auth-context";
import { apiRequest } from "@/lib/api";
import { useApiResource } from "@/lib/use-api-resource";
import { Button } from "@/components/ui/button";
import Dialog from "@/components/payroll/payroll-dialog";
import {
  dateTime,
  calendarDate,
  readable as payrollReadable,
} from "@/components/payroll/payroll-format";
import EmployeeCombobox from "@/components/payroll/employee-combobox";
import {downloadDocument} from '@/services/organization.service';
import {EmploymentSelect} from '@/components/employees/employment-dialog';
import EmploymentDialog from "@/components/employees/employment-dialog";
const readable = (value) =>
  value === "APPROVED" ? "Approved" : value === "MANAGER_REVIEW" ? "Awaiting HR review" : value === "HR_PREPARATION" ? "HR preparation" : value === "ADMIN_APPROVAL" ? "Awaiting Admin approval" : payrollReadable(value);
const historyValue=(field,value)=>['finalShiftStart','finalShiftEnd','employmentEndsAt','employmentEndedAt','accessCutoff','accessDisabledAt'].includes(field)?dateTime(value):['receivedDate','proposedLastDate','confirmedLastDate','noticeStartDate','employmentEndDate','companyDecisionDate'].includes(field)?calendarDate(String(value).slice(0,10)):field==='accessMode'?(value==='ON_APPROVAL'?'Disable access on approval':'Scheduled access disable'):['terminationCategory','noticeHandling'].includes(field)?readable(value):String(value);
export default function EmploymentPage() {
  const { user, getCsrfToken, refreshSession } = useAuth(),
    [params, setParams] = useSearchParams(),
    manage = ["ADMIN", "HR"].includes(user.role),
    own = useApiResource("/employment/self-profile"), myResignation = useApiResource("/employment/my-resignation");
  const [selection, setSelection] = useState({ touched: false, value: null }),
    [page, setPage] = useState(1),
    [mode, setMode] = useState(null),
    [personalPage,setPersonalPage]=useState(1),
    [actionRecord,setActionRecord]=useState(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(null),
    [notice, setNotice] = useState(""),
    lock = useRef(false);
  const initialId = /^[0-9a-f-]{36}$/i.test(params.get("employeeId") || "")
      ? params.get("employeeId")
      : null,
    initial = useApiResource(
      manage && initialId ? "/employees/" + initialId : null,
    ),
    employee = selection.touched
      ? selection.value
      : initial.data?.employee || null;
  const selectedProfile = useApiResource(
    manage && employee ? "/employees/" + employee.id : null,
  );
  const selectedRole = selectedProfile.data?.employee?.user?.role,
    disableAllowed =
      selectedRole &&
      selectedProfile.data.employee.userId !== user.id &&
      (user.role === "ADMIN"
        ? ["HR", "MANAGER", "EMPLOYEE"].includes(selectedRole)
        : ["MANAGER", "EMPLOYEE"].includes(selectedRole));
  const list = useApiResource(
      "/employment/cases?" +
        new URLSearchParams({
          page: String(page),
          pageSize: "20",
          ...(employee ? { employeeId: employee.id } : {}),
          ...(manage && ["MANAGER_REVIEW","HR_PREPARATION","ADMIN_APPROVAL","APPROVED","COMPLETED","WITHDRAWN","CANCELLED","REJECTED"].includes(params.get("state"))
            ? { state: params.get("state") }
            : {}),
        }),
    ),
    id = /^[0-9a-f-]{36}$/i.test(params.get("id") || "")
      ? params.get("id")
      : null,
    detail = useApiResource(id ? "/employment/cases/" + id : null),
    record = detail.data;
  const activeCase=myResignation.data?.case;
  const activeDetails=useApiResource(activeCase?'/employment/cases/'+activeCase.id:null);
  const personalHistory=useApiResource(['HR','MANAGER'].includes(user.role)&&own.data?.employee?'/employment/cases?'+new URLSearchParams({employeeId:own.data.employee.id,page:String(personalPage),pageSize:'20'}):null);
  const historyResource=['HR','MANAGER'].includes(user.role)?personalHistory:list;
  const activeRecord=activeCase?(activeCase.id===id&&record?record:activeDetails.data):null;
  const activeLoading=myResignation.loading||Boolean(activeCase&&!activeRecord&&activeDetails.loading);
  const activeError=myResignation.error||activeDetails.error;
  const queueCases=manage?list.data?.cases||[]:(list.data?.cases||[]).filter(row=>row.kind==='RESIGNATION'&&row.employee.userId!==user.id);
  function withdrawOwn(value){setActionRecord(value);setError(null);setMode('withdraw');}

  function select(value) {
    setSelection({ touched: true, value });
    setPage(1);
    setParams({});
    setError(null);
    setMode(null);
  }
  function openRecord(value) {
    const next=new URLSearchParams(params);next.set("id",value.id);if(employee)next.set("employeeId",employee.id);setParams(next);
    setError(null);
  }
  async function reload() {
    if (lock.current) return;
    setBusy(true);
    try {
      await Promise.all([list.reload(), detail.reload(), own.reload(), myResignation.reload(), activeDetails.reload(), personalHistory.reload()]);
      setUncertain(false);
      setMode(null);
      setError(null);
      setNotice(
        "Saved employment records reloaded. Review their history before another action.",
      );
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  async function save(path, body) {
    if (lock.current || uncertain) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    let started = false;
    try {
      const csrfToken = getCsrfToken();
      started = true;
      const response = await apiRequest(path, {
        method: "POST",
        body,
        csrfToken,
      });
      await Promise.all([
        list.reload(),
        own.reload(),
        myResignation.reload(),
        activeDetails.reload(),
        personalHistory.reload(),
        id ? detail.reload() : Promise.resolve(),
      ]);
      if (response.data?.id) openRecord(response.data);
      setMode(null);
      setNotice(
        response.data?.failed
          ? `${response.data.processed} actions processed; ${response.data.failed} require review. Access cutoffs remain enforced. Reload case details before resolving conflicts.`
          : body.source==="SELF"?"Submitted - awaiting HR review":"Employment action saved. Review the current stage and next action.",
      );
    } catch (failure) {
      setError(failure);
      if(failure.code==="OPEN_RESIGNATION_EXISTS"&&failure.details?.caseId){setMode(null);openRecord({id:failure.details.caseId});await myResignation.reload().catch(()=>{});setNotice("An open resignation already exists. Review it before submitting another.");return;}
      if (
        started &&
        (!failure.status ||
          failure.status >= 500 ||
          failure.code === "INVALID_RESPONSE")
      )
        setUncertain(true);
      if (failure.status === 401 || failure.code === "PASSWORD_CHANGE_REQUIRED")
        void refreshSession();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const action = (name, label) => (
    <Button
      key={name}
      variant={
        ["disable", "cancel", "reject"].includes(name) ? "outline" : "default"
      }
      disabled={busy || uncertain}
      onClick={() => {
        setError(null);
        setActionRecord(null);
        setMode(name);
      }}
    >
      {label}
    </Button>
  );
  const selectedEmployment = selectedProfile.data?.employee?.employment;
  const openEmployment =
    selectedEmployment &&
    !selectedEmployment.endDate &&
    selectedEmployment.status !== "EXITED";
  const canUse = !list.loading && !list.error,
    self = record?.employee.userId === user.id;
  const personalCase=self&&record.kind==="RESIGNATION";
  return (
    <section className="min-w-0 space-y-6">
      {manage && params.get("state") === "ADMIN_APPROVAL" && (
        <p className="text-sm text-muted-foreground">
          Awaiting Admin approval, including blocked cases.{" "}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete("state");
              setParams(next);
              setPage(1);
            }}
          >
            Show all case states
          </Button>
        </p>
      )}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl tracking-tight leading-tight">{manage?"Employment Management":"My Employment"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {manage?"Resignation, approved exits, clearance and rehire. Access follows confirmed shift times in Asia/Karachi.":"Track your resignation and confirmed exit arrangements."}
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void reload()}>
          Reload employment records
        </Button>
      </header>
      {manage && (
        <section
          aria-label="Employment employee selection"
          className="rounded-2xl border border-border bg-card p-5"
        >
          <EmployeeCombobox
            selected={employee}
            onSelect={select}
            disabled={busy || uncertain}
          />
        </section>
      )}
      {notice && (
        <p role="status" className="text-sm text-primary">
          {notice}
        </p>
      )}
      {error && !mode && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {uncertain && !mode && (
        <p role="alert">
          The write outcome is unconfirmed. Reload saved records before another
          action. No automatic retry was sent.
        </p>
      )}
      {user.role==='ADMIN'&&myResignation.error&&<p role="alert" className="text-sm text-destructive">Unable to check your current resignation. Reload employment records before starting a request.</p>}
      {user.role==='ADMIN'&&myResignation.data?.case&&<div className="rounded-xl border border-border bg-card p-4 text-sm"><p className="font-semibold">My resignation: {readable(myResignation.data.case.state)}</p><p className="mt-1 text-muted-foreground">Next responsible role: {myResignation.data.case.nextRole||"Approved timing / scheduled processing"}. Handover and clearance are tracked separately.</p></div>}
      {manage&&<div className="max-w-sm"><label className="mb-2 block text-sm font-medium" htmlFor="employment-stage">Case stage</label><EmploymentSelect id="employment-stage" value={params.get("state")||""} placeholder="All stages" options={["HR_PREPARATION","ADMIN_APPROVAL","APPROVED","COMPLETED","MANAGER_REVIEW","WITHDRAWN","CANCELLED","REJECTED"].map(value=>[value,readable(value)])} onChange={e=>{const next=new URLSearchParams(params);if(e.target.value)next.set("state",e.target.value);else next.delete("state");setParams(next);setPage(1);}}/></div>}
      <div className="flex flex-wrap gap-3 empty:hidden">
        {canUse && !myResignation.loading && !myResignation.error && myResignation.data && !myResignation.data.case &&
          own.data?.employee?.employmentEpisodes.some(
            (e) => !e.endDate && e.status !== "EXITED",
          ) &&
          action("self", "Submit my resignation")}
        {user.role==='ADMIN'&&myResignation.data?.case&&<Button disabled={busy||uncertain} onClick={()=>openRecord(myResignation.data.case)}>View my resignation</Button>}
        {canUse && user.role === "HR" && employee && (
          <>
            {openEmployment && (
              <>
                {action("record", "Record resignation on behalf")}
                {action("termination", "Prepare termination case")}
              </>
            )}
            {selectedEmployment?.endDate && action("rehire", "Prepare rehire")}
          </>
        )}
        {canUse &&
          manage &&
          employee &&
          disableAllowed &&
          action("disable", "Disable account access")}
        {canUse && manage && (
          <Button
            variant="outline"
            disabled={busy || uncertain}
            onClick={() => setMode("process")}
          >
            Process approved due actions
          </Button>
        )}
      </div>
      {user.role!=='ADMIN'&&<PersonalEmploymentOverview active={activeRecord} loading={activeLoading} error={activeError} onRetry={()=>void reload()} history={historyResource.data?.cases||[]} historyLoading={historyResource.loading||own.loading} historyError={historyResource.error} onHistoryRetry={()=>void historyResource.reload().catch(()=>{})} page={['HR','MANAGER'].includes(user.role)?personalPage:page} totalPages={historyResource.data?.totalPages||1} onPage={['HR','MANAGER'].includes(user.role)?setPersonalPage:setPage} onOpen={openRecord} onWithdraw={withdrawOwn} user={user} disabled={busy||uncertain}/>}
      {(manage||user.role==='MANAGER'&&(list.loading||list.error||queueCases.length>0||list.data?.totalPages>1))&&(list.loading ? (
        <p role="status">Loading employment cases…</p>
      ) : list.error ? (
        <div role="alert" className="space-y-3">
          <p>{list.error.message}</p>
          <Button onClick={() => void list.reload().catch(() => {})}>
            Retry employment cases
          </Button>
        </div>
      ) : (
        list.data && (
          <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
            <div
              role="region"
              aria-label="Employment cases"
              tabIndex={0}
              className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring"
            >
              <table className="w-full min-w-[45rem] text-left text-sm">
                <thead className="bg-muted/30 font-semibold">
                  <tr>
                    {[
                      "Employee",
                      "Type",
                      "State",
                      "Next action",
                      "Source",
                      "Submitted",
                      "Action",
                    ].map((label) => (
                      <th key={label} scope="col" className="px-4 py-3 font-semibold">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {queueCases.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-border even:bg-muted/20"
                    >
                      <td className="px-4 py-4">
                        <p className="font-medium">{row.employee.fullName}</p>
                        <p className="text-xs text-primary">
                          {row.employee.employeeCode}
                        </p>
                      </td>
                      <td className="px-4 py-4">{readable(row.kind)}</td>
                      <td className="px-4 py-4">{readable(row.state)}</td>
                      <td className="px-4 py-4">{row.nextRole==='HR'?'HR: prepare exit details':row.nextRole==='ADMIN'?'Admin: review prepared values':row.state==='APPROVED'?'Enforce approved timing':'Review history / outstanding tasks'}</td><td className="px-4 py-4">{readable(row.source)}</td>
                      <td className="px-4 py-4">{dateTime(row.submittedAt)}</td>
                      <td className="px-4 py-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openRecord(row)}
                        >
                          View case
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!queueCases.length && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No permitted employment cases.
              </p>
            )}
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4 text-sm">
              <p>
                {list.data.total} cases · Page {page} of{" "}
                {Math.max(1, list.data.totalPages)}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((v) => v - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  disabled={page >= list.data.totalPages}
                  onClick={() => setPage((v) => v + 1)}
                >
                  Next
                </Button>
              </div>
            </footer>
          </div>
        )
      ))}
      {id && (
        <Dialog
          title={personalCase?"My resignation":"Employment Case Details"}
          description={record?record.employee.fullName+" - "+record.employee.employeeCode:"Permitted case details, confirmed access times and retained history."}
          wide
          confirmDiscard
          busy={busy}
          uncertain={uncertain}
          error={error}
          onReload={reload}
          onClose={() => {
            const next = new URLSearchParams(params);
            next.delete("id");
            setParams(next);
          }}
        >
          {(close) => (
            <>
              <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-1 pb-5">
                {detail.loading ? (
                  <p role="status">Loading case…</p>
                ) : detail.error ? (
                  <div role="alert">
                    <p>{detail.error.message}</p>
                    <Button
                      onClick={() => void detail.reload().catch(() => {})}
                    >
                      Retry case
                    </Button>
                  </div>
                ) : (
                  record && (
                    <PersonalEmploymentDetails record={record} personal={self&&record.kind==='RESIGNATION'} management={manage&&!personalCase} formatHistoryValue={historyValue} withdrawAction={canWithdrawPersonal(record,user)?action('withdraw','Withdraw resignation'):null} canDownload={manage||user.role==='EMPLOYEE'&&self} onDownload={()=>void downloadDocument(record.employee.id,record.supportingDocument).catch(setError)} actions={<>
                        {["MANAGER_REVIEW","HR_PREPARATION","ADMIN_APPROVAL"].includes(record.state) &&
                          record.managerReviewerId === user.id &&
                          user.role === "MANAGER" &&
                          !self &&
                          action("review", "Optional handover consultation")}
                        {record.state === "MANAGER_REVIEW" &&
                          record.managerFallbackAllowed &&
                          manage &&
                          !self &&
                          action("fallback", "Move legacy case to HR")}
                        {["MANAGER_REVIEW","HR_PREPARATION","ADMIN_APPROVAL"].includes(record.state) && record.kind!=="REHIRE" &&
                          user.role === "HR" &&
                          !self &&
                          action("prepare", record.preparedById?"Edit preparation":"Prepare exit details")}
                        {record.state==="HR_PREPARATION"&&record.preparedById&&record.kind!=="REHIRE"&&user.role==="HR"&&!self&&action("submit","Send to Admin")}
                        {record.state === "ADMIN_APPROVAL" &&
                          user.role === "ADMIN" &&
                          !self &&
                          ![
                            record.preparedById,
                            record.recordedById,
                          ].includes(user.id) &&
                          action("approve", "Approve case")}
                        {record.state==="ADMIN_APPROVAL"&&record.kind!=="REHIRE"&&user.role==="ADMIN"&&!self&&action("return","Return to HR")}
                        {manage && !self && record.canCancel && (
                          <>
                            {action("cancel", "Cancel case")}
                            {action("reject", "Reject case")}
                          </>
                        )}
                        {user.role === "ADMIN" &&
                          !self &&
                          record.kind === "REHIRE" &&
                          record.state === "COMPLETED" &&
                          record.manualAccessHold &&
                          record.rehirePlan?.accountDecision === "REACTIVATE" &&
                          action("enable", "Approve access for this rehire")}
                        {user.role === "HR" &&
                          !self &&
                          !["WITHDRAWN", "CANCELLED", "REJECTED"].includes(
                            record.state,
                          ) &&
                          action("clearance", "Update handover / clearance")}
</>}/>
                  )
                )}
              </div>
              <footer className="flex shrink-0 justify-end border-t border-border pt-4">
                <Button variant="outline" disabled={busy} onClick={close}>
                  Close
                </Button>
              </footer>
            </>
          )}
        </Dialog>
      )}
      {mode && (
        <EmploymentDialog
          key={`${mode}:${actionRecord?.id||record?.id||employee?.id||own.data?.employee?.id}`}
          mode={mode}
          employee={
            mode === "withdraw"&&actionRecord? actionRecord.employee : mode === "self" ? own.data?.employee : record?.employeeSummary || record?.employee || selectedProfile.data?.employee || employee
          }
          record={mode==='withdraw'&&actionRecord?actionRecord:record}
          busy={busy}
          uncertain={uncertain}
          error={error}
          onSave={save}
          onReload={reload}
          onClose={() => {setMode(null);setActionRecord(null);}}
        />
      )}
    </section>
  );
}
