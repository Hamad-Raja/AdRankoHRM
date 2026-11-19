import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "@/context/auth-context";
import { apiRequest } from "@/lib/api";
import { useApiResource } from "@/lib/use-api-resource";
import { Button } from "@/components/ui/button";
import Dialog from "@/components/payroll/payroll-dialog";
import {
  dateTime,
  readable as payrollReadable,
} from "@/components/payroll/payroll-format";
import EmployeeCombobox from "@/components/payroll/employee-combobox";
import {downloadDocument} from '@/services/organization.service';
import EmploymentDialog from "@/components/employees/employment-dialog";
const readable = (value) =>
  value === "APPROVED" ? "Approved" : payrollReadable(value);
export default function EmploymentPage() {
  const { user, getCsrfToken, refreshSession } = useAuth(),
    [params, setParams] = useSearchParams(),
    manage = ["ADMIN", "HR"].includes(user.role),
    own = useApiResource("/employment/self-profile");
  const [selection, setSelection] = useState({ touched: false, value: null }),
    [page, setPage] = useState(1),
    [mode, setMode] = useState(null),
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
          ...(manage && params.get("state") === "ADMIN_APPROVAL"
            ? { state: "ADMIN_APPROVAL" }
            : {}),
        }),
    ),
    id = /^[0-9a-f-]{36}$/i.test(params.get("id") || "")
      ? params.get("id")
      : null,
    detail = useApiResource(id ? "/employment/cases/" + id : null),
    record = detail.data;
  function select(value) {
    setSelection({ touched: true, value });
    setPage(1);
    setParams({});
    setError(null);
    setMode(null);
  }
  function openRecord(value) {
    setParams({
      id: value.id,
      ...(employee ? { employeeId: employee.id } : {}),
    });
    setError(null);
  }
  async function reload() {
    if (lock.current) return;
    setBusy(true);
    try {
      await Promise.all([list.reload(), detail.reload(), own.reload()]);
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
        id ? detail.reload() : Promise.resolve(),
      ]);
      if (response.data?.id) openRecord(response.data);
      setMode(null);
      setNotice(
        response.data?.failed
          ? `${response.data.processed} actions processed; ${response.data.failed} require review. Access cutoffs remain enforced. Reload case details before resolving conflicts.`
          : "Employment action saved. Review the current status and history.",
      );
    } catch (failure) {
      setError(failure);
      if (
        started &&
        (!failure.status ||
          failure.status >= 500 ||
          failure.status === 409 ||
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
          <h1 className="text-2xl font-semibold">Employment Management</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Resignation, approved exits, clearance and rehire. Access follows
            confirmed shift times in Asia/Karachi.
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
      <div className="flex flex-wrap gap-3">
        {canUse &&
          own.data?.employee?.employmentEpisodes.some(
            (e) => !e.endDate && e.status !== "EXITED",
          ) &&
          action("self", "Submit my resignation")}
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
      {list.loading ? (
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
                <thead className="bg-muted/30">
                  <tr>
                    {[
                      "Employee",
                      "Type",
                      "State",
                      "Source",
                      "Submitted",
                      "Action",
                    ].map((label) => (
                      <th key={label} scope="col" className="px-4 py-3">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.data.cases.map((row) => (
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
                      <td className="px-4 py-4">{readable(row.source)}</td>
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
            {!list.data.cases.length && (
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
      )}
      {id && (
        <Dialog
          title="Employment Case Details"
          description="Permitted case details, confirmed access times and retained history."
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
                    <>
                      <div className="rounded-xl border border-border p-4">
                        <h2 className="font-semibold">
                          {record.employee.fullName} ·{" "}
                          {record.employee.employeeCode}
                        </h2>
                        <p className="mt-1 text-sm">
                          {readable(record.kind)} · {readable(record.state)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {readable(record.source)} · Recorded by{" "}
                          {record.recordedBy} · Server submission{" "}
                          {dateTime(record.submittedAt)}
                        </p>
                      </div>
                      <dl className="grid gap-4 text-sm sm:grid-cols-2">
                        {[
                          ["Original received date", record.receivedDate],
                          ["Proposed decision date",manage?record.companyDecisionDate:undefined],
                          ["Termination category",manage&&record.terminationCategory?readable(record.terminationCategory):undefined],
                          [record.approvedAt?"Approved employment end date (calendar)":"Proposed employment end date (calendar)",record.employmentEndDate],
                          ["Notice handling (information only)",manage&&record.noticeHandling?readable(record.noticeHandling):undefined],
                          ["Prepared reason",manage?record.preparationReason:undefined],
                          ["HR remarks (internal)",manage?record.hrRemarks:undefined],
                          ["Supporting information",record.supportingInfo],
                          [
                            "Original proposed last working date",
                            record.proposedLastDate,
                          ],
                          [
                            record.approvedAt?"Approved final working shift date":"HR-proposed final working shift date",
                            record.confirmedLastDate,
                          ],
                          [
                            "Notice period",
                            record.noticeDays === null
                              ? null
                              : record.noticeDays + " calendar days",
                          ],
                          [
                            "Final shift start",
                            record.finalShiftStart
                              ? dateTime(record.finalShiftStart)
                              : null,
                          ],
                          [
                            record.approvedAt?"Approved access time":"Proposed access time",
                            record.accessCutoff
                              ? dateTime(record.accessCutoff)
                              : null,
                          ],
                          ["Handover", readable(record.handoverStatus)],
                          ["Clearance", readable(record.clearanceStatus)],
                          ["Account status", record.accountStatus],
                          [
                            "Completed",
                            record.completedAt
                              ? dateTime(record.completedAt)
                              : null,
                          ],
                          [record.kind==="TERMINATION"?"Original recorded reason":"Reason", record.reason],
                          ["Manager review", record.managerNote],
                          ["Fallback reason", record.fallbackReason],
                          ["Date/notice override", record.overrideReason],
                        ]
                          .filter(
                            ([, value]) =>
                              value !== undefined && value !== null,
                          )
                          .map(([label, value]) => (
                            <div key={label}>
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd className="mt-1 whitespace-pre-wrap break-words">
                                {value}
                              </dd>
                            </div>
                          ))}
                      </dl>
                      {record.rehirePlan && (
                        <div className="rounded-xl border border-border p-4 text-sm">
                          <h3 className="font-semibold">
                            Explicit rehire decisions
                          </h3>
                          <p>Joining: {record.rehirePlan.joiningDate}</p>
                          <p>
                            Salary: {readable(record.rehirePlan.salaryDecision)}
                            {record.rehirePlan.salary
                              ? " · PKR " +
                                record.rehirePlan.salary.monthlyBasic
                              : ""}
                          </p>
                          <p>
                            Account:{" "}
                            {readable(record.rehirePlan.accountDecision)}
                          </p>
                          <p>
                            {record.manualAccessHold
                              ? "Manual access hold is active. Automatic processing will not clear it."
                              : "No manual access hold."}
                          </p>
                        </div>
                      )}
                      {(manage||user.role==='EMPLOYEE'&&record.employee.userId===user.id)&&record.supportingDocument&&<div className="rounded-xl border border-border p-3 text-sm"><p className="break-words font-medium">Supporting document: {record.supportingDocument.title}</p><Button variant="outline" className="mt-2" onClick={()=>void downloadDocument(record.employee.id,record.supportingDocument).catch(setError)}>Download supporting document</Button></div>}
                      {manage && (
                        <p className="text-sm text-muted-foreground">
                          Affected teams:{" "}
                          {record.affectedTeams
                            ?.map((a) => a.team.name)
                            .join(", ") || "None"}{" "}
                          · Direct reports:{" "}
                          {record.affectedDirectReports
                            ?.map((a) => a.employee.fullName)
                            .join(", ") || "None"}
                          . No replacement manager is invented.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {record.state === "MANAGER_REVIEW" &&
                          record.managerReviewerId === user.id &&
                          user.role === "MANAGER" &&
                          !self &&
                          action("review", "Review handover")}
                        {record.state === "MANAGER_REVIEW" &&
                          record.managerFallbackAllowed &&
                          manage &&
                          !self &&
                          action("fallback", "Document manager fallback")}
                        {["HR_PREPARATION","ADMIN_APPROVAL"].includes(record.state) && record.kind!=="REHIRE" &&
                          user.role === "HR" &&
                          !self &&
                          action("prepare", "Prepare confirmed exit")}
                        {record.state === "ADMIN_APPROVAL" &&
                          user.role === "ADMIN" &&
                          !self &&
                          ![
                            record.preparedById,
                            record.recordedById,
                            record.managerReviewerId,
                          ].includes(user.id) &&
                          action("approve", "Approve case")}
                        {[
                          "MANAGER_REVIEW",
                          "HR_PREPARATION",
                          "ADMIN_APPROVAL",
                        ].includes(record.state) &&
                          self &&
                          record.kind === "RESIGNATION" &&
                          action("withdraw", "Withdraw my resignation")}
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
                      </div>
                      <details className="rounded-xl border border-border p-4">
                        <summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-ring">
                          Employment Case History
                        </summary>
                        <ol className="mt-4 space-y-3 text-sm">
                          {record.history.map((entry, i) => (
                            <li key={i} className="border-t border-border pt-3">
                              <p>
                                {readable(entry.action)} · {entry.actor}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {dateTime(entry.at)}
                              </p>
                              {manage&&entry.details&&<dl className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">{Object.entries(entry.details).filter(([,value])=>value!==null).map(([label,value])=><div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label.replace(/([A-Z])/g,' $1')}</dt><dd className="break-words whitespace-pre-wrap text-xs">{String(value)}</dd></div>)}</dl>}
                              {entry.reason && (
                                <p className="mt-1 whitespace-pre-wrap break-words">
                                  {entry.reason}
                                </p>
                              )}
                            </li>
                          ))}
                        </ol>
                      </details>
                    </>
                  )
                )}
              </div>
              <footer className="flex shrink-0 justify-end border-t border-border pt-4">
                <Button variant="outline" disabled={busy} onClick={close}>
                  Close case
                </Button>
              </footer>
            </>
          )}
        </Dialog>
      )}
      {mode && (
        <EmploymentDialog
          key={`${mode}:${record?.id||employee?.id||own.data?.employee?.id}`}
          mode={mode}
          employee={
            mode === "self" ? own.data?.employee : record?.employeeSummary || record?.employee || selectedProfile.data?.employee || employee
          }
          record={record}
          busy={busy}
          uncertain={uncertain}
          error={error}
          onSave={save}
          onReload={reload}
          onClose={() => setMode(null)}
        />
      )}
    </section>
  );
}
